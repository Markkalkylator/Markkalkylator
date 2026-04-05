"""
AI Pipeline - Steg 5: Hatch/Mönster-klassificering
====================================================
Syfte:
    Koppla hatch-tile-grupper (från steg 2) till materialnamn (från steg 3).
    Klustrar hatch-tiles spatialt till sammanhängande regioner.
    Hanterar färgkonflikter via bildpatch-jämförelse.
    Producerar en lista av klassificerade materialregioner.

Metod:
    1. Färgbaserad matchning: hatch_color → legend_item.fill_color
    2. Spatial klustring: grid-flood-fill på tile-centroids.
    3. Bildpatch-extraktion: jämför renderad PNG mot legend-patches.
    4. Konfidensmodell: kombinerar color_conf + spatial_conf + patch_conf.

Kräver: pdfminer.six, Pillow
"""

from __future__ import annotations

import json
import math
import os
import sys
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Literal

from pdfminer.high_level import extract_pages
from pdfminer.layout import LTCurve, LTRect
from PIL import Image

# ---------------------------------------------------------------------------
# Konstanter
# ---------------------------------------------------------------------------

DPI = 300
PT_TO_PX = DPI / 72.0
PT_TO_MM = 25.4 / 72.0

# Grid-storlek för spatial klustring (pt) — ungefär 1 dm i verkligt mått vid 1:200
CLUSTER_GRID_PT = 15.0

# Minsta antal tiles för att en kluster ska räknas som ett material-område
MIN_TILES_PER_CLUSTER = 5

# Minsta area för hatch-tile (pt²) — filtrerar bort sub-pixel-artefakter
TILE_MIN_AREA = 0.5
TILE_MAX_AREA = 200.0   # Över detta = area-kandidat (hanteras i steg 2/7)

# Patch-storlek för bildpatch-jämförelse (px)
PATCH_SIZE_PX = 40

# Maximal färgdistans (RGB 0-255) för färgmatchning
COLOR_MATCH_TOLERANCE = 8

MaterialStatus = Literal[
    "matched",          # hittad i legenden, unik färg
    "conflict",         # färgen förekommer i flera legend-poster
    "unmatched",        # färgen finns INTE i legenden
    "below_threshold",  # för få tiles, troligen artefakt
]


# ---------------------------------------------------------------------------
# Färgverktyg
# ---------------------------------------------------------------------------

def _hex_to_rgb255(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _rgb255_to_hex(r: int, g: int, b: int) -> str:
    return "#{:02X}{:02X}{:02X}".format(r, g, b)


def _color_distance(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def _pdfminer_color_to_hex(c) -> str | None:
    if c is None:
        return None
    if isinstance(c, (int, float)):
        v = int(float(c) * 255)
        return _rgb255_to_hex(v, v, v)
    if isinstance(c, (list, tuple)):
        if len(c) == 1:
            v = int(float(c[0]) * 255)
            return _rgb255_to_hex(v, v, v)
        if len(c) == 3:
            r, g, b = [max(0, min(255, int(float(x) * 255))) for x in c]
            return _rgb255_to_hex(r, g, b)
        if len(c) == 4:
            C, M, Y, K = [float(x) for x in c]
            r = int((1 - C) * (1 - K) * 255)
            g = int((1 - M) * (1 - K) * 255)
            b = int((1 - Y) * (1 - K) * 255)
            return _rgb255_to_hex(
                max(0, min(255, r)),
                max(0, min(255, g)),
                max(0, min(255, b)),
            )
    return None


# ---------------------------------------------------------------------------
# Dataklasser
# ---------------------------------------------------------------------------

@dataclass
class SpatialCluster:
    """En sammanhängande grupp av hatch-tiles med samma färg."""
    cluster_id: str
    fill_color_hex: str
    tile_count: int
    bbox_pdf: list[float]               # [x0, y0, x1, y1]
    bbox_image: list[float]             # [x, y, w, h] i px
    centroid_pdf: list[float]
    centroid_image: list[float]
    total_tile_area_pt2: float
    estimated_zone_area_m2: float | None
    grid_cells: int                     # antal unika grid-celler
    density: float                      # tiles / grid_cell — täthetsindikator


@dataclass
class ClassifiedRegion:
    """En klassificerad materialregion — kärnutputen från steg 5."""
    id: str
    page_number: int
    fill_color_hex: str
    material_status: MaterialStatus
    material_category: str              # "betongplattor", "gras", etc.
    material_label: str                 # rå legend-text
    color_confidence: float             # 0-1, baserat på legend-matchning
    patch_confidence: float             # 0-1, bildpatch-jämförelse
    combined_confidence: float          # vägt medelvärde
    cluster: SpatialCluster
    legend_item_id: str | None
    conflict_labels: list[str]          # om status="conflict"
    requires_human_review: bool
    review_reason: str | None
    area_m2: float | None


@dataclass
class HatchClassificationResult:
    pdf_path: str
    page_number: int
    scale_denom: float | None
    classified_regions: list[ClassifiedRegion] = field(default_factory=list)
    unmatched_colors: list[str] = field(default_factory=list)
    color_map: dict = field(default_factory=dict)   # hex → {material, confidence}
    summary: dict = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Steg 1: Bygg färg→legend-lookup från Step 3
# ---------------------------------------------------------------------------

def _build_color_lookup(step3_data: dict) -> dict[str, dict]:
    """
    Bygger lookup: hex_color → {material_category, label, confidence, item_id}.
    Hanterar konflikter (samma färg → flera material).
    """
    lookup: dict[str, list[dict]] = defaultdict(list)

    for item in step3_data.get("legend_items", []):
        hex_color = (item.get("fill_color_hex") or "").upper()
        if not hex_color:
            continue
        lookup[hex_color].append({
            "item_id": item["id"],
            "material_category": item.get("material_category", "okänd"),
            "label": item.get("label_clean", ""),
            "match_confidence": item.get("match_confidence", 0.0),
            "matched_hatch_tiles": item.get("matched_hatch_tiles", 0),
        })

    # Bygg final lookup med konfliktflagg
    result: dict[str, dict] = {}
    for hex_color, items in lookup.items():
        if len(items) == 1:
            it = items[0]
            result[hex_color] = {
                "status": "matched",
                "material_category": it["material_category"],
                "label": it["label"],
                "confidence": it["match_confidence"],
                "item_id": it["item_id"],
                "conflict_labels": [],
            }
        else:
            # Konflikt: välj posten med högst konfidans som primär
            best = max(items, key=lambda x: x["match_confidence"])
            result[hex_color] = {
                "status": "conflict",
                "material_category": best["material_category"],
                "label": best["label"],
                "confidence": best["match_confidence"] * 0.6,  # sänk p.g.a. konflikt
                "item_id": best["item_id"],
                "conflict_labels": [it["label"] for it in items if it != best],
            }

    return result


# ---------------------------------------------------------------------------
# Steg 2: Re-extrahera hatch-tile-centroids per färg
# ---------------------------------------------------------------------------

def _extract_tile_centroids(
    pdf_path: str,
    page_number: int,
    page_height: float,
) -> dict[str, list[tuple[float, float, float]]]:
    """
    Extraherar (cx, cy, area) för varje hatch-tile per färg.
    Returnerar: hex_color → [(cx_pt, cy_pt, area_pt2), ...]
    """
    color_tiles: dict[str, list] = defaultdict(list)

    for i, page in enumerate(extract_pages(pdf_path)):
        if i + 1 != page_number:
            continue

        for obj in page:
            obj_type = type(obj).__name__
            if obj_type not in ("LTCurve", "LTRect"):
                continue
            if not getattr(obj, "fill", False):
                continue

            x0, y0, x1, y1 = obj.bbox
            area = (x1 - x0) * (y1 - y0)

            if area < TILE_MIN_AREA or area > TILE_MAX_AREA:
                continue

            hex_color = _pdfminer_color_to_hex(getattr(obj, "non_stroking_color", None))
            if hex_color is None:
                continue

            cx = (x0 + x1) / 2
            cy = (y0 + y1) / 2
            color_tiles[hex_color].append((cx, cy, area))

        break  # bara en sida

    return color_tiles


# ---------------------------------------------------------------------------
# Steg 3: Spatial klustring via grid-flood-fill
# ---------------------------------------------------------------------------

def _grid_cluster(
    tiles: list[tuple[float, float, float]],
    grid_size: float = CLUSTER_GRID_PT,
) -> list[list[tuple[float, float, float]]]:
    """
    Grupperar tiles till kluster via grid-baserad flood-fill.
    Tiles inom samma eller angränsande grid-cell tillhör samma kluster.

    Returns: lista av kluster, varje kluster = lista av (cx, cy, area).
    """
    if not tiles:
        return []

    # Snap tiles till grid
    grid: dict[tuple[int, int], list[tuple[float, float, float]]] = defaultdict(list)
    for tile in tiles:
        cx, cy, area = tile
        gx = int(cx / grid_size)
        gy = int(cy / grid_size)
        grid[(gx, gy)].append(tile)

    # Flood-fill: hitta sammanhängande grid-celler
    visited: set[tuple[int, int]] = set()
    clusters: list[list[tuple[float, float, float]]] = []

    def _flood(cell: tuple[int, int]) -> list[tuple[float, float, float]]:
        stack = [cell]
        cluster_tiles = []
        while stack:
            c = stack.pop()
            if c in visited or c not in grid:
                continue
            visited.add(c)
            cluster_tiles.extend(grid[c])
            gx, gy = c
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    neighbor = (gx + dx, gy + dy)
                    if neighbor not in visited and neighbor in grid:
                        stack.append(neighbor)
        return cluster_tiles

    for cell in grid:
        if cell not in visited:
            cluster = _flood(cell)
            if cluster:
                clusters.append(cluster)

    # Sortera kluster: störst (flest tiles) först
    clusters.sort(key=lambda c: -len(c))
    return clusters


def _cluster_to_spatial(
    cluster_tiles: list[tuple[float, float, float]],
    page_height: float,
    scale_denom: float | None,
    color_hex: str,
    cluster_id: str,
    grid_size: float = CLUSTER_GRID_PT,
) -> SpatialCluster:
    """Konverterar en lista tiles till SpatialCluster."""
    xs = [t[0] for t in cluster_tiles]
    ys = [t[1] for t in cluster_tiles]
    areas = [t[2] for t in cluster_tiles]

    x0, y0 = min(xs), min(ys)
    x1, y1 = max(xs), max(ys)
    cx = sum(xs) / len(xs)
    cy = sum(ys) / len(ys)
    total_area_pt2 = sum(areas)

    # Räkna unika grid-celler
    grid_cells = len({(int(t[0] / grid_size), int(t[1] / grid_size))
                      for t in cluster_tiles})

    density = len(cluster_tiles) / max(grid_cells, 1)

    # Uppskattad zon-area i m²:
    # Vi använder bboxarea × density-korrektionsfaktor
    # (faktisk yta är inte = summan av tile-areor för hatch-mönster)
    zone_area_m2 = None
    if scale_denom:
        # Beräkna bboxarea × fyllnadsgrad (density/max_density)
        bbox_area_pt2 = (x1 - x0) * (y1 - y0)
        mm_per_pt = PT_TO_MM * scale_denom
        m_per_pt = mm_per_pt / 1000.0
        zone_area_m2 = round(bbox_area_pt2 * (m_per_pt ** 2), 3)

    # Bildkoordinater
    scale = PT_TO_PX
    x_img = round(x0 * scale, 1)
    y_img = round((page_height - y1) * scale, 1)
    w_img = round((x1 - x0) * scale, 1)
    h_img = round((y1 - y0) * scale, 1)

    cx_img = round(cx * scale, 1)
    cy_img = round((page_height - cy) * scale, 1)

    return SpatialCluster(
        cluster_id=cluster_id,
        fill_color_hex=color_hex,
        tile_count=len(cluster_tiles),
        bbox_pdf=[round(x0, 1), round(y0, 1), round(x1, 1), round(y1, 1)],
        bbox_image=[x_img, y_img, w_img, h_img],
        centroid_pdf=[round(cx, 1), round(cy, 1)],
        centroid_image=[cx_img, cy_img],
        total_tile_area_pt2=round(total_area_pt2, 2),
        estimated_zone_area_m2=zone_area_m2,
        grid_cells=grid_cells,
        density=round(density, 2),
    )


# ---------------------------------------------------------------------------
# Steg 4: Bildpatch-jämförelse
# ---------------------------------------------------------------------------

def _extract_image_patch(
    img: Image.Image,
    cx_px: float,
    cy_px: float,
    size: int = PATCH_SIZE_PX,
) -> Image.Image | None:
    """Extraherar en kvadratisk patch ur PNG-bilden."""
    w, h = img.size
    half = size // 2
    x0 = max(0, int(cx_px) - half)
    y0 = max(0, int(cy_px) - half)
    x1 = min(w, x0 + size)
    y1 = min(h, y0 + size)
    if x1 - x0 < 4 or y1 - y0 < 4:
        return None
    return img.crop((x0, y0, x1, y1))


def _patch_mean_color(patch: Image.Image) -> tuple[float, float, float]:
    """Beräknar medelfärg för en patch (RGB)."""
    rgb = patch.convert("RGB")
    pixels = list(rgb.getdata())
    n = len(pixels)
    if n == 0:
        return (0.0, 0.0, 0.0)
    r = sum(p[0] for p in pixels) / n
    g = sum(p[1] for p in pixels) / n
    b = sum(p[2] for p in pixels) / n
    return (r, g, b)


def _patch_similarity(
    patch_a: Image.Image | None,
    patch_b: Image.Image | None,
) -> float:
    """
    Jämför två patches. Returnerar likhetsscore 0-1.
    Baserat på medelfärgdistans i RGB.
    """
    if patch_a is None or patch_b is None:
        return 0.5  # oklart
    ca = _patch_mean_color(patch_a)
    cb = _patch_mean_color(patch_b)
    dist = math.sqrt(sum((a - b) ** 2 for a, b in zip(ca, cb)))
    max_dist = math.sqrt(3 * 255 ** 2)  # max möjliga RGB-distans
    similarity = 1.0 - (dist / max_dist)
    return round(similarity, 3)


def _build_legend_patch_cache(
    step3_data: dict,
    rendered_png: Image.Image,
    page_height_pt: float,
) -> dict[str, Image.Image]:
    """
    Extraherar bildpatch för varje legend-item från renderad PNG.
    Returnerar: hex_color → patch.
    """
    cache: dict[str, Image.Image] = {}
    for item in step3_data.get("legend_items", []):
        hex_color = (item.get("fill_color_hex") or "").upper()
        bbox = item.get("patch_bbox_pdf", [])
        if not bbox or len(bbox) < 4 or not hex_color:
            continue
        x0_pt, y0_pt, x1_pt, y1_pt = bbox
        cx_pt = (x0_pt + x1_pt) / 2
        cy_pt = (y0_pt + y1_pt) / 2
        cx_px = cx_pt * PT_TO_PX
        cy_px = (page_height_pt - cy_pt) * PT_TO_PX
        patch = _extract_image_patch(rendered_png, cx_px, cy_px)
        if patch and hex_color not in cache:
            cache[hex_color] = patch
    return cache


# ---------------------------------------------------------------------------
# Konfidensmodell
# ---------------------------------------------------------------------------

def _combined_confidence(
    color_conf: float,
    patch_conf: float,
    status: MaterialStatus,
) -> float:
    if status == "unmatched":
        return 0.0
    if status == "below_threshold":
        return 0.0
    # Patch-konfidensen väger in men är svagare (bildkvalitet varierar)
    combined = color_conf * 0.7 + patch_conf * 0.3
    return round(min(1.0, max(0.0, combined)), 3)


# ---------------------------------------------------------------------------
# Huvudfunktion
# ---------------------------------------------------------------------------

def classify_hatches(
    pdf_path: str,
    page_number: int = 1,
    step2_json_path: str | None = None,
    step3_json_path: str | None = None,
    rendered_png_path: str | None = None,
    scale_denom: float | None = None,
    min_tiles: int = MIN_TILES_PER_CLUSTER,
) -> HatchClassificationResult:
    """
    Klassificerar hatch-regioner i ritningen.

    Args:
        pdf_path:           Sökväg till PDF.
        page_number:        Sidnummer.
        step2_json_path:    step2_result.json (för scale_denom).
        step3_json_path:    step3_result.json (för legend).
        rendered_png_path:  Renderad PNG (för bildpatch-jämförelse).
        scale_denom:        Skalans nämnare (override step2).
        min_tiles:          Min tiles för att inkludera kluster.

    Returns:
        HatchClassificationResult.
    """
    pdf_path = os.path.abspath(pdf_path)
    result = HatchClassificationResult(
        pdf_path=pdf_path,
        page_number=page_number,
        scale_denom=scale_denom,
    )

    # --- Ladda step2 och step3 ---
    step2_data = {}
    if step2_json_path and os.path.exists(step2_json_path):
        with open(step2_json_path, encoding="utf-8") as f:
            step2_data = json.load(f)
        if scale_denom is None:
            result.scale_denom = step2_data.get("scale_denom")
            scale_denom = result.scale_denom

    step3_data = {}
    if step3_json_path and os.path.exists(step3_json_path):
        with open(step3_json_path, encoding="utf-8") as f:
            step3_data = json.load(f)

    # --- Bygg färg-lookup ---
    color_lookup = _build_color_lookup(step3_data)

    # --- Ladda renderad PNG ---
    rendered_png: Image.Image | None = None
    if rendered_png_path and os.path.exists(rendered_png_path):
        rendered_png = Image.open(rendered_png_path).convert("RGB")

    # --- Hitta sidan för page_height ---
    page_height_pt = 842.0  # default A3
    for i, page in enumerate(extract_pages(pdf_path)):
        if i + 1 == page_number:
            page_height_pt = page.height
            break

    # --- Extrahera legend-patches för bildpatch-jämförelse ---
    legend_patch_cache: dict[str, Image.Image] = {}
    if rendered_png is not None:
        legend_patch_cache = _build_legend_patch_cache(
            step3_data, rendered_png, page_height_pt
        )

    # --- Re-extrahera hatch-tile centroids ---
    color_tiles = _extract_tile_centroids(pdf_path, page_number, page_height_pt)

    if not color_tiles:
        result.warnings.append("Inga hatch-tiles hittades i PDF:en.")
        return result

    # --- Klustrera per färg och klassificera ---
    region_counter = 0
    color_summary: dict[str, dict] = {}
    unmatched = []

    for hex_color, tiles in sorted(color_tiles.items()):
        if len(tiles) < min_tiles:
            continue

        # Spatial klustring
        clusters_raw = _grid_cluster(tiles)

        for cluster_idx, cluster_tiles in enumerate(clusters_raw):
            if len(cluster_tiles) < min_tiles:
                continue

            region_counter += 1
            cluster_id = f"cl_{hex_color[1:]}_{cluster_idx:02d}"
            cluster = _cluster_to_spatial(
                cluster_tiles, page_height_pt, scale_denom,
                hex_color, cluster_id,
            )

            # Färgmatchning
            hex_upper = hex_color.upper()
            match = color_lookup.get(hex_upper)

            if match:
                status = match["status"]
                material_category = match["material_category"]
                material_label = match["label"]
                color_conf = match["confidence"]
                legend_item_id = match["item_id"]
                conflict_labels = match["conflict_labels"]
            else:
                status = "unmatched"
                material_category = "okänd"
                material_label = ""
                color_conf = 0.0
                legend_item_id = None
                conflict_labels = []
                if hex_upper not in unmatched:
                    unmatched.append(hex_upper)

            # Bildpatch-konfidensen
            patch_conf = 0.5  # default (neutral) om ingen bild
            if rendered_png is not None and hex_upper in legend_patch_cache:
                legend_patch = legend_patch_cache[hex_upper]
                cx_px, cy_px = cluster.centroid_image
                zone_patch = _extract_image_patch(rendered_png, cx_px, cy_px)
                patch_conf = _patch_similarity(zone_patch, legend_patch)

            combined_conf = _combined_confidence(color_conf, patch_conf, status)

            requires_review = (
                status in ("conflict", "unmatched")
                or combined_conf < 0.50
            )
            review_reason = None
            if status == "conflict":
                review_reason = (
                    f"Samma färg ({hex_color}) används av flera legend-poster: "
                    + ", ".join([material_label] + conflict_labels)
                )
            elif status == "unmatched":
                review_reason = (
                    f"Färgen {hex_color} ({len(tiles)} tiles) saknar "
                    "legend-matchning."
                )
            elif combined_conf < 0.50:
                review_reason = f"Låg konfidans ({combined_conf:.2f})."

            region = ClassifiedRegion(
                id=f"region_{region_counter:04d}",
                page_number=page_number,
                fill_color_hex=hex_color,
                material_status=status,
                material_category=material_category,
                material_label=material_label,
                color_confidence=round(color_conf, 3),
                patch_confidence=round(patch_conf, 3),
                combined_confidence=combined_conf,
                cluster=cluster,
                legend_item_id=legend_item_id,
                conflict_labels=conflict_labels,
                requires_human_review=requires_review,
                review_reason=review_reason,
                area_m2=cluster.estimated_zone_area_m2,
            )
            result.classified_regions.append(region)

            # Uppdatera sammanfattning per färg
            if hex_upper not in color_summary:
                color_summary[hex_upper] = {
                    "material_category": material_category,
                    "material_label": material_label[:40],
                    "status": status,
                    "combined_confidence": combined_conf,
                    "total_tiles": 0,
                    "cluster_count": 0,
                    "total_area_m2": 0.0,
                }
            color_summary[hex_upper]["total_tiles"] += len(cluster_tiles)
            color_summary[hex_upper]["cluster_count"] += 1
            if cluster.estimated_zone_area_m2:
                color_summary[hex_upper]["total_area_m2"] += cluster.estimated_zone_area_m2

    # Sortera regioner: högst konfidans + störst area först
    result.classified_regions.sort(
        key=lambda r: (-r.combined_confidence, -(r.area_m2 or 0))
    )

    result.unmatched_colors = unmatched
    result.color_map = color_summary

    # Sammanfattning
    n_matched = sum(1 for r in result.classified_regions if r.material_status == "matched")
    n_conflict = sum(1 for r in result.classified_regions if r.material_status == "conflict")
    n_unmatched = sum(1 for r in result.classified_regions if r.material_status == "unmatched")
    n_review = sum(1 for r in result.classified_regions if r.requires_human_review)

    result.summary = {
        "total_regions": len(result.classified_regions),
        "matched": n_matched,
        "conflict": n_conflict,
        "unmatched": n_unmatched,
        "requires_human_review": n_review,
        "unique_colors": len(color_summary),
    }

    if unmatched:
        result.warnings.append(
            f"{len(unmatched)} färger saknar legend-matchning: "
            + ", ".join(unmatched[:5])
            + ("..." if len(unmatched) > 5 else "")
        )

    return result


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Step 5: Klassificera hatch-regioner i CAD-PDF."
    )
    parser.add_argument("pdf", help="Sökväg till PDF")
    parser.add_argument("--page", type=int, default=1)
    parser.add_argument("--step2-json", default=None)
    parser.add_argument("--step3-json", default=None)
    parser.add_argument("--png", default=None, help="Renderad PNG (från step 1)")
    parser.add_argument("--scale", type=float, default=None)
    parser.add_argument("--output-dir", default="./output")
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()

    result = classify_hatches(
        pdf_path=args.pdf,
        page_number=args.page,
        step2_json_path=args.step2_json,
        step3_json_path=args.step3_json,
        rendered_png_path=args.png,
        scale_denom=args.scale,
    )

    output = json.dumps(asdict(result), indent=2 if args.pretty else None, ensure_ascii=False)
    print(output)

    os.makedirs(args.output_dir, exist_ok=True)
    json_path = os.path.join(args.output_dir, "step5_result.json")
    with open(json_path, "w", encoding="utf-8") as f:
        f.write(json.dumps(asdict(result), ensure_ascii=False))
    print(f"\n[Sparat till {json_path}]", file=sys.stderr)


if __name__ == "__main__":
    main()
