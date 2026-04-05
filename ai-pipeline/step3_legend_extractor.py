"""
AI Pipeline - Steg 3: Legend-detektion och -extraktion
=======================================================
Syfte:
    Hitta TECKENFÖRKLARING/legend i ritningen.
    Extrahera legend-poster: fill-patch → materialnamn.
    Koppla legend-färger till hatch-tile-grupper från Steg 2.

Metod (vektor-PDF):
    1. Hitta legend-header via textsökning.
    2. Identifiera patch-kolumn (x-range med upprepade fills).
    3. Identifiera text-kolumn (x-range till höger om patches).
    4. Matcha patch → text via närmaste centroid-y.
    5. Deduplicera patches (CAD exporterar varje patch dubbelt).
    6. Koppla till Step 2 hatch_tile_groups via hex-färg.

Kräver: pdfminer.six, Pillow
"""

from __future__ import annotations

import json
import math
import os
import re
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Literal

from pdfminer.high_level import extract_pages
from pdfminer.layout import LTCurve, LTFigure, LTLine, LTRect, LTTextBox

# ---------------------------------------------------------------------------
# Konstanter
# ---------------------------------------------------------------------------

# Minsta area för en legend-patch (pt²) — legend-rutor är typiskt 25×25pt
PATCH_MIN_AREA = 50.0

# Maximal centroid-y-avstånd för att matcha patch → text (pt)
MATCH_MAX_DIST = 80.0

# Nyckelord för legend-header (case-insensitive)
LEGEND_HEADER_KEYWORDS = [
    "teckenförklaring", "teckenf", "legend", "tecken",
    "symboler", "förklaring", "key plan",
]

# Material-normalisering: mappa svenska nyckelord → standardiserad kategori
MATERIAL_NORMALIZATION = {
    "betongplattor": "betongplattor",
    "betongplatt": "betongplattor",
    "plattrad": "betongplattor",
    "asfalt": "asfalt",
    "grus": "grus",
    "makadam": "makadam",
    "gräs": "gras",
    "grässådd": "gras_sadd",
    "grästorv": "gras_torv",
    "gräsarmering": "grasarmering",
    "plantering": "planteringsyta",
    "planteringbädd": "planteringsbädd",
    "sand": "sand",
    "kantsten": "kantsten",
    "kantstöd": "kantsten",
    "mur": "mur",
    "asfalt": "asfalt",
    "bark": "bark",
    "träd": "trad",
    "buske": "buske",
    "trappa": "trappa",
    "ramp": "ramp",
    "parkering": "parkering",
    "dagvatten": "dagvatten",
    "vattenyta": "vattenyta",
    "smågatsten": "smagatsten",
    "natursten": "natursten",
}


# ---------------------------------------------------------------------------
# Hjälpfunktioner
# ---------------------------------------------------------------------------

def _normalize_color(c) -> tuple[float, ...] | None:
    if c is None:
        return None
    if isinstance(c, (int, float)):
        v = float(c)
        return (v, v, v)
    if isinstance(c, (list, tuple)):
        if len(c) == 1:
            v = float(c[0])
            return (v, v, v)
        if len(c) == 3:
            return tuple(float(x) for x in c)
        if len(c) == 4:
            C, M, Y, K = [float(x) for x in c]
            return ((1 - C) * (1 - K), (1 - M) * (1 - K), (1 - Y) * (1 - K))
    return None


def _color_to_hex(c: tuple | None) -> str | None:
    if c is None:
        return None
    r, g, b = [max(0.0, min(1.0, x)) for x in c[:3]]
    return "#{:02X}{:02X}{:02X}".format(int(r * 255), int(g * 255), int(b * 255))


def _color_key(c: tuple | None, precision: int = 2) -> str:
    if c is None:
        return "none"
    return ",".join(f"{round(x, precision)}" for x in c)


def _normalize_label(text: str) -> tuple[str, str]:
    """
    Returnerar (label_clean, material_category).
    label_clean: rensad text utan överflödiga blankrader.
    material_category: normaliserad kategori om känd, annars 'okänd'.
    """
    label_clean = " ".join(text.split())
    lower = label_clean.lower()

    category = "okänd"
    for keyword, cat in MATERIAL_NORMALIZATION.items():
        if keyword in lower:
            category = cat
            break

    return label_clean, category


def _match_confidence(dist_pt: float, max_dist: float) -> float:
    """Beräknar matchningskonfidensen baserat på centroid-avstånd."""
    if dist_pt <= 5:
        return 1.0
    if dist_pt >= max_dist:
        return 0.0
    return round(1.0 - (dist_pt / max_dist), 3)


# ---------------------------------------------------------------------------
# Dataklasser
# ---------------------------------------------------------------------------

@dataclass
class LegendItem:
    id: str
    fill_color_rgb: tuple | None
    fill_color_hex: str | None
    label_raw: str
    label_clean: str
    material_category: str          # normaliserad kategori
    patch_bbox_pdf: list[float]     # [x0,y0,x1,y1] för legend-patchen
    text_bbox_pdf: list[float]      # [x0,y0,x1,y1] för texten
    match_dist_pt: float            # centroid-y-avstånd patch↔text
    match_confidence: float         # 0-1
    is_area_material: bool          # True = yta, False = linje/symbol
    matched_hatch_tiles: int        # antal hatch-tiles i steg 2 med denna färg
    matched_area_m2: float | None   # total area för denna färgklass


@dataclass
class ColorConflict:
    """Samma färg matchar fler än ett legend-item."""
    fill_color_hex: str
    matching_labels: list[str]
    note: str


@dataclass
class LegendExtractionResult:
    pdf_path: str
    page_number: int
    legend_header_found: bool
    legend_bbox_pdf: list[float] | None     # bounding box för hela legend-området
    legend_items: list[LegendItem] = field(default_factory=list)
    color_conflicts: list[ColorConflict] = field(default_factory=list)
    unmatched_patches: list[dict] = field(default_factory=list)
    unmatched_texts: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Legend-detektion
# ---------------------------------------------------------------------------

def _find_legend_header(
    page_objects: list,
) -> tuple[float | None, float | None, float | None, float | None]:
    """
    Söker efter TECKENFÖRKLARING-text.
    Returnerar (x0, y0, x1, y1) för header-texten, eller (None,)*4.
    """
    for obj in page_objects:
        if isinstance(obj, LTTextBox):
            text = obj.get_text().lower().strip()
            for kw in LEGEND_HEADER_KEYWORDS:
                if kw in text and len(text) < 50:  # kort text = rubrik
                    return obj.bbox
    return None, None, None, None


def _collect_legend_objects(
    page_objects: list,
    min_x: float,
    max_y: float | None = None,
    min_y: float = 0.0,
) -> tuple[list[dict], list[dict]]:
    """
    Samlar fills och texts i legend-regionen.

    Returns:
        (patches, texts) - listor med dicts.
    """
    patches = []
    texts = []

    for obj in page_objects:
        obj_type = type(obj).__name__

        # Fills/patches
        if obj_type in ("LTCurve", "LTRect") and getattr(obj, "fill", False):
            x0, y0, x1, y1 = obj.bbox
            if x0 < min_x:
                continue
            if max_y is not None and y1 > max_y:
                continue
            if y0 < min_y:
                continue
            area = (x1 - x0) * (y1 - y0)
            if area < PATCH_MIN_AREA:
                continue

            rgb = _normalize_color(getattr(obj, "non_stroking_color", None))
            # Filtrera bort vitt och svart (ram/bakgrund, ej material)
            if rgb and (sum(rgb) > 2.8 or sum(rgb) < 0.1):
                continue

            patches.append({
                "rgb": rgb,
                "hex": _color_to_hex(rgb),
                "x0": x0, "y0": y0, "x1": x1, "y1": y1,
                "cx": (x0 + x1) / 2,
                "cy": (y0 + y1) / 2,
                "area": area,
            })

        # Texter
        elif isinstance(obj, LTTextBox):
            x0, y0, x1, y1 = obj.bbox
            if x0 < min_x:
                continue
            if max_y is not None and y1 > max_y:
                continue
            if y0 < min_y:
                continue
            text = obj.get_text().strip()
            if not text:
                continue
            texts.append({
                "text": text,
                "x0": x0, "y0": y0, "x1": x1, "y1": y1,
                "cx": (x0 + x1) / 2,
                "cy": (y0 + y1) / 2,
            })

    return patches, texts


def _dedup_patches(patches: list[dict], cy_tol: float = 2.0) -> list[dict]:
    """
    Tar bort dubbla patches (CAD exporterar varje patch 2ggr).
    Behåller en per (color_key, cy_rounded).
    """
    seen: set[tuple] = set()
    unique = []
    for p in patches:
        key = (_color_key(p["rgb"]), round(p["cy"] / cy_tol) * cy_tol)
        if key not in seen:
            seen.add(key)
            unique.append(p)
    return unique


def _detect_patch_column(patches: list[dict]) -> tuple[float, float]:
    """
    Identifierar x-range för patch-kolumnen.
    Returnerar (min_x, max_x).
    """
    if not patches:
        return 0.0, 0.0
    xs = [p["cx"] for p in patches]
    return min(xs) - 5, max(xs) + 5


def _detect_text_column(texts: list[dict], patch_max_x: float) -> list[dict]:
    """
    Filtrerar texter till de som är till HÖGER om patches.
    Exkluderar legend-header och korta etiketter (N, skaltal etc.).
    """
    result = []
    for t in texts:
        if t["x0"] < patch_max_x:
            continue
        text = t["text"].strip()
        # Exkludera header, kompassrose-N, enstaka siffror
        if len(text) < 4:
            continue
        lower = text.lower()
        if any(kw in lower for kw in LEGEND_HEADER_KEYWORDS):
            continue
        result.append(t)
    return result


# ---------------------------------------------------------------------------
# Matchning patch → text
# ---------------------------------------------------------------------------

def _match_patches_to_texts(
    patches: list[dict],
    texts: list[dict],
    max_dist: float = MATCH_MAX_DIST,
) -> list[tuple[dict, dict | None, float]]:
    """
    Greedy matching: för varje patch, hitta närmaste text (cy-avstånd).
    Returnerar lista av (patch, matched_text_or_None, dist).
    Om samma text matchas av flera patches → flagga konflikt.
    """
    # Sortera patches uppifrån (högre y = högre i PDF)
    patches_sorted = sorted(patches, key=lambda p: -p["cy"])
    texts_remaining = list(texts)

    results = []
    for patch in patches_sorted:
        if not texts_remaining:
            results.append((patch, None, 999.0))
            continue

        best_idx = None
        best_dist = float("inf")
        for i, text in enumerate(texts_remaining):
            dist = abs(patch["cy"] - text["cy"])
            if dist < best_dist:
                best_dist = dist
                best_idx = i

        if best_dist <= max_dist and best_idx is not None:
            matched = texts_remaining.pop(best_idx)
            results.append((patch, matched, best_dist))
        else:
            results.append((patch, None, best_dist))

    return results, texts_remaining  # texterna kvar = omatchade


# ---------------------------------------------------------------------------
# Koppling till Step 2 hatch-data
# ---------------------------------------------------------------------------

def _load_step2_result(step2_json_path: str | None) -> dict:
    """Laddar Step 2-resultat om det finns."""
    if not step2_json_path or not os.path.exists(step2_json_path):
        return {}
    with open(step2_json_path, encoding="utf-8") as f:
        return json.load(f)


def _build_hatch_lookup(step2_data: dict) -> dict[str, dict]:
    """
    Bygger lookup: hex_color → {tile_count, total_area_m2}.
    """
    lookup: dict[str, dict] = {}
    for group in step2_data.get("hatch_tile_groups", []):
        hex_color = group.get("fill_color_hex")
        if hex_color:
            lookup[hex_color.upper()] = {
                "tile_count": group.get("tile_count", 0),
                "total_area_m2": group.get("total_area_m2"),
            }
    return lookup


# ---------------------------------------------------------------------------
# Huvudfunktion
# ---------------------------------------------------------------------------

def extract_legend(
    pdf_path: str,
    page_number: int = 1,
    step2_json_path: str | None = None,
    legend_min_x_frac: float = 0.65,   # Sök legend i höger 35% av sidan
    match_max_dist: float = MATCH_MAX_DIST,
) -> LegendExtractionResult:
    """
    Extraherar legend-poster från en ritnings-PDF.

    Args:
        pdf_path:           Sökväg till PDF.
        page_number:        Sidnummer (1-indexerat).
        step2_json_path:    Sökväg till Step 2 JSON för hatch-koppling.
        legend_min_x_frac:  Minsta x-fraktion för legend-sökning (0-1).
        match_max_dist:     Max centroid-y-avstånd för matchning (pt).

    Returns:
        LegendExtractionResult.
    """
    pdf_path = os.path.abspath(pdf_path)
    result = LegendExtractionResult(
        pdf_path=pdf_path,
        page_number=page_number,
        legend_header_found=False,
        legend_bbox_pdf=None,
    )

    # --- Ladda Step 2 hatch-data ---
    step2_data = _load_step2_result(step2_json_path)
    hatch_lookup = _build_hatch_lookup(step2_data)

    # --- Hitta sidan ---
    target_page = None
    for i, page in enumerate(extract_pages(pdf_path)):
        if i + 1 == page_number:
            target_page = page
            break

    if target_page is None:
        result.warnings.append(f"Sida {page_number} hittades inte.")
        return result

    page_h = target_page.height
    page_w = target_page.width
    page_objects = list(target_page)

    # --- Hitta legend-header ---
    hx0, hy0, hx1, hy1 = _find_legend_header(page_objects)

    if hx0 is None:
        result.warnings.append(
            "Ingen legend-header (TECKENFÖRKLARING) hittades. "
            "Söker i höger del av sidan ändå."
        )
        min_x = page_w * legend_min_x_frac
        max_y = page_h  # hela höjden
    else:
        result.legend_header_found = True
        # Legend finns UNDER header → max_y = header bottenkant
        min_x = min(hx0 * 0.9, page_w * legend_min_x_frac)
        max_y = hy1 + 5  # lite marginal ovanför header

    # --- Samla objekt i legend-region ---
    patches, texts = _collect_legend_objects(
        page_objects,
        min_x=min_x,
        max_y=max_y,
        min_y=200.0,   # Hoppa över titelblock längst ned
    )

    if not patches:
        result.warnings.append(
            f"Inga legend-patches hittades i region x>{min_x:.0f}. "
            "Kan vara en rent symbolbaserad legend utan ytfyllnad."
        )
        return result

    # --- Deduplicera patches ---
    patches_unique = _dedup_patches(patches)

    # --- Identifiera patch- och textkolumner ---
    patch_min_x, patch_max_x = _detect_patch_column(patches_unique)
    legend_texts = _detect_text_column(texts, patch_max_x)

    if not legend_texts:
        result.warnings.append(
            "Inga textlabels hittades till höger om patches. "
            "Kontrollera legend_min_x_frac-parametern."
        )

    # Beräkna legend-bounding box
    all_x0 = [p["x0"] for p in patches_unique] + [t["x0"] for t in legend_texts]
    all_y0 = [p["y0"] for p in patches_unique] + [t["y0"] for t in legend_texts]
    all_x1 = [p["x1"] for p in patches_unique] + [t["x1"] for t in legend_texts]
    all_y1 = [p["y1"] for p in patches_unique] + [t["y1"] for t in legend_texts]
    if all_x0:
        result.legend_bbox_pdf = [
            round(min(all_x0), 1), round(min(all_y0), 1),
            round(max(all_x1), 1), round(max(all_y1), 1),
        ]

    # --- Matcha patches → texts ---
    match_results, unmatched_texts = _match_patches_to_texts(
        patches_unique, legend_texts, max_dist=match_max_dist
    )

    # --- Bygg LegendItems ---
    color_to_items: dict[str, list[str]] = {}
    item_counter = 0

    for patch, text, dist in match_results:
        item_counter += 1
        hex_color = patch["hex"] or "#000000"
        hex_upper = hex_color.upper()

        label_raw = text["text"] if text else ""
        label_clean, mat_cat = _normalize_label(label_raw)
        confidence = _match_confidence(dist, match_max_dist) if text else 0.0

        hatch_info = hatch_lookup.get(hex_upper, {})

        is_area = hatch_info.get("tile_count", 0) > 0 or mat_cat != "okänd"

        item = LegendItem(
            id=f"leg_{item_counter:03d}",
            fill_color_rgb=patch["rgb"],
            fill_color_hex=hex_color,
            label_raw=label_raw,
            label_clean=label_clean,
            material_category=mat_cat,
            patch_bbox_pdf=[round(patch["x0"], 1), round(patch["y0"], 1),
                            round(patch["x1"], 1), round(patch["y1"], 1)],
            text_bbox_pdf=[round(text["x0"], 1), round(text["y0"], 1),
                           round(text["x1"], 1), round(text["y1"], 1)] if text else [],
            match_dist_pt=round(dist, 1),
            match_confidence=confidence,
            is_area_material=is_area,
            matched_hatch_tiles=hatch_info.get("tile_count", 0),
            matched_area_m2=hatch_info.get("total_area_m2"),
        )
        result.legend_items.append(item)

        # Spåra färgkonflikter
        if hex_upper not in color_to_items:
            color_to_items[hex_upper] = []
        if label_clean:
            color_to_items[hex_upper].append(label_clean[:40])

    # --- Identifiera färgkonflikter ---
    for hex_color, labels in color_to_items.items():
        unique_labels = list(dict.fromkeys(labels))  # bevara ordning, ta bort dupl
        if len(unique_labels) > 1:
            result.color_conflicts.append(
                ColorConflict(
                    fill_color_hex=hex_color,
                    matching_labels=unique_labels,
                    note=(
                        "Samma fyllnadsfärg används för flera legend-poster. "
                        "Dessa material kan inte skiljas via färg ensam — "
                        "hatch-mönster eller kontext krävs."
                    ),
                )
            )

    # --- Omatchade patches ---
    for patch, text, dist in match_results:
        if text is None:
            result.unmatched_patches.append({
                "hex": patch["hex"],
                "cy": round(patch["cy"], 1),
                "dist": round(dist, 1),
                "note": "Ingen text hittades inom max_dist",
            })

    # --- Omatchade texter ---
    for t in unmatched_texts:
        result.unmatched_texts.append(t["text"][:60])

    return result


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Step 3: Extrahera legend ur CAD-PDF."
    )
    parser.add_argument("pdf", help="Sökväg till PDF")
    parser.add_argument("--page", type=int, default=1)
    parser.add_argument("--step2-json", default=None,
                        help="Sökväg till step2_result.json")
    parser.add_argument("--max-dist", type=float, default=MATCH_MAX_DIST)
    parser.add_argument("--output-dir", default="./output")
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()

    result = extract_legend(
        pdf_path=args.pdf,
        page_number=args.page,
        step2_json_path=args.step2_json,
        match_max_dist=args.max_dist,
    )

    output = json.dumps(asdict(result), indent=2 if args.pretty else None, ensure_ascii=False)
    print(output)

    os.makedirs(args.output_dir, exist_ok=True)
    json_path = os.path.join(args.output_dir, "step3_result.json")
    with open(json_path, "w", encoding="utf-8") as f:
        f.write(output)
    print(f"\n[Sparat till {json_path}]", file=sys.stderr)


if __name__ == "__main__":
    main()
