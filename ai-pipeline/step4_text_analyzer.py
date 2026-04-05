"""
AI Pipeline - Steg 4: Textanalys och OCR
=========================================
Syfte:
    Extrahera ALL text ur ritningen och klassificera varje textpost.
    Identifiera skalangivelse, nordpil, höjdpunkter, material-labels.
    Koppla text-labels till geometriska regioner för steg 7.

Metod:
    Vektor-PDF: pdfminer (direkt textextraktion, sub-pixel precision).
    Raster-PDF: [FRAMTIDA] PaddleOCR eller Tesseract.

Texttyper som extraheras:
    legend_header    - TECKENFÖRKLARING-rubrik
    legend_entry     - legend-poster (material, symboler)
    scale            - skalangivelse (1:200, SKALA A3: 1:200)
    scalebar_label   - skalstångens siffror (0, 10, 20 Meters)
    north_arrow      - N-markering för nordriktning
    elevation        - höjdangivelser (GH +35,20)
    area_label       - fastighetsbeteckningar, stora textytor
    street_name      - gatunamn
    material_label   - materialtexter på ritningsytan
    dimension        - dimensionsmått (t.ex. 400X200X150MM)
    drawing_number   - ritningsnummer (M-03-001)
    title            - projektnamn, handlingstyp
    coordinate_sys   - koordinatsystem (SWEREF 99...)
    parking_count    - parkeringstal (24:28 = totalt:HC)
    property_ref     - fastighetsbeteckning (SYRENEN, LUNDVIVAN 2)
    other            - övrigt

Kräver: pdfminer.six
"""

from __future__ import annotations

import json
import os
import re
import sys
from dataclasses import asdict, dataclass, field
from typing import Literal

from pdfminer.high_level import extract_pages
from pdfminer.layout import LTChar, LTTextBox, LTTextLine

# ---------------------------------------------------------------------------
# Konstanter
# ---------------------------------------------------------------------------

DPI = 300
PT_TO_PX = DPI / 72.0

# Skalangivelse-mönster
SCALE_PATTERN = re.compile(r"1\s*[:/]\s*(\d{1,6})")
SKALA_PATTERN = re.compile(r"skala\s+[a-z0-9]+\s*[:/]\s*1\s*[:/]\s*(\d{1,6})", re.I)

# Höjdangivelse (GH = Golvhöjd / Markhöjd)
ELEVATION_PATTERN = re.compile(r"[Gg][Hh]\s*[+\-]\s*\d{2,3}[,\.]\d{1,2}")

# Parkeringsräknare "24:28" eller "4" (ensam siffra i mitten av ritning)
PARKING_COUNT_PATTERN = re.compile(r"^\d{1,3}:\d{1,3}$")

# Koordinatsystem
COORD_SYS_PATTERN = re.compile(r"sweref|rh\s*20|lm\s*\d|nt\s*\d", re.I)

# Fastighetsbeteckning-mönster (stora bokstäver, ofta med siffra)
PROPERTY_REF_PATTERN = re.compile(r"^[A-ZÅÄÖ]{3,}\n?\d{0,2}$")

# Material-nyckelord som kan förekomma direkt på ritningen
MATERIAL_KEYWORDS_ON_DRAWING = [
    "asfalt", "grus", "betong", "plattlag", "gräs", "kantsten",
    "bark", "singel", "makadam", "sand", "gräsmatta", "armering",
    "smågatsten", "gatsten", "natursten", "marksten",
]

# Legend-nyckelord
LEGEND_KEYWORDS = [
    "teckenförklaring", "legend", "tecken", "symboler", "förklaring",
    "betongplattor", "plattrad", "plantering", "kantstöd", "kantstod",
    "dagvatten", "träd", "buske", "trappa", "ramp", "stolp",
    "fastighetsgräns", "arbetsområde", "mur", "släntlinje", "fallskydd",
    "strid sand", "grässådd", "grästorv", "gräsarmering", "parkeringsplats",
]

# Gatunamn-suffix/prefix
STREET_PATTERNS = re.compile(
    r"(gatan|vägen|stigen|torget|allén|alléen|leden|plan|torg|bron|gränd|väg|backen|"
    r"parken|kajen|stranden|esplanaden)\b", re.I
)

TextType = Literal[
    "legend_header", "legend_entry", "scale", "scalebar_label",
    "north_arrow", "elevation", "area_label", "street_name",
    "material_label", "dimension", "drawing_number", "title",
    "coordinate_sys", "parking_count", "property_ref", "other",
]


# ---------------------------------------------------------------------------
# Dataklasser
# ---------------------------------------------------------------------------

@dataclass
class TextRegion:
    id: str
    page_number: int
    text: str                       # rå text, whitespace-normaliserad
    text_lines: list[str]           # text uppdelad per rad
    text_type: TextType
    confidence: float               # 0-1 klassificeringskonfidensen
    x0_pt: float                    # PDF-koordinater (pt)
    y0_pt: float
    x1_pt: float
    y1_pt: float
    cx_pt: float                    # centroid PDF
    cy_pt: float
    x_img: float                    # bildkoordinater vid 300 DPI (px)
    y_img: float
    w_img: float
    h_img: float
    font_size_avg: float
    font_size_max: float
    char_count: int
    normalized_x: float             # 0-1 (relativ position på sidan)
    normalized_y: float
    is_in_legend_area: bool
    is_in_drawing_area: bool
    is_in_title_block: bool
    extracted_value: str | None     # specifikt extraherat värde (skala, höjd, etc.)


@dataclass
class ScaleInfo:
    found: bool
    notation: str | None           # "1:200"
    denominator: float | None      # 200.0
    source_text: str | None        # texten skalan hittades i
    px_per_m: float | None         # px/m vid 300 DPI


@dataclass
class NorthArrow:
    found: bool
    x_pt: float | None
    y_pt: float | None
    x_img: float | None
    y_img: float | None


@dataclass
class TextAnalysisResult:
    pdf_path: str
    page_number: int
    page_width_pt: float
    page_height_pt: float
    total_text_regions: int
    scale: ScaleInfo
    north_arrow: NorthArrow
    text_regions: list[TextRegion] = field(default_factory=list)
    type_summary: dict = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Font-storlek-extraktion
# ---------------------------------------------------------------------------

def _extract_font_sizes(obj: LTTextBox) -> tuple[float, float]:
    """Returnerar (avg_size, max_size) för alla tecken i textrutan."""
    sizes = []
    for line in obj:
        if isinstance(line, LTTextLine):
            for char in line:
                if isinstance(char, LTChar) and char.size > 0:
                    sizes.append(char.size)
    if not sizes:
        return 0.0, 0.0
    return round(sum(sizes) / len(sizes), 2), round(max(sizes), 2)


# ---------------------------------------------------------------------------
# Koordinatkonvertering
# ---------------------------------------------------------------------------

def _to_image_coords(x0, y0, x1, y1, page_h, scale=PT_TO_PX):
    """Konverterar PDF-bbox till bildkoordinater (px)."""
    return (
        round(x0 * scale, 2),
        round((page_h - y1) * scale, 2),   # y-flip: y1 → top
        round((x1 - x0) * scale, 2),
        round((y1 - y0) * scale, 2),
    )


# ---------------------------------------------------------------------------
# Text-klassificering
# ---------------------------------------------------------------------------

def _classify_text(
    text: str,
    lines: list[str],
    x0: float,
    y0: float,
    x1: float,
    y1: float,
    page_w: float,
    page_h: float,
    font_size: float,
    legend_bbox: list[float] | None,
    title_min_x_frac: float = 0.80,
    title_max_y_frac: float = 0.35,
    drawing_max_x_frac: float = 0.65,
) -> tuple[TextType, float, str | None]:
    """
    Klassificerar en textpost.
    Returnerar (text_type, confidence, extracted_value).
    """
    text_lower = text.lower().strip()
    nx = x0 / page_w
    ny = y0 / page_h
    single_line = text.strip().replace("\n", " ")

    # --- 1. Nordpil ---
    if text.strip() in ("N", "n") and font_size > 10:
        return "north_arrow", 0.95, None

    # --- 2. Legend-header ---
    if "teckenförklaring" in text_lower and font_size > 10:
        return "legend_header", 0.99, None

    # --- 3. I legend-area ---
    in_legend = False
    if legend_bbox:
        lx0, ly0, lx1, ly1 = legend_bbox
        if x0 >= lx0 - 50 and x1 <= lx1 + 20 and y0 >= ly0 - 10 and y1 <= ly1 + 10:
            in_legend = True

    if not in_legend and nx > 0.65:
        # Höger del av ritning = troligen legend-området
        for kw in LEGEND_KEYWORDS:
            if kw in text_lower:
                in_legend = True
                break

    if in_legend:
        if "teckenförklaring" in text_lower:
            return "legend_header", 0.99, None
        return "legend_entry", 0.90, None

    # --- 4. Skalangivelse ---
    if "skala" in text_lower or re.search(r"1\s*[:/]\s*(50|100|200|250|400|500|1000)", text):
        m = SCALE_PATTERN.search(text)
        if m:
            val = f"1:{m.group(1)}"
            return "scale", 0.97, val
        return "scale", 0.75, None

    # --- 5. Skalstångs-etiketter ---
    if text_lower in ("meters", "meter", "m") or (
        re.match(r"^\d{1,3}$", text.strip()) and ny < 0.10
    ):
        return "scalebar_label", 0.85, text.strip()

    # --- 6. Höjdangivelse ---
    elev_match = ELEVATION_PATTERN.search(text)
    if elev_match:
        return "elevation", 0.95, elev_match.group(0)

    # --- 7. Koordinatsystem ---
    if COORD_SYS_PATTERN.search(text_lower):
        return "coordinate_sys", 0.95, text.strip()

    # --- 8. Parkeringsräknare ---
    if PARKING_COUNT_PATTERN.match(text.strip()):
        return "parking_count", 0.90, text.strip()

    # --- 9. Ritningsnummer ---
    if re.match(r"^[A-Z]-\d{2}-\d{3,4}$", text.strip()):
        return "drawing_number", 0.97, text.strip()

    # --- 10. Titelblock ---
    in_title = nx > title_min_x_frac and ny < title_max_y_frac
    if in_title:
        title_keywords = [
            "kommun", "handlingsdatum", "projektnummer", "ansvarig",
            "ritad av", "handling", "bet:", "sign:", "datum:",
            "anläggnings ama", "koordinatsystem", "höjdsystem",
        ]
        for kw in title_keywords:
            if kw in text_lower:
                return "title", 0.90, None
        if font_size > 9:
            return "title", 0.75, None

    # --- 11. Gatunamn ---
    if STREET_PATTERNS.search(text_lower):
        return "street_name", 0.90, text.strip()

    # --- 12. Fastighetsbeteckning ---
    if PROPERTY_REF_PATTERN.match(text.strip()) and font_size > 18:
        return "property_ref", 0.85, text.strip()

    # --- 13. Material-label på ritningen ---
    if nx < drawing_max_x_frac:
        for kw in MATERIAL_KEYWORDS_ON_DRAWING:
            if kw in text_lower:
                return "material_label", 0.80, None

    # --- 14. Dimension / mått ---
    if re.search(r"\d+[xX×]\d+", text) or re.search(r"\d+\s*mm\b", text_lower):
        return "dimension", 0.80, None

    # --- 15. Stor text på ritningsytan ---
    if font_size > 18 and nx < 0.65:
        return "area_label", 0.70, None

    return "other", 0.50, None


# ---------------------------------------------------------------------------
# Skala-extraktion
# ---------------------------------------------------------------------------

def _extract_scale_from_regions(regions: list[TextRegion]) -> ScaleInfo:
    """Söker igenom klassificerade textregioner och hittar bäst skalangivelse."""
    best_denom = None
    best_text = None
    best_conf = 0.0

    for r in regions:
        if r.text_type == "scale" and r.extracted_value:
            m = SCALE_PATTERN.search(r.extracted_value)
            if m:
                denom = float(m.group(1))
                if r.confidence > best_conf:
                    best_conf = r.confidence
                    best_denom = denom
                    best_text = r.text

    if best_denom:
        # px/m vid 300 DPI och given skala
        inch_per_m = (1000.0 / best_denom) / 25.4
        px_per_m = round(inch_per_m * DPI, 2)
        return ScaleInfo(
            found=True,
            notation=f"1:{int(best_denom)}",
            denominator=best_denom,
            source_text=best_text,
            px_per_m=px_per_m,
        )

    return ScaleInfo(found=False, notation=None, denominator=None,
                     source_text=None, px_per_m=None)


# ---------------------------------------------------------------------------
# Nordpil-extraktion
# ---------------------------------------------------------------------------

def _extract_north_arrow(regions: list[TextRegion]) -> NorthArrow:
    for r in regions:
        if r.text_type == "north_arrow":
            return NorthArrow(
                found=True,
                x_pt=r.cx_pt,
                y_pt=r.cy_pt,
                x_img=r.x_img,
                y_img=r.y_img,
            )
    return NorthArrow(found=False, x_pt=None, y_pt=None, x_img=None, y_img=None)


# ---------------------------------------------------------------------------
# Zones
# ---------------------------------------------------------------------------

def _determine_zones(
    x0, y0, x1, y1, page_w, page_h,
    legend_bbox: list | None,
    drawing_max_x_frac: float = 0.65,
    title_min_x_frac: float = 0.80,
    title_max_y_frac: float = 0.35,
) -> tuple[bool, bool, bool]:
    """Returnerar (is_in_legend, is_in_drawing, is_in_title)."""
    nx0 = x0 / page_w
    ny0 = y0 / page_h

    in_legend = False
    if legend_bbox:
        lx0, ly0, lx1, ly1 = legend_bbox
        if x0 >= lx0 - 60 and x1 <= lx1 + 20 and y0 >= ly0 - 10:
            in_legend = True
    elif nx0 > 0.65:
        in_legend = True

    in_title = nx0 > title_min_x_frac and ny0 < title_max_y_frac
    in_drawing = nx0 < drawing_max_x_frac and not in_title

    return in_legend, in_drawing, in_title


# ---------------------------------------------------------------------------
# Huvudfunktion
# ---------------------------------------------------------------------------

def analyze_text(
    pdf_path: str,
    page_number: int = 1,
    legend_bbox: list[float] | None = None,
    step3_json_path: str | None = None,
) -> TextAnalysisResult:
    """
    Extraherar och klassificerar all text i ritningen.

    Args:
        pdf_path:        Sökväg till PDF.
        page_number:     Sidnummer (1-indexerat).
        legend_bbox:     [x0,y0,x1,y1] i PDF-punkter för legend (från steg 3).
        step3_json_path: Alternativt: läs legend_bbox från step3_result.json.

    Returns:
        TextAnalysisResult.
    """
    pdf_path = os.path.abspath(pdf_path)

    # Ladda legend_bbox från Step 3 om inte angiven
    if legend_bbox is None and step3_json_path and os.path.exists(step3_json_path):
        with open(step3_json_path, encoding="utf-8") as f:
            s3 = json.load(f)
        legend_bbox = s3.get("legend_bbox_pdf")

    result = TextAnalysisResult(
        pdf_path=pdf_path,
        page_number=page_number,
        page_width_pt=0.0,
        page_height_pt=0.0,
        total_text_regions=0,
        scale=ScaleInfo(False, None, None, None, None),
        north_arrow=NorthArrow(False, None, None, None, None),
    )

    # Hitta sidan
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
    result.page_width_pt = round(page_w, 2)
    result.page_height_pt = round(page_h, 2)

    regions: list[TextRegion] = []
    counter = 0

    for obj in target_page:
        if not isinstance(obj, LTTextBox):
            continue

        raw = obj.get_text()
        text = raw.strip()
        if not text:
            continue

        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        text_clean = " ".join(lines)

        x0, y0, x1, y1 = obj.bbox
        cx = (x0 + x1) / 2
        cy = (y0 + y1) / 2
        nx = x0 / page_w
        ny = y0 / page_h

        font_avg, font_max = _extract_font_sizes(obj)
        x_img, y_img, w_img, h_img = _to_image_coords(x0, y0, x1, y1, page_h)

        text_type, conf, extracted_val = _classify_text(
            text_clean, lines, x0, y0, x1, y1,
            page_w, page_h, font_avg, legend_bbox,
        )

        in_legend, in_drawing, in_title = _determine_zones(
            x0, y0, x1, y1, page_w, page_h, legend_bbox,
        )

        counter += 1
        region = TextRegion(
            id=f"txt_{counter:04d}",
            page_number=page_number,
            text=text_clean,
            text_lines=lines,
            text_type=text_type,
            confidence=conf,
            x0_pt=round(x0, 2),
            y0_pt=round(y0, 2),
            x1_pt=round(x1, 2),
            y1_pt=round(y1, 2),
            cx_pt=round(cx, 2),
            cy_pt=round(cy, 2),
            x_img=x_img,
            y_img=y_img,
            w_img=w_img,
            h_img=h_img,
            font_size_avg=font_avg,
            font_size_max=font_max,
            char_count=len(text_clean),
            normalized_x=round(nx, 3),
            normalized_y=round(ny, 3),
            is_in_legend_area=in_legend,
            is_in_drawing_area=in_drawing,
            is_in_title_block=in_title,
            extracted_value=extracted_val,
        )
        regions.append(region)

    result.text_regions = regions
    result.total_text_regions = len(regions)

    # Sammanfattning per typ
    type_summary: dict[str, int] = {}
    for r in regions:
        type_summary[r.text_type] = type_summary.get(r.text_type, 0) + 1
    result.type_summary = dict(sorted(type_summary.items()))

    # Extrahera skala och nordpil
    result.scale = _extract_scale_from_regions(regions)
    result.north_arrow = _extract_north_arrow(regions)

    if not result.scale.found:
        result.warnings.append(
            "Ingen skalangivelse hittades i texten. "
            "Manuell kalibrering krävs för korrekta m²-beräkningar."
        )
    if not result.north_arrow.found:
        result.warnings.append("Ingen nordpil (N) hittades i texten.")

    return result


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Step 4: Analysera och klassificera text i CAD-PDF."
    )
    parser.add_argument("pdf", help="Sökväg till PDF")
    parser.add_argument("--page", type=int, default=1)
    parser.add_argument("--step3-json", default=None,
                        help="Sökväg till step3_result.json (för legend_bbox)")
    parser.add_argument("--output-dir", default="./output")
    parser.add_argument("--pretty", action="store_true")
    parser.add_argument("--summary-only", action="store_true",
                        help="Skriv bara sammanfattning, inte alla textregioner")
    args = parser.parse_args()

    result = analyze_text(
        pdf_path=args.pdf,
        page_number=args.page,
        step3_json_path=args.step3_json,
    )

    if args.summary_only:
        summary = {
            "total_text_regions": result.total_text_regions,
            "scale": asdict(result.scale),
            "north_arrow": asdict(result.north_arrow),
            "type_summary": result.type_summary,
            "warnings": result.warnings,
            "sample_by_type": {},
        }
        for r in result.text_regions:
            t = r.text_type
            if t not in summary["sample_by_type"]:
                summary["sample_by_type"][t] = {
                    "text": r.text[:60],
                    "font_size": r.font_size_avg,
                    "normalized_x": r.normalized_x,
                    "extracted_value": r.extracted_value,
                }
        print(json.dumps(summary, indent=2 if args.pretty else None, ensure_ascii=False))
    else:
        output = json.dumps(asdict(result), indent=2 if args.pretty else None, ensure_ascii=False)
        print(output)

    os.makedirs(args.output_dir, exist_ok=True)
    json_path = os.path.join(args.output_dir, "step4_result.json")
    with open(json_path, "w", encoding="utf-8") as f:
        f.write(json.dumps(asdict(result), ensure_ascii=False))
    print(f"\n[Sparat till {json_path}]", file=sys.stderr)


if __name__ == "__main__":
    main()
