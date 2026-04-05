"""
AI Pipeline - Steg 7: Geometriraffinering
==========================================
Syfte:
    Tar material-kandidaterna från steg 6 och förfinar deras geometri
    för visning i UI-canvas och för slutlig areaververing.

    Problemet: Steg 6 representerar merged-kandidater som en bbox-rektangel
    (5 punkter). Det räcker inte för korrekt canvasvisning — vi vill ha
    en konvex hölje som faktiskt omsluter alla individuella CAD-polygoner.

Operationer per kandidat:
    1. Bygg konvext hölje (Graham scan) av ALLA polygon-punkter.
    2. Douglas-Peucker-förenkling (för framtida komplexa polygoner).
    3. Polygonstängning och kolinjar-punktfiltrering.
    4. Areaververing: Shoelace på hölje vs. summa individuell area.
    5. Separata sub-polygoner för material med spridda zoner.
    6. Export i bild- och PDF-koordinater.

Kräver: bara Python standard library + pdfminer.six
"""

from __future__ import annotations

import json
import math
import os
import sys
from dataclasses import asdict, dataclass, field
from typing import Literal

from pdfminer.high_level import extract_pages
from pdfminer.layout import LTCurve, LTRect

# ---------------------------------------------------------------------------
# Konstanter
# ---------------------------------------------------------------------------

DPI = 300
PT_TO_PX = DPI / 72.0
PT_TO_MM = 25.4 / 72.0

# Douglas-Peucker tolerans (pt) — under denna klassas en punkt som redundant
DP_EPSILON_PT = 0.5

# Kolinjaritetströskel (grader) — vinkel under detta = kolinjar punkt
COLLINEAR_ANGLE_DEG = 0.5

# Spatial klustring: polygoner inom detta avstånd = samma sub-zon (pt)
ZONE_MERGE_DIST_PT = 30.0


# ---------------------------------------------------------------------------
# Rena geometrialgoritmer (inga externa beroenden)
# ---------------------------------------------------------------------------

def _cross(o, a, b):
    """Cross product av vektorerna OA och OB."""
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])


def _convex_hull(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """
    Graham scan: returnerar konvext hölje i moturs ordning.
    Hanterar dubbletter och färre än 3 unika punkter.
    """
    # Deduplicera
    pts = list({(round(p[0], 4), round(p[1], 4)) for p in points})
    n = len(pts)

    if n < 2:
        return pts
    if n == 2:
        return pts + [pts[0]]
    if n == 3:
        return pts + [pts[0]]

    # Sortera: lägst y, sedan lägst x
    pts.sort(key=lambda p: (p[1], p[0]))

    # Bygg nedre hull
    lower = []
    for p in pts:
        while len(lower) >= 2 and _cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)

    # Bygg övre hull
    upper = []
    for p in reversed(pts):
        while len(upper) >= 2 and _cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)

    hull = lower[:-1] + upper[:-1]
    if hull and hull[0] != hull[-1]:
        hull.append(hull[0])
    return hull


def _douglas_peucker(
    pts: list[tuple[float, float]],
    epsilon: float = DP_EPSILON_PT,
) -> list[tuple[float, float]]:
    """
    Douglas-Peucker rekursiv förenkling.
    Returnerar förenklad lista av punkter.
    """
    if len(pts) <= 2:
        return pts

    # Hitta punkten med max avstånd från linjen start→slut
    start, end = pts[0], pts[-1]
    max_dist = 0.0
    max_idx = 0

    for i in range(1, len(pts) - 1):
        px, py = pts[i]
        # Avstånd från punkt till linjen start→end
        if start == end:
            d = math.hypot(px - start[0], py - start[1])
        else:
            dx = end[0] - start[0]
            dy = end[1] - start[1]
            line_len = math.hypot(dx, dy)
            d = abs(dx * (start[1] - py) - (start[0] - px) * dy) / line_len
        if d > max_dist:
            max_dist = d
            max_idx = i

    if max_dist > epsilon:
        left = _douglas_peucker(pts[:max_idx + 1], epsilon)
        right = _douglas_peucker(pts[max_idx:], epsilon)
        return left[:-1] + right
    else:
        return [start, end]


def _remove_collinear(
    pts: list[tuple[float, float]],
    angle_threshold_deg: float = COLLINEAR_ANGLE_DEG,
) -> list[tuple[float, float]]:
    """Tar bort kolinjaera punkter (onödiga punkter längs raka kanter)."""
    if len(pts) < 3:
        return pts
    result = []
    n = len(pts)
    for i in range(n):
        a = pts[(i - 1) % n]
        b = pts[i]
        c = pts[(i + 1) % n]
        # Vinkel vid punkt b
        v1 = (a[0] - b[0], a[1] - b[1])
        v2 = (c[0] - b[0], c[1] - b[1])
        len1 = math.hypot(*v1)
        len2 = math.hypot(*v2)
        if len1 < 1e-9 or len2 < 1e-9:
            continue
        cos_angle = (v1[0]*v2[0] + v1[1]*v2[1]) / (len1 * len2)
        cos_angle = max(-1.0, min(1.0, cos_angle))
        angle = math.degrees(math.acos(cos_angle))
        if abs(180.0 - angle) > angle_threshold_deg:
            result.append(b)
    if result and result[0] != result[-1]:
        result.append(result[0])
    return result if len(result) >= 4 else pts


def _shoelace(pts: list[tuple[float, float]]) -> float:
    n = len(pts)
    if n < 3:
        return 0.0
    area = 0.0
    for i in range(n):
        j = (i + 1) % n
        area += pts[i][0] * pts[j][1]
        area -= pts[j][0] * pts[i][1]
    return abs(area) / 2.0


def _centroid(pts: list[tuple[float, float]]) -> tuple[float, float]:
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return sum(xs) / len(xs), sum(ys) / len(ys)


def _bbox(pts: list[tuple[float, float]]) -> tuple[float, float, float, float]:
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


# ---------------------------------------------------------------------------
# Spatial klustring av polygoner
# ---------------------------------------------------------------------------

def _bbox_distance(a: list[float], b: list[float]) -> float:
    """Minsta avstånd mellan deux bbox:ar [x0,y0,x1,y1]."""
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    dx = max(0.0, max(ax0, bx0) - min(ax1, bx1))
    dy = max(0.0, max(ay0, by0) - min(ay1, by1))
    return math.hypot(dx, dy)


def _cluster_polygons_by_proximity(
    polygons: list[dict],
    max_dist: float = ZONE_MERGE_DIST_PT,
) -> list[list[dict]]:
    """
    Grupperar polygoner som är geografiskt nära varandra.
    Returnerar lista av kluster.
    """
    n = len(polygons)
    if n == 0:
        return []
    if n == 1:
        return [polygons]

    # Union-Find
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(x, y):
        px, py = find(x), find(y)
        if px != py:
            parent[px] = py

    bboxes = [p["bbox_pdf"] for p in polygons]
    for i in range(n):
        for j in range(i + 1, n):
            if _bbox_distance(bboxes[i], bboxes[j]) <= max_dist:
                union(i, j)

    groups: dict[int, list[dict]] = {}
    for i, poly in enumerate(polygons):
        root = find(i)
        groups.setdefault(root, []).append(poly)

    return list(groups.values())


# ---------------------------------------------------------------------------
# Koordinatkonvertering
# ---------------------------------------------------------------------------

def _pdf_to_img(pts: list[tuple[float, float]], page_h: float) -> list[list[float]]:
    return [[round(p[0] * PT_TO_PX, 2), round((page_h - p[1]) * PT_TO_PX, 2)]
            for p in pts]


def _pt2_to_m2(area_pt2: float, scale_denom: float) -> float:
    m_per_pt = (PT_TO_MM * scale_denom) / 1000.0
    return round(area_pt2 * m_per_pt ** 2, 4)


# ---------------------------------------------------------------------------
# Hämta individuella area-polygoner per färg från steg 2
# ---------------------------------------------------------------------------

def _load_area_polygons_by_color(step2_data: dict) -> dict[str, list[dict]]:
    """hex_upper → lista av area_candidate-dicts."""
    by_color: dict[str, list] = {}
    for ac in step2_data.get("area_candidates", []):
        hex_c = ac["fill_color_hex"].upper()
        by_color.setdefault(hex_c, []).append(ac)
    return by_color


# ---------------------------------------------------------------------------
# Dataklasser
# ---------------------------------------------------------------------------

@dataclass
class SubZone:
    """En geografiskt sammanhängande del av ett material."""
    sub_id: str
    polygon_count: int
    hull_pts_pdf: list[list[float]]         # konvext hölje i PDF-koordinater
    hull_pts_image: list[list[float]]       # konvext hölje i bildpixlar
    bbox_pdf: list[float]
    bbox_image: list[float]
    centroid_pdf: list[float]
    centroid_image: list[float]
    hull_area_m2: float                     # Shoelace på höljet
    sum_poly_area_m2: float                 # Summa av individuella polygoners area
    point_count_before: int
    point_count_after: int
    simplification_ratio: float


@dataclass
class RefinedCandidate:
    """En geometriskt raffinerad material-kandidat."""
    id: str
    source_candidate_id: str
    page_number: int
    fill_color_hex: str
    material_category: str
    material_label_short: str
    status: str
    combined_confidence: float

    # Geometri
    sub_zones: list[SubZone]
    total_polygon_count: int
    has_multiple_zones: bool

    # Area
    total_area_m2: float                    # Summa av individuella polygon-areor
    display_area_m2: float                  # Summa av hölje-areor (för visning)
    area_method: str
    area_discrepancy_pct: float             # Avvikelse hölje vs. exakt (%)

    requires_human_review: bool
    review_reason: str | None
    quantity_unit: str
    is_active: bool


# ---------------------------------------------------------------------------
# Raffinera en kandidat
# ---------------------------------------------------------------------------

def _refine_candidate(
    candidate: dict,
    area_polys_by_color: dict[str, list[dict]],
    page_h: float,
    scale_denom: float,
    cand_idx: int,
) -> RefinedCandidate:
    hex_color = candidate["fill_color_hex"].upper()
    source_id = candidate["id"]

    # Hämta alla individuella polygoner för denna färg (från steg 2)
    raw_polys = area_polys_by_color.get(hex_color, [])

    # Om inga exakta polygoner (hatch_cluster): använd befintlig bbox-geom
    if not raw_polys:
        geom = candidate["geometry"]
        pts = [(p[0], p[1]) for p in geom["bbox_pdf"][0:2] and
               [(geom["bbox_pdf"][0], geom["bbox_pdf"][1]),
                (geom["bbox_pdf"][2], geom["bbox_pdf"][1]),
                (geom["bbox_pdf"][2], geom["bbox_pdf"][3]),
                (geom["bbox_pdf"][0], geom["bbox_pdf"][3])]]
        hull = _convex_hull(pts)
        hull_area = _shoelace(hull)
        hull_m2 = _pt2_to_m2(hull_area, scale_denom)
        total_m2 = candidate.get("area_m2") or hull_m2

        cx_pt = (geom["bbox_pdf"][0] + geom["bbox_pdf"][2]) / 2
        cy_pt = (geom["bbox_pdf"][1] + geom["bbox_pdf"][3]) / 2

        sub = SubZone(
            sub_id=f"{source_id}_z0",
            polygon_count=0,
            hull_pts_pdf=[[p[0], p[1]] for p in hull],
            hull_pts_image=_pdf_to_img(hull, page_h),
            bbox_pdf=geom["bbox_pdf"],
            bbox_image=geom["bbox_image"],
            centroid_pdf=[round(cx_pt, 1), round(cy_pt, 1)],
            centroid_image=[round(cx_pt*PT_TO_PX, 1), round((page_h-cy_pt)*PT_TO_PX, 1)],
            hull_area_m2=hull_m2,
            sum_poly_area_m2=total_m2,
            point_count_before=5,
            point_count_after=len(hull),
            simplification_ratio=1.0,
        )

        return RefinedCandidate(
            id=f"rc_{cand_idx:04d}",
            source_candidate_id=source_id,
            page_number=candidate["page_number"],
            fill_color_hex=hex_color,
            material_category=candidate["material_category"],
            material_label_short=candidate["material_label_short"],
            status=candidate["status"],
            combined_confidence=candidate["combined_confidence"],
            sub_zones=[sub],
            total_polygon_count=0,
            has_multiple_zones=False,
            total_area_m2=total_m2,
            display_area_m2=hull_m2,
            area_method=candidate.get("area_method", "grid_estimate"),
            area_discrepancy_pct=0.0,
            requires_human_review=candidate["requires_human_review"],
            review_reason=candidate.get("review_reason"),
            quantity_unit=candidate.get("quantity_unit", "m2"),
            is_active=candidate.get("is_active", False),
        )

    # --- Spatial klustring av polygoner ---
    clusters = _cluster_polygons_by_proximity(raw_polys, ZONE_MERGE_DIST_PT)

    sub_zones = []
    total_exact_area = 0.0
    total_hull_area = 0.0

    for z_idx, cluster in enumerate(clusters):
        # Samla alla punkter i klustret
        all_pts_raw = []
        sum_area_pt2 = 0.0
        point_count_before = 0

        for poly in cluster:
            for pt in poly["pts_pdf"]:
                all_pts_raw.append((pt[0], pt[1]))
            sum_area_pt2 += _shoelace([(p[0], p[1]) for p in poly["pts_pdf"]])
            point_count_before += len(poly["pts_pdf"])

        # Konvext hölje
        hull = _convex_hull(all_pts_raw)

        # Douglas-Peucker + kolinjar-filtrering
        hull_dp = _douglas_peucker(hull, DP_EPSILON_PT)
        hull_clean = _remove_collinear(hull_dp, COLLINEAR_ANGLE_DEG)

        if len(hull_clean) < 4:
            hull_clean = hull

        # Stäng polygonen
        if hull_clean and hull_clean[0] != hull_clean[-1]:
            hull_clean.append(hull_clean[0])

        hull_area_pt2 = _shoelace(hull_clean)
        sum_area_m2 = _pt2_to_m2(sum_area_pt2, scale_denom)
        hull_area_m2 = _pt2_to_m2(hull_area_pt2, scale_denom)

        total_exact_area += sum_area_m2
        total_hull_area += hull_area_m2

        # Bbox och centroid
        bx0, by0, bx1, by1 = _bbox(hull_clean)
        cx_pt, cy_pt = _centroid(hull_clean)

        ratio = (point_count_before / len(hull_clean)
                 if len(hull_clean) > 0 else 1.0)

        sub = SubZone(
            sub_id=f"{source_id}_z{z_idx}",
            polygon_count=len(cluster),
            hull_pts_pdf=[[round(p[0], 2), round(p[1], 2)] for p in hull_clean],
            hull_pts_image=_pdf_to_img(hull_clean, page_h),
            bbox_pdf=[round(bx0, 1), round(by0, 1), round(bx1, 1), round(by1, 1)],
            bbox_image=[
                round(bx0 * PT_TO_PX, 1),
                round((page_h - by1) * PT_TO_PX, 1),
                round((bx1 - bx0) * PT_TO_PX, 1),
                round((by1 - by0) * PT_TO_PX, 1),
            ],
            centroid_pdf=[round(cx_pt, 1), round(cy_pt, 1)],
            centroid_image=[
                round(cx_pt * PT_TO_PX, 1),
                round((page_h - cy_pt) * PT_TO_PX, 1),
            ],
            hull_area_m2=hull_area_m2,
            sum_poly_area_m2=sum_area_m2,
            point_count_before=point_count_before,
            point_count_after=len(hull_clean),
            simplification_ratio=round(ratio, 2),
        )
        sub_zones.append(sub)

    # Sortera sub-zoner: störst area först
    sub_zones.sort(key=lambda z: -z.sum_poly_area_m2)

    # Areavvikelse: hur mycket skiljer höljet från exakt summa
    discrepancy_pct = 0.0
    if total_exact_area > 0:
        discrepancy_pct = round(
            abs(total_hull_area - total_exact_area) / total_exact_area * 100, 1
        )

    # Flagga om höljet är mycket större än exakta areor (indikerar spridd geometri)
    review_reason = candidate.get("review_reason")
    requires_review = candidate["requires_human_review"]
    if discrepancy_pct > 50 and not requires_review:
        requires_review = True
        review_reason = (
            f"Höljesarea ({total_hull_area:.1f} m²) avviker "
            f"{discrepancy_pct}% från exakt area ({total_exact_area:.1f} m²). "
            "Polygonerna är troligen spridda — kontrollera visuellt."
        )

    return RefinedCandidate(
        id=f"rc_{cand_idx:04d}",
        source_candidate_id=source_id,
        page_number=candidate["page_number"],
        fill_color_hex=hex_color,
        material_category=candidate["material_category"],
        material_label_short=candidate["material_label_short"],
        status=candidate["status"],
        combined_confidence=candidate["combined_confidence"],
        sub_zones=sub_zones,
        total_polygon_count=len(raw_polys),
        has_multiple_zones=len(sub_zones) > 1,
        total_area_m2=total_exact_area,
        display_area_m2=total_hull_area,
        area_method="shoelace_hull",
        area_discrepancy_pct=discrepancy_pct,
        requires_human_review=requires_review,
        review_reason=review_reason,
        quantity_unit=candidate.get("quantity_unit", "m2"),
        is_active=candidate.get("is_active", False),
    )


# ---------------------------------------------------------------------------
# Huvudfunktion
# ---------------------------------------------------------------------------

def refine_geometry(
    step2_json_path: str,
    step6_json_path: str,
    output_dir: str = "./output",
) -> dict:
    with open(step2_json_path, encoding="utf-8") as f:
        s2 = json.load(f)
    with open(step6_json_path, encoding="utf-8") as f:
        s6 = json.load(f)

    scale_denom = s2.get("scale_denom") or 200.0
    page_h = s2.get("page_height_pt") or 842.0

    area_polys = _load_area_polygons_by_color(s2)
    candidates = s6.get("candidates", [])

    refined: list[RefinedCandidate] = []
    for i, cand in enumerate(candidates):
        rc = _refine_candidate(cand, area_polys, page_h, scale_denom, i + 1)
        refined.append(rc)

    # Sammanfattning
    summary = {
        "total_refined": len(refined),
        "multi_zone_candidates": sum(1 for r in refined if r.has_multiple_zones),
        "total_exact_area_m2": round(sum(r.total_area_m2 for r in refined), 2),
        "total_hull_area_m2": round(sum(r.display_area_m2 for r in refined), 2),
        "confirmed_area_m2": round(
            sum(r.total_area_m2 for r in refined if r.status == "confirmed"), 2),
        "probable_area_m2": round(
            sum(r.total_area_m2 for r in refined if r.status == "probable"), 2),
        "needs_review": sum(1 for r in refined if r.requires_human_review),
        "by_material": {},
    }

    for r in refined:
        cat = r.material_category or "okänd"
        if cat not in summary["by_material"]:
            summary["by_material"][cat] = {"count": 0, "area_m2": 0.0, "status": r.status}
        summary["by_material"][cat]["count"] += 1
        summary["by_material"][cat]["area_m2"] = round(
            summary["by_material"][cat]["area_m2"] + r.total_area_m2, 2)

    result = {
        "pdf_path": s2.get("pdf_path"),
        "page_number": s2.get("page_number", 1),
        "scale_denom": scale_denom,
        "summary": summary,
        "refined_candidates": [asdict(r) for r in refined],
    }

    os.makedirs(output_dir, exist_ok=True)
    out_path = os.path.join(output_dir, "step7_refined.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)

    return result


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Step 7: Geometriraffinering.")
    parser.add_argument("--step2-json", required=True)
    parser.add_argument("--step6-json", required=True)
    parser.add_argument("--output-dir", default="./output")
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()

    result = refine_geometry(args.step2_json, args.step6_json, args.output_dir)

    if args.pretty:
        print(json.dumps(result["summary"], indent=2, ensure_ascii=False))
    else:
        print(json.dumps(result, ensure_ascii=False))
    print(f"\n[Sparat till {args.output_dir}/step7_refined.json]", file=sys.stderr)


if __name__ == "__main__":
    main()
