"""
AI Pipeline - Steg 2: PDF Vektorextraktion
===========================================
Syfte:
    Extrahera all geometri ur en CAD-exporterad vektor-PDF.
    Separera: area-kandidater, hatch-tiles, linjer, text-positioner.
    Konvertera PDF-koordinater till bildkoordinater (y-flip).
    Beräkna verkliga ytor i m² via skala.

Kräver:
    - pdfminer.six (pip install pdfminer.six)
    - shapely (pip install shapely) - för polygon-operationer

Arkitekturkommentar (från ritning.pdf-analys):
    - 23 688 fyllda trianglar = CAD hatch exporterat som mikropolygoner
    - 24 239 korta linjer = CAD hatch som diagonallinjer (svarta)
    - 209 stora fyllda polygoner = faktiska ytgränser
    - Dubbletter förekommer: samma bbox med 4 och 5 punkter
      → deduplicering krävs
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
from pdfminer.layout import (
    LTChar,
    LTCurve,
    LTFigure,
    LTLine,
    LTRect,
    LTTextBox,
    LTTextLine,
)

# ---------------------------------------------------------------------------
# Konstanter och tröskelvärden
# ---------------------------------------------------------------------------

# Minsta area (pt²) för att räknas som area-kandidat, inte hatch-tile
# 1pt = 0,353mm → 200pt² ≈ 25mm² → ungefär en liten sten/platta
AREA_THRESHOLD_PT2 = 200.0

# Minsta linjelängd (pt) för att räknas som strukturlinje, inte hatch-linje
LINE_THRESHOLD_PT = 20.0

# PDF-koordinater: origo nere till vänster, y uppåt
# Bild-koordinater: origo uppe till vänster, y nedåt
PT_TO_MM = 25.4 / 72.0
DPI = 300
PT_TO_PX = DPI / 72.0   # vid 300 DPI: 1pt = 4.167px

# Bbox-deduplicering: om två polygoner har samma bbox inom tolerans → duplikat
BBOX_DEDUP_TOLERANCE = 0.5  # pt

# ---------------------------------------------------------------------------
# Färgverktyg
# ---------------------------------------------------------------------------

def _normalize_color(c) -> tuple[float, ...] | None:
    """Konverterar pdfminer-färg till normaliserad RGB-tuple (0-1 range)."""
    if c is None:
        return None
    if isinstance(c, (int, float)):
        # Gråskala
        v = float(c)
        return (v, v, v)
    if isinstance(c, (list, tuple)):
        if len(c) == 1:
            v = float(c[0])
            return (v, v, v)
        if len(c) == 3:
            return tuple(float(x) for x in c)
        if len(c) == 4:
            # CMYK → RGB (approximation)
            C, M, Y, K = [float(x) for x in c]
            r = (1 - C) * (1 - K)
            g = (1 - M) * (1 - K)
            b = (1 - Y) * (1 - K)
            return (r, g, b)
    return None


def _color_to_hex(c: tuple[float, ...] | None) -> str | None:
    if c is None:
        return None
    r, g, b = [max(0, min(1, x)) for x in c[:3]]
    return "#{:02X}{:02X}{:02X}".format(int(r * 255), int(g * 255), int(b * 255))


def _color_key(c: tuple[float, ...] | None, precision: int = 3) -> str:
    """Skapar en hashbar nyckel från en färg för gruppering."""
    if c is None:
        return "none"
    return ",".join(f"{round(x, precision)}" for x in c)


# ---------------------------------------------------------------------------
# Koordinatkonvertering
# ---------------------------------------------------------------------------

def _flip_y(y: float, page_height: float) -> float:
    """Konverterar PDF y-koordinat till bildkoordinat."""
    return page_height - y


def _pts_to_image_coords(
    pts: list[tuple[float, float]],
    page_height: float,
    scale: float = PT_TO_PX,
) -> list[list[float]]:
    """Konverterar PDF-punktlista till bildkoordinater i px."""
    result = []
    for x, y in pts:
        px = round(x * scale, 2)
        py = round(_flip_y(y, page_height) * scale, 2)
        result.append([px, py])
    return result


def _bbox_to_image(bbox: tuple, page_height: float, scale: float = PT_TO_PX) -> list[float]:
    x0, y0, x1, y1 = bbox
    return [
        round(x0 * scale, 2),
        round(_flip_y(y1, page_height) * scale, 2),   # y-flip: y1 → top
        round((x1 - x0) * scale, 2),
        round((y1 - y0) * scale, 2),
    ]  # [x, y, width, height] i bildkoordinater


# ---------------------------------------------------------------------------
# Areaberäkning
# ---------------------------------------------------------------------------

def _polygon_area_pt2(pts: list[tuple[float, float]]) -> float:
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


def _area_m2(area_pt2: float, scale_denom: float) -> float:
    """
    Konverterar pt² (PDF-koordinater) till verkliga m².
    scale_denom: nämnaren i skalan, t.ex. 200 för 1:200
    """
    # 1 pt = 25.4/72 mm papper → i verkligheten = scale_denom × 25.4/72 mm
    mm_per_pt = (PT_TO_MM * scale_denom)
    m_per_pt = mm_per_pt / 1000.0
    return round(area_pt2 * (m_per_pt ** 2), 4)


# ---------------------------------------------------------------------------
# Dataklasser
# ---------------------------------------------------------------------------

@dataclass
class AreaCandidate:
    """En potential yta/region från ritningen."""
    id: str
    page_number: int
    pts_pdf: list[list[float]]          # koordinater i PDF-punkter
    pts_image: list[list[float]]        # koordinater i bildpixlar (300 DPI)
    bbox_pdf: list[float]               # [x0, y0, x1, y1] i pt
    bbox_image: list[float]             # [x, y, w, h] i px (bildkoord)
    fill_color_rgb: tuple | None
    fill_color_hex: str | None
    stroke_color_rgb: tuple | None
    stroke_color_hex: str | None
    stroke_width: float
    area_pt2: float
    area_m2: float | None               # None om ingen skala känd
    point_count: int
    is_closed: bool
    object_type: str                    # "LTCurve" | "LTRect"
    confidence: float = 1.0            # 1.0 = direkt från vektor


@dataclass
class HatchTileGroup:
    """Grupp av hatch-tiles (mikropolygoner) med samma färg."""
    color_key: str
    fill_color_rgb: tuple | None
    fill_color_hex: str | None
    tile_count: int
    total_area_pt2: float
    total_area_m2: float | None
    bbox_pdf: list[float]               # bounding box för hela gruppen
    centroid_pdf: list[float]           # [cx, cy] i PDF-koordinater
    centroid_image: list[float]         # [cx, cy] i bildpixlar


@dataclass
class StructureLine:
    """En strukturell linje (gräns, kantsten, etc.) - ej hatch-linjer."""
    id: str
    page_number: int
    pts_pdf: list[list[float]]
    pts_image: list[list[float]]
    bbox_pdf: list[float]
    bbox_image: list[float]
    stroke_color_rgb: tuple | None
    stroke_color_hex: str | None
    stroke_width: float
    length_pt: float
    length_m: float | None
    angle_deg: float                    # 0=horisontell, 90=vertikal


@dataclass
class HatchLineGroup:
    """Grupp av korta hatch-linjer med samma färg."""
    color_key: str
    stroke_color_rgb: tuple | None
    stroke_color_hex: str | None
    line_count: int
    total_length_pt: float
    bbox_pdf: list[float]
    centroid_pdf: list[float]
    centroid_image: list[float]


@dataclass
class VectorExtractionResult:
    pdf_path: str
    page_number: int
    page_width_pt: float
    page_height_pt: float
    scale_notation: str | None
    scale_denom: float | None
    px_per_pt: float
    area_candidates: list[AreaCandidate] = field(default_factory=list)
    hatch_tile_groups: list[HatchTileGroup] = field(default_factory=list)
    structure_lines: list[StructureLine] = field(default_factory=list)
    hatch_line_groups: list[HatchLineGroup] = field(default_factory=list)
    raw_stats: dict = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Deduplicering
# ---------------------------------------------------------------------------

def _bbox_key(bbox: tuple, tol: float = BBOX_DEDUP_TOLERANCE) -> tuple:
    """Rundar av bbox till nearest tol för deduplicering."""
    return tuple(round(v / tol) * tol for v in bbox)


# ---------------------------------------------------------------------------
# Linjelängd och vinkel
# ---------------------------------------------------------------------------

def _line_length(pts: list[tuple[float, float]]) -> float:
    if len(pts) < 2:
        return 0.0
    dx = pts[-1][0] - pts[0][0]
    dy = pts[-1][1] - pts[0][1]
    return math.sqrt(dx * dx + dy * dy)


def _line_angle(pts: list[tuple[float, float]]) -> float:
    if len(pts) < 2:
        return 0.0
    dx = pts[-1][0] - pts[0][0]
    dy = pts[-1][1] - pts[0][1]
    return round(math.degrees(math.atan2(dy, dx)) % 180, 1)


# ---------------------------------------------------------------------------
# Polygonstängning
# ---------------------------------------------------------------------------

def _is_closed(pts: list[tuple[float, float]], tol: float = 1.0) -> bool:
    if len(pts) < 3:
        return False
    dx = abs(pts[0][0] - pts[-1][0])
    dy = abs(pts[0][1] - pts[-1][1])
    return dx <= tol and dy <= tol


# ---------------------------------------------------------------------------
# Huvudfunktion
# ---------------------------------------------------------------------------

def extract_vectors(
    pdf_path: str,
    page_number: int = 1,
    scale_notation: str | None = None,
    scale_denom: float | None = None,
    area_threshold_pt2: float = AREA_THRESHOLD_PT2,
    line_threshold_pt: float = LINE_THRESHOLD_PT,
) -> VectorExtractionResult:
    """
    Extraherar vektorgeometri från en PDF-sida.

    Args:
        pdf_path:           Sökväg till PDF.
        page_number:        Sidnummer (1-indexerat).
        scale_notation:     t.ex. "1:200" (från Step 1).
        scale_denom:        Nämnaren (t.ex. 200.0).
        area_threshold_pt2: Minsta area för area-kandidat vs hatch-tile.
        line_threshold_pt:  Minsta längd för strukturlinje vs hatch-linje.

    Returns:
        VectorExtractionResult med kategoriserad geometri.
    """
    pdf_path = os.path.abspath(pdf_path)

    result = VectorExtractionResult(
        pdf_path=pdf_path,
        page_number=page_number,
        page_width_pt=0.0,
        page_height_pt=0.0,
        scale_notation=scale_notation,
        scale_denom=scale_denom,
        px_per_pt=PT_TO_PX,
    )

    # --- Hitta rätt sida ---
    target_page = None
    for i, page in enumerate(extract_pages(pdf_path)):
        if i + 1 == page_number:
            target_page = page
            break

    if target_page is None:
        result.warnings.append(f"Sida {page_number} hittades inte i PDF:en.")
        return result

    page_h = target_page.height
    page_w = target_page.width
    result.page_width_pt = round(page_w, 2)
    result.page_height_pt = round(page_h, 2)

    # --- Räknare för statistik ---
    stats = {
        "total_curves": 0,
        "total_lines": 0,
        "total_rects": 0,
        "area_candidates_raw": 0,
        "hatch_tiles_raw": 0,
        "structure_lines_raw": 0,
        "hatch_lines_raw": 0,
        "duplicates_removed": 0,
    }

    # --- Temporära samlingar ---
    seen_area_bboxes: set[tuple] = set()
    area_counter = 0
    line_counter = 0

    # Hatch-tile-grupper: color_key → [area_pt2, bbox_list, pts_list]
    hatch_tile_data: dict[str, dict] = defaultdict(lambda: {
        "color_rgb": None,
        "areas": [],
        "bboxes": [],
        "centroids": [],
    })

    # Hatch-linje-grupper: color_key → [length, bbox_list, pts_list]
    hatch_line_data: dict[str, dict] = defaultdict(lambda: {
        "color_rgb": None,
        "lengths": [],
        "bboxes": [],
        "centroids": [],
    })

    # --- Iterera objekt ---
    for obj in target_page:
        obj_type = type(obj).__name__

        # ================================================================
        # KURVOR / REKTANGLAR (fylld geometri)
        # ================================================================
        if obj_type in ("LTCurve", "LTRect", "LTLine"):

            if obj_type == "LTLine":
                # LTLine är subklass av LTCurve men behandlas separat
                stats["total_lines"] += 1
                length = _line_length(obj.pts)

                stroke_rgb = _normalize_color(getattr(obj, "stroking_color", None))

                if length >= line_threshold_pt:
                    # Strukturlinje
                    stats["structure_lines_raw"] += 1
                    line_counter += 1
                    pts_pdf = [[round(p[0], 3), round(p[1], 3)] for p in obj.pts]
                    pts_img = _pts_to_image_coords(obj.pts, page_h)
                    length_m = None
                    if scale_denom:
                        length_m = round(
                            length * PT_TO_MM * scale_denom / 1000.0, 3
                        )
                    result.structure_lines.append(
                        StructureLine(
                            id=f"line_{line_counter:05d}",
                            page_number=page_number,
                            pts_pdf=pts_pdf,
                            pts_image=pts_img,
                            bbox_pdf=[round(v, 3) for v in obj.bbox],
                            bbox_image=_bbox_to_image(obj.bbox, page_h),
                            stroke_color_rgb=stroke_rgb,
                            stroke_color_hex=_color_to_hex(stroke_rgb),
                            stroke_width=round(getattr(obj, "linewidth", 0.0), 3),
                            length_pt=round(length, 3),
                            length_m=length_m,
                            angle_deg=_line_angle(obj.pts),
                        )
                    )
                else:
                    # Hatch-linje
                    stats["hatch_lines_raw"] += 1
                    ckey = _color_key(stroke_rgb)
                    hatch_line_data[ckey]["color_rgb"] = stroke_rgb
                    hatch_line_data[ckey]["lengths"].append(length)
                    x0, y0, x1, y1 = obj.bbox
                    hatch_line_data[ckey]["bboxes"].append([x0, y0, x1, y1])
                    cx = (x0 + x1) / 2
                    cy = (y0 + y1) / 2
                    hatch_line_data[ckey]["centroids"].append([cx, cy])

            else:
                # LTCurve eller LTRect (ej LTLine)
                if obj_type == "LTRect":
                    stats["total_rects"] += 1
                else:
                    stats["total_curves"] += 1

                # Beräkna area via Shoelace-formeln (exaktare än bbox)
                area_pt2 = _polygon_area_pt2(obj.pts)
                # Fallback till bbox-area om Shoelace ger 0
                if area_pt2 < 0.01:
                    x0, y0, x1, y1 = obj.bbox
                    area_pt2 = (x1 - x0) * (y1 - y0)

                fill_rgb = _normalize_color(getattr(obj, "non_stroking_color", None))
                stroke_rgb = _normalize_color(getattr(obj, "stroking_color", None))
                is_filled = getattr(obj, "fill", False)

                if area_pt2 >= area_threshold_pt2 and is_filled:
                    # --- Area-kandidat ---
                    # Deduplicering baserat på bbox
                    bkey = _bbox_key(obj.bbox)
                    if bkey in seen_area_bboxes:
                        stats["duplicates_removed"] += 1
                        continue
                    seen_area_bboxes.add(bkey)

                    stats["area_candidates_raw"] += 1
                    area_counter += 1

                    pts_pdf = [[round(p[0], 3), round(p[1], 3)] for p in obj.pts]
                    pts_img = _pts_to_image_coords(obj.pts, page_h)

                    area_m2 = None
                    if scale_denom:
                        area_m2 = _area_m2(area_pt2, scale_denom)

                    closed = _is_closed(obj.pts)
                    if not closed:
                        result.warnings.append(
                            f"Area-kandidat {area_counter:05d}: Polygon är ej sluten "
                            f"(avstånd start-slut kan kräva reparation)."
                        )

                    result.area_candidates.append(
                        AreaCandidate(
                            id=f"area_{area_counter:05d}",
                            page_number=page_number,
                            pts_pdf=pts_pdf,
                            pts_image=pts_img,
                            bbox_pdf=[round(v, 3) for v in obj.bbox],
                            bbox_image=_bbox_to_image(obj.bbox, page_h),
                            fill_color_rgb=fill_rgb,
                            fill_color_hex=_color_to_hex(fill_rgb),
                            stroke_color_rgb=stroke_rgb,
                            stroke_color_hex=_color_to_hex(stroke_rgb),
                            stroke_width=round(getattr(obj, "linewidth", 0.0), 3),
                            area_pt2=round(area_pt2, 2),
                            area_m2=area_m2,
                            point_count=len(obj.pts),
                            is_closed=closed,
                            object_type=obj_type,
                        )
                    )

                elif is_filled and fill_rgb is not None:
                    # --- Hatch-tile ---
                    stats["hatch_tiles_raw"] += 1
                    ckey = _color_key(fill_rgb)
                    hatch_tile_data[ckey]["color_rgb"] = fill_rgb
                    hatch_tile_data[ckey]["areas"].append(area_pt2)
                    x0, y0, x1, y1 = obj.bbox
                    hatch_tile_data[ckey]["bboxes"].append([x0, y0, x1, y1])
                    cx = (x0 + x1) / 2
                    cy = (y0 + y1) / 2
                    hatch_tile_data[ckey]["centroids"].append([cx, cy])

    # --- Bygg HatchTileGroups ---
    for ckey, data in hatch_tile_data.items():
        bboxes = data["bboxes"]
        centroids = data["centroids"]
        areas = data["areas"]
        color_rgb = data["color_rgb"]

        all_x0 = [b[0] for b in bboxes]
        all_y0 = [b[1] for b in bboxes]
        all_x1 = [b[2] for b in bboxes]
        all_y1 = [b[3] for b in bboxes]
        group_bbox = [min(all_x0), min(all_y0), max(all_x1), max(all_y1)]

        cx = sum(c[0] for c in centroids) / len(centroids)
        cy = sum(c[1] for c in centroids) / len(centroids)

        total_area = sum(areas)
        total_area_m2 = None
        if scale_denom:
            total_area_m2 = _area_m2(total_area, scale_denom)

        cx_img = round(cx * PT_TO_PX, 2)
        cy_img = round(_flip_y(cy, page_h) * PT_TO_PX, 2)

        result.hatch_tile_groups.append(
            HatchTileGroup(
                color_key=ckey,
                fill_color_rgb=color_rgb,
                fill_color_hex=_color_to_hex(color_rgb),
                tile_count=len(areas),
                total_area_pt2=round(total_area, 2),
                total_area_m2=total_area_m2,
                bbox_pdf=[round(v, 2) for v in group_bbox],
                centroid_pdf=[round(cx, 2), round(cy, 2)],
                centroid_image=[cx_img, cy_img],
            )
        )

    # Sortera hatch-grupper efter antal tiles (störst = viktigast material)
    result.hatch_tile_groups.sort(key=lambda g: -g.tile_count)

    # --- Bygg HatchLineGroups ---
    for ckey, data in hatch_line_data.items():
        bboxes = data["bboxes"]
        centroids = data["centroids"]
        lengths = data["lengths"]
        color_rgb = data["color_rgb"]

        all_x0 = [b[0] for b in bboxes]
        all_y0 = [b[1] for b in bboxes]
        all_x1 = [b[2] for b in bboxes]
        all_y1 = [b[3] for b in bboxes]
        group_bbox = [min(all_x0), min(all_y0), max(all_x1), max(all_y1)]

        cx = sum(c[0] for c in centroids) / len(centroids)
        cy = sum(c[1] for c in centroids) / len(centroids)
        cx_img = round(cx * PT_TO_PX, 2)
        cy_img = round(_flip_y(cy, page_h) * PT_TO_PX, 2)

        result.hatch_line_groups.append(
            HatchLineGroup(
                color_key=ckey,
                stroke_color_rgb=color_rgb,
                stroke_color_hex=_color_to_hex(color_rgb),
                line_count=len(lengths),
                total_length_pt=round(sum(lengths), 2),
                bbox_pdf=[round(v, 2) for v in group_bbox],
                centroid_pdf=[round(cx, 2), round(cy, 2)],
                centroid_image=[cx_img, cy_img],
            )
        )

    result.hatch_line_groups.sort(key=lambda g: -g.line_count)

    # --- Sortera area-kandidater: störst area först ---
    result.area_candidates.sort(key=lambda a: -a.area_pt2)

    # --- Sortera strukturlinjer: längst först ---
    result.structure_lines.sort(key=lambda l: -l.length_pt)

    result.raw_stats = stats
    return result


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Step 2: Extrahera vektorgeometri ur CAD-PDF."
    )
    parser.add_argument("pdf", help="Sökväg till PDF")
    parser.add_argument("--page", type=int, default=1, help="Sidnummer (default: 1)")
    parser.add_argument("--scale", type=float, default=None,
                        help="Skalans nämnare, t.ex. 200 för 1:200")
    parser.add_argument("--area-threshold", type=float, default=AREA_THRESHOLD_PT2,
                        help=f"Min area pt² för area-kandidat (default: {AREA_THRESHOLD_PT2})")
    parser.add_argument("--line-threshold", type=float, default=LINE_THRESHOLD_PT,
                        help=f"Min längd pt för strukturlinje (default: {LINE_THRESHOLD_PT})")
    parser.add_argument("--output-dir", default="./output")
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()

    scale_notation = f"1:{int(args.scale)}" if args.scale else None

    result = extract_vectors(
        pdf_path=args.pdf,
        page_number=args.page,
        scale_notation=scale_notation,
        scale_denom=args.scale,
        area_threshold_pt2=args.area_threshold,
        line_threshold_pt=args.line_threshold,
    )

    # Trunkera pts-listor för läsbarhet i CLI-output
    output_dict = asdict(result)
    for ac in output_dict["area_candidates"]:
        if len(ac["pts_pdf"]) > 8:
            ac["pts_pdf"] = ac["pts_pdf"][:4] + [["...truncated", len(ac["pts_pdf"]) - 4]]
            ac["pts_image"] = ac["pts_image"][:4] + [["...truncated"]]

    output = json.dumps(output_dict, indent=2 if args.pretty else None, ensure_ascii=False)
    print(output)

    os.makedirs(args.output_dir, exist_ok=True)
    json_path = os.path.join(args.output_dir, "step2_result.json")

    # Spara fullständig (ej trunkerad) version
    full_output = json.dumps(asdict(result), ensure_ascii=False)
    with open(json_path, "w", encoding="utf-8") as f:
        f.write(full_output)
    print(f"\n[Sparat till {json_path}]", file=sys.stderr)


if __name__ == "__main__":
    main()
