"""
AI Pipeline - Steg 6: Kandidat-generering
==========================================
Syfte:
    Kombinerar alla steg 1-5 till en lista av MaterialCandidate-objekt.
    Varje kandidat representerar en klassificerad materialyta på ritningen.

Datakällor och prioritet:
    A. Step 2 area_candidates  — exakta CAD-polygoner, Shoelace-area
       (dessa är grunden — sub-millimeter precision om ritningen är korrekt)
    B. Step 5 hatch_clusters   — grid-uppskattning, saknar area-polygon
       (komplement för material utan area_candidate)

Areaberäkning:
    - Area_candidates (steg 2): Shoelace-formel × skala → exakt m²
    - Hatch-clusters (steg 5): grid_cells × cell_area → grov uppskattning
      (bbox-area överskatttar kraftigt; grid-area är mer realistisk)

Materialstatus:
    confirmed     — exakt legendmatchning, hög konfidans
    probable      — legendmatchning men konflikt eller låg konfidans
    unmatched     — färgen finns inte i legenden
    review        — mänsklig granskning krävs

Kräver: pdfminer.six (för polygon-area om step2 saknas)
"""

from __future__ import annotations

import json
import math
import os
import sys
from dataclasses import asdict, dataclass, field
from typing import Literal

# ---------------------------------------------------------------------------
# Konstanter
# ---------------------------------------------------------------------------

DPI = 300
PT_TO_PX = DPI / 72.0
PT_TO_MM = 25.4 / 72.0

CLUSTER_GRID_PT = 15.0          # Måste matcha step5

# Konfidans-trösklar
CONFIRMED_THRESHOLD = 0.65
PROBABLE_THRESHOLD  = 0.30

CandidateStatus = Literal["confirmed", "probable", "unmatched", "review"]
CandidateSource = Literal["area_polygon", "hatch_cluster", "merged"]


# ---------------------------------------------------------------------------
# Areaberäkning
# ---------------------------------------------------------------------------

def _shoelace(pts: list[list[float]]) -> float:
    """Shoelace-formel för polygonarea i pt²."""
    n = len(pts)
    if n < 3:
        return 0.0
    area = 0.0
    for i in range(n):
        j = (i + 1) % n
        area += pts[i][0] * pts[j][1]
        area -= pts[j][0] * pts[i][1]
    return abs(area) / 2.0


def _pt2_to_m2(area_pt2: float, scale_denom: float) -> float:
    """Konverterar pt² (PDF-koord) till verkliga m² via skalans nämnare."""
    m_per_pt = (PT_TO_MM * scale_denom) / 1000.0
    return round(area_pt2 * (m_per_pt ** 2), 4)


def _grid_area_m2(grid_cells: int, grid_size_pt: float, scale_denom: float) -> float:
    """
    Uppskattad area via antal grid-celler.
    Bättre än bbox för utspridda hatch-mönster.
    """
    cell_area_pt2 = grid_size_pt ** 2
    return _pt2_to_m2(grid_cells * cell_area_pt2, scale_denom)


# ---------------------------------------------------------------------------
# Geometriverktyg
# ---------------------------------------------------------------------------

def _bbox_overlap_fraction(a: list[float], b: list[float]) -> float:
    """
    Returnerar overlap-fraction (0-1) av bbox-arean för [x0,y0,x1,y1].
    Om 0: ingen överlapp. Om 1: fullständig innefattning.
    """
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    ix0 = max(ax0, bx0)
    iy0 = max(ay0, by0)
    ix1 = min(ax1, bx1)
    iy1 = min(ay1, by1)
    if ix1 <= ix0 or iy1 <= iy0:
        return 0.0
    inter = (ix1 - ix0) * (iy1 - iy0)
    area_a = (ax1 - ax0) * (ay1 - ay0)
    area_b = (bx1 - bx0) * (by1 - by0)
    min_area = min(area_a, area_b)
    return inter / min_area if min_area > 0 else 0.0


def _pts_to_bbox(pts: list[list[float]]) -> list[float]:
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return [min(xs), min(ys), max(xs), max(ys)]


# ---------------------------------------------------------------------------
# Dataklasser
# ---------------------------------------------------------------------------

@dataclass
class PolygonGeometry:
    """Polygongeometri i PDF-koordinater och bildkoordinater."""
    pts_pdf: list[list[float]]          # [(x, y), ...] i PDF-punkter
    pts_image: list[list[float]]        # [(x, y), ...] i bildpixlar
    bbox_pdf: list[float]               # [x0, y0, x1, y1]
    bbox_image: list[float]             # [x, y, w, h]
    centroid_pdf: list[float]
    centroid_image: list[float]
    is_exact: bool                      # True = Shoelace, False = bbox-approx


@dataclass
class MaterialCandidate:
    """
    En klassificerad materialyta redo för granskning och mängdning.
    Detta är kärnutputen från hela AI-pipelinen.
    """
    id: str
    page_number: int
    source: CandidateSource             # "area_polygon" | "hatch_cluster" | "merged"
    status: CandidateStatus

    # Material
    fill_color_hex: str
    material_category: str              # normaliserad kategori (t.ex. "betongplattor")
    material_label: str                 # rå legend-text
    material_label_short: str           # max 40 tecken
    legend_item_id: str | None

    # Konfidans
    color_confidence: float
    combined_confidence: float

    # Geometri
    geometry: PolygonGeometry
    polygon_count: int                  # antal sammanslagna polygoner (steg 2)

    # Area
    area_pt2: float
    area_m2: float
    area_method: str                    # "shoelace" | "grid_estimate" | "bbox_estimate"

    # Granskning
    requires_human_review: bool
    review_reason: str | None
    conflict_labels: list[str]

    # Mängdning-metadata
    quantity_unit: str                  # "m2" | "lm" | "st"
    is_active: bool                     # True = inkluderas i mängdning


# ---------------------------------------------------------------------------
# Bygg färg→material lookup från step5
# ---------------------------------------------------------------------------

def _build_material_lookup(step5_data: dict) -> dict[str, dict]:
    """hex_upper → {material_category, label, confidence, status, item_id, conflicts}"""
    lookup = {}
    for hex_color, info in step5_data.get("color_map", {}).items():
        lookup[hex_color.upper()] = info
    return lookup


# ---------------------------------------------------------------------------
# Konvertera koordinater
# ---------------------------------------------------------------------------

def _pdf_to_image_pts(pts: list[list[float]], page_h: float) -> list[list[float]]:
    scale = PT_TO_PX
    return [[round(p[0] * scale, 1), round((page_h - p[1]) * scale, 1)] for p in pts]


def _build_geometry_from_ac(ac: dict, page_h: float) -> PolygonGeometry:
    """Bygger PolygonGeometry från en area_candidate (step 2)."""
    pts = ac["pts_pdf"]
    pts_img = _pdf_to_image_pts(pts, page_h)
    bbox = ac["bbox_pdf"]
    cx = (bbox[0] + bbox[2]) / 2
    cy = (bbox[1] + bbox[3]) / 2
    cx_img = round(cx * PT_TO_PX, 1)
    cy_img = round((page_h - cy) * PT_TO_PX, 1)
    return PolygonGeometry(
        pts_pdf=pts,
        pts_image=pts_img,
        bbox_pdf=bbox,
        bbox_image=ac["bbox_image"],
        centroid_pdf=[round(cx, 1), round(cy, 1)],
        centroid_image=[cx_img, cy_img],
        is_exact=True,
    )


def _build_geometry_from_cluster(cluster: dict, page_h: float) -> PolygonGeometry:
    """Bygger PolygonGeometry (bbox-rektangel) från ett hatch-kluster (step 5)."""
    x0, y0, x1, y1 = cluster["bbox_pdf"]
    pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
    pts_img = _pdf_to_image_pts(pts, page_h)
    cx, cy = cluster["centroid_pdf"]
    cx_img, cy_img = cluster["centroid_image"]
    bi = cluster["bbox_image"]  # [x, y, w, h]
    return PolygonGeometry(
        pts_pdf=pts,
        pts_image=pts_img,
        bbox_pdf=[x0, y0, x1, y1],
        bbox_image=bi,
        centroid_pdf=[cx, cy],
        centroid_image=[cx_img, cy_img],
        is_exact=False,
    )


# ---------------------------------------------------------------------------
# Statusklassificering
# ---------------------------------------------------------------------------

def _determine_status(
    material_status: str,
    combined_conf: float,
) -> CandidateStatus:
    if material_status == "unmatched":
        return "unmatched"
    if material_status == "conflict":
        return "review"
    if combined_conf >= CONFIRMED_THRESHOLD:
        return "confirmed"
    if combined_conf >= PROBABLE_THRESHOLD:
        return "probable"
    return "review"


# ---------------------------------------------------------------------------
# Sammanslå polygoner av samma färg och material
# ---------------------------------------------------------------------------

def _merge_polygons(
    candidates: list[dict],  # lista av steg-2 area_candidates med samma färg
    material_info: dict,
    page_h: float,
    scale_denom: float,
    color_hex: str,
    candidate_id: str,
    page_number: int,
) -> MaterialCandidate:
    """
    Sammanslår alla polygoner av en och samma färg till en MaterialCandidate.
    Area = summan av Shoelace-area för alla polygoner.
    Geometri = convex hull-bbox (för visning).
    """
    all_pts = []
    total_area_pt2 = 0.0

    for ac in candidates:
        pts = ac["pts_pdf"]
        total_area_pt2 += _shoelace(pts)
        all_pts.extend(pts)

    # Beräkna bounding box för alla punkter
    xs = [p[0] for p in all_pts]
    ys = [p[1] for p in all_pts]
    x0, y0 = min(xs), min(ys)
    x1, y1 = max(xs), max(ys)

    # Geometri: representativ polygon (bbox-rektangel)
    pts_repr = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
    pts_repr_img = _pdf_to_image_pts(pts_repr, page_h)
    cx = (x0 + x1) / 2
    cy = (y0 + y1) / 2
    cx_img = round(cx * PT_TO_PX, 1)
    cy_img = round((page_h - cy) * PT_TO_PX, 1)

    w_img = round((x1 - x0) * PT_TO_PX, 1)
    h_img = round((y1 - y0) * PT_TO_PX, 1)

    geom = PolygonGeometry(
        pts_pdf=pts_repr,
        pts_image=pts_repr_img,
        bbox_pdf=[round(x0, 1), round(y0, 1), round(x1, 1), round(y1, 1)],
        bbox_image=[round(x0 * PT_TO_PX, 1), round((page_h - y1) * PT_TO_PX, 1), w_img, h_img],
        centroid_pdf=[round(cx, 1), round(cy, 1)],
        centroid_image=[cx_img, cy_img],
        is_exact=True,
    )

    area_m2 = _pt2_to_m2(total_area_pt2, scale_denom)

    cat = material_info.get("material_category", "okänd")
    label = material_info.get("material_label", "") or ""
    mat_status = material_info.get("status", "unmatched")
    color_conf = material_info.get("combined_confidence") or material_info.get("confidence", 0.0)
    status = _determine_status(mat_status, color_conf)

    requires_review = status in ("review", "unmatched") or color_conf < PROBABLE_THRESHOLD
    review_reason = None
    conflict_labels = material_info.get("conflict_labels", [])
    if mat_status == "conflict":
        review_reason = f"Färgkonflikt: {color_hex} används för flera material"
    elif mat_status == "unmatched":
        review_reason = f"Färg {color_hex} saknas i legenden"

    return MaterialCandidate(
        id=candidate_id,
        page_number=page_number,
        source="area_polygon" if len(candidates) == 1 else "merged",
        status=status,
        fill_color_hex=color_hex,
        material_category=cat,
        material_label=label,
        material_label_short=label[:40] if label else "(okänd)",
        legend_item_id=material_info.get("item_id"),
        color_confidence=round(float(color_conf), 3),
        combined_confidence=round(float(color_conf), 3),
        geometry=geom,
        polygon_count=len(candidates),
        area_pt2=round(total_area_pt2, 2),
        area_m2=area_m2,
        area_method="shoelace",
        requires_human_review=requires_review,
        review_reason=review_reason,
        conflict_labels=conflict_labels,
        quantity_unit="m2",
        is_active=not requires_review,
    )


# ---------------------------------------------------------------------------
# Huvudfunktion
# ---------------------------------------------------------------------------

def generate_candidates(
    step2_json_path: str,
    step5_json_path: str,
    output_dir: str = "./output",
    min_area_m2: float = 0.05,           # Filtrera bort nano-ytor
    overlap_threshold: float = 0.6,       # Hatch-kluster med >60% overlap med area-polygon ignoreras
) -> dict:
    """
    Kombinerar step 2 och step 5 till en lista av MaterialCandidate-objekt.
    """
    with open(step2_json_path, encoding="utf-8") as f:
        s2 = json.load(f)
    with open(step5_json_path, encoding="utf-8") as f:
        s5 = json.load(f)

    scale_denom = s2.get("scale_denom") or 200.0
    page_h = s2.get("page_height_pt") or 842.0
    page_number = s2.get("page_number") or 1

    material_lookup = _build_material_lookup(s5)

    candidates: list[MaterialCandidate] = []
    counter = 0

    # -----------------------------------------------------------------------
    # A. Area-polygoner (Step 2) — gruppera per färg
    # -----------------------------------------------------------------------
    from collections import defaultdict
    ac_by_color: dict[str, list] = defaultdict(list)
    for ac in s2.get("area_candidates", []):
        hex_c = ac["fill_color_hex"].upper()
        ac_by_color[hex_c].append(ac)

    area_polygon_bboxes: list[list[float]] = []

    for hex_color, acs in ac_by_color.items():
        counter += 1
        cid = f"mc_{counter:04d}"
        mat_info = material_lookup.get(hex_color, {
            "material_category": "okänd",
            "material_label": "",
            "status": "unmatched",
            "combined_confidence": 0.0,
            "confidence": 0.0,
            "item_id": None,
            "conflict_labels": [],
        })

        cand = _merge_polygons(
            acs, mat_info, page_h, scale_denom,
            hex_color, cid, page_number,
        )

        if cand.area_m2 < min_area_m2:
            continue

        candidates.append(cand)
        area_polygon_bboxes.append(cand.geometry.bbox_pdf)

    # -----------------------------------------------------------------------
    # B. Hatch-kluster (Step 5) — lägg bara till om ej täckta av area-polygon
    # -----------------------------------------------------------------------
    for region in s5.get("classified_regions", []):
        hex_color = region["fill_color_hex"].upper()

        # Hoppa om vi redan har en area-polygon för denna färg
        if hex_color in ac_by_color:
            continue

        cluster = region["cluster"]
        cl_bbox = cluster["bbox_pdf"]
        grid_cells = cluster.get("grid_cells", 1)

        # Kolla om klustret är täckt av en befintlig area-polygon
        max_overlap = 0.0
        for ap_bbox in area_polygon_bboxes:
            overlap = _bbox_overlap_fraction(cl_bbox, ap_bbox)
            if overlap > max_overlap:
                max_overlap = overlap
        if max_overlap > overlap_threshold:
            continue  # täckt av area-polygon

        # Beräkna area via grid-cells (mer realistisk än bbox)
        area_m2 = _grid_area_m2(grid_cells, CLUSTER_GRID_PT, scale_denom)
        if area_m2 < min_area_m2:
            continue

        mat_info = material_lookup.get(hex_color, {
            "material_category": "okänd",
            "material_label": "",
            "status": "unmatched",
            "combined_confidence": 0.0,
            "confidence": 0.0,
            "item_id": None,
            "conflict_labels": [],
        })

        counter += 1
        cid = f"mc_{counter:04d}"
        geom = _build_geometry_from_cluster(cluster, page_h)

        color_conf = float(mat_info.get("combined_confidence") or mat_info.get("confidence") or 0.0)
        mat_status = mat_info.get("status", "unmatched")
        status = _determine_status(mat_status, color_conf)

        cat = mat_info.get("material_category", "okänd")
        label = mat_info.get("material_label") or ""
        conflict_labels = mat_info.get("conflict_labels", [])

        requires_review = status in ("review", "unmatched")
        review_reason = None
        if mat_status == "unmatched":
            review_reason = f"Färg {hex_color} saknas i legenden — manuell tilldelning krävs"
        elif mat_status == "conflict":
            review_reason = f"Färgkonflikt: {hex_color}"
        elif region["requires_human_review"]:
            review_reason = region.get("review_reason", "Låg konfidans")

        cand = MaterialCandidate(
            id=cid,
            page_number=page_number,
            source="hatch_cluster",
            status=status,
            fill_color_hex=hex_color,
            material_category=cat,
            material_label=label,
            material_label_short=label[:40] if label else "(okänd)",
            legend_item_id=mat_info.get("item_id"),
            color_confidence=round(color_conf, 3),
            combined_confidence=round(color_conf, 3),
            geometry=geom,
            polygon_count=0,
            area_pt2=0.0,
            area_m2=area_m2,
            area_method="grid_estimate",
            requires_human_review=requires_review,
            review_reason=review_reason,
            conflict_labels=conflict_labels,
            quantity_unit="m2",
            is_active=not requires_review,
        )
        candidates.append(cand)

    # Sortera: status-prio (confirmed > probable > review > unmatched) + area
    status_order = {"confirmed": 0, "probable": 1, "review": 2, "unmatched": 3}
    candidates.sort(key=lambda c: (status_order[c.status], -c.area_m2))

    # -----------------------------------------------------------------------
    # Sammanfattning
    # -----------------------------------------------------------------------
    summary = {
        "total_candidates": len(candidates),
        "confirmed": sum(1 for c in candidates if c.status == "confirmed"),
        "probable": sum(1 for c in candidates if c.status == "probable"),
        "review": sum(1 for c in candidates if c.status == "review"),
        "unmatched": sum(1 for c in candidates if c.status == "unmatched"),
        "from_area_polygon": sum(1 for c in candidates if c.source in ("area_polygon", "merged")),
        "from_hatch_cluster": sum(1 for c in candidates if c.source == "hatch_cluster"),
        "total_area_confirmed_m2": round(
            sum(c.area_m2 for c in candidates if c.status == "confirmed"), 2),
        "total_area_probable_m2": round(
            sum(c.area_m2 for c in candidates if c.status == "probable"), 2),
        "total_area_all_m2": round(sum(c.area_m2 for c in candidates), 2),
    }

    result = {
        "pdf_path": s2.get("pdf_path"),
        "page_number": page_number,
        "scale_denom": scale_denom,
        "summary": summary,
        "candidates": [asdict(c) for c in candidates],
    }

    os.makedirs(output_dir, exist_ok=True)
    out_path = os.path.join(output_dir, "step6_candidates.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)

    return result


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Step 6: Generera material-kandidater från steg 2 + steg 5."
    )
    parser.add_argument("--step2-json", required=True)
    parser.add_argument("--step5-json", required=True)
    parser.add_argument("--output-dir", default="./output")
    parser.add_argument("--min-area", type=float, default=0.05)
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()

    result = generate_candidates(
        step2_json_path=args.step2_json,
        step5_json_path=args.step5_json,
        output_dir=args.output_dir,
        min_area_m2=args.min_area,
    )

    if args.pretty:
        print(json.dumps(result["summary"], indent=2, ensure_ascii=False))
        print(f"\nTotal kandidater: {result['summary']['total_candidates']}")
    else:
        print(json.dumps(result, ensure_ascii=False))

    print(f"\n[Sparat till {args.output_dir}/step6_candidates.json]", file=sys.stderr)


if __name__ == "__main__":
    main()
