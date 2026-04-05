"""
AI Pipeline - Steg 1: Input Preprocessing
==========================================
Syfte:
    Avgör om en PDF är vektor, raster eller hybrid.
    Renderar varje sida till PNG vid 300 DPI.
    Extraherar metadata: sidstorlek, skala, sidantal, koordinatsystem.

Kräver:
    - pdfminer.six  (pip install pdfminer.six)
    - Pillow        (pip install Pillow)
    - pdftoppm      (apt install poppler-utils)

Output:
    Dict med PreprocessResult per sida + global metadata.
    Renderade PNG:er sparas till output_dir.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Literal

from pdfminer.high_level import extract_pages
from pdfminer.layout import (
    LTCurve,
    LTFigure,
    LTImage,
    LTLine,
    LTPage,
    LTRect,
    LTTextBox,
)
from pdfminer.pdfpage import PDFPage
from pdfminer.pdfparser import PDFParser
from pdfminer.pdfdocument import PDFDocument
from PIL import Image


# ---------------------------------------------------------------------------
# Dataklasser
# ---------------------------------------------------------------------------

PDFType = Literal["vector_pdf", "raster_pdf", "hybrid_pdf"]


@dataclass
class PageMetadata:
    page_number: int          # 1-indexerat
    width_pt: float           # PDF-punkter (1 pt = 1/72 tum)
    height_pt: float
    width_mm: float
    height_mm: float
    paper_format: str         # "A0", "A1", "A3", etc. eller "custom"
    pdf_type: PDFType
    has_vector_paths: bool
    has_raster_images: bool
    vector_path_count: int
    raster_image_count: int
    text_count: int
    scale_notation: str | None       # t.ex. "1:200"
    scale_px_per_m: float | None     # px/m vid 300 DPI om skala hittad
    rendered_png: str | None         # relativ sökväg till renderad PNG
    render_width_px: int | None
    render_height_px: int | None


@dataclass
class PreprocessResult:
    pdf_path: str
    pdf_type: PDFType                # global typ (worst case av alla sidor)
    page_count: int
    is_encrypted: bool
    pages: list[PageMetadata] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Konstanter
# ---------------------------------------------------------------------------

# Standardpappersformat i mm (bredd × höjd, landscape om bredd > höjd)
PAPER_FORMATS = {
    "A0": (841, 1189),
    "A1": (594, 841),
    "A2": (420, 594),
    "A3": (297, 420),
    "A4": (210, 297),
}

PT_TO_MM = 25.4 / 72.0
DPI = 300
SCALE_PATTERN = re.compile(
    r"(?:skala|scale|sc\.?)?\s*1\s*[:/]\s*(\d{1,6})",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Hjälpfunktioner
# ---------------------------------------------------------------------------

def _pt_to_mm(pt: float) -> float:
    return round(pt * PT_TO_MM, 1)


def _classify_paper(w_mm: float, h_mm: float) -> str:
    """Returnerar pappersformat (landscape hanteras)."""
    dims = (min(w_mm, h_mm), max(w_mm, h_mm))
    tolerance = 8  # mm tolerans för äldre ritningar
    for name, (short, long) in PAPER_FORMATS.items():
        if abs(dims[0] - short) <= tolerance and abs(dims[1] - long) <= tolerance:
            return name
    return "custom"


def _determine_pdf_type(has_vec: bool, has_raster: bool) -> PDFType:
    if has_vec and has_raster:
        return "hybrid_pdf"
    if has_vec:
        return "vector_pdf"
    return "raster_pdf"


def _extract_scale(text: str) -> tuple[str, float] | tuple[None, None]:
    """Söker efter skalangivelse i text. Returnerar (notation, denominator)."""
    m = SCALE_PATTERN.search(text)
    if m:
        denom = int(m.group(1))
        notation = f"1:{denom}"
        return notation, float(denom)
    return None, None


def _px_per_meter(scale_denom: float) -> float:
    """
    Räknar ut px/m vid 300 DPI och given skala.
    Vid 1:200 och 300 DPI: 1 m ritning = 5 mm papper = 0,197 tum = 59,1 px
    """
    inch_per_m_on_paper = (1000.0 / scale_denom) / 25.4
    return round(inch_per_m_on_paper * DPI, 2)


# ---------------------------------------------------------------------------
# Sidinspektör
# ---------------------------------------------------------------------------

def _inspect_page(
    page: LTPage,
    page_num: int,
    all_text: str,
) -> tuple[bool, bool, int, int, int, str | None, float | None]:
    """
    Itererar rekursivt genom LT-trädet och räknar objekt.
    Returnerar: (has_vector, has_raster, n_paths, n_images, n_texts, scale_str, scale_denom)
    """
    n_paths = 0
    n_images = 0
    n_texts = 0

    def _walk(container):
        nonlocal n_paths, n_images, n_texts
        for obj in container:
            if isinstance(obj, (LTCurve, LTRect, LTLine)):
                n_paths += 1
            elif isinstance(obj, LTImage):
                n_images += 1
            elif isinstance(obj, LTTextBox):
                n_texts += 1
            elif isinstance(obj, LTFigure):
                # LTFigure är en container (kan innehålla inbäddade bilder)
                _walk(obj)

    _walk(page)

    has_vector = n_paths > 10   # >10 för att filtrera bort ram/stämpel-linjer
    has_raster = n_images > 0

    scale_str, scale_denom = _extract_scale(all_text)
    return has_vector, has_raster, n_paths, n_images, n_texts, scale_str, scale_denom


# ---------------------------------------------------------------------------
# Text-aggregerare
# ---------------------------------------------------------------------------

def _collect_text_from_page(page: LTPage) -> str:
    """Hämtar all text från en sida för skaldetektering."""
    parts = []

    def _walk(container):
        for obj in container:
            if isinstance(obj, LTTextBox):
                parts.append(obj.get_text())
            elif isinstance(obj, LTFigure):
                _walk(obj)

    _walk(page)
    return " ".join(parts)


# ---------------------------------------------------------------------------
# PDF-rendering via Poppler
# ---------------------------------------------------------------------------

def _render_page_to_png(
    pdf_path: str,
    page_num: int,    # 1-indexerat
    output_dir: str,
    dpi: int = DPI,
) -> tuple[str | None, int | None, int | None]:
    """
    Renderar en PDF-sida till PNG via pdftoppm.
    Returnerar (sökväg, bredd_px, höjd_px) eller (None, None, None) vid fel.
    """
    stem = Path(pdf_path).stem
    prefix = os.path.join(output_dir, f"{stem}_p{page_num:03d}")

    cmd = [
        "pdftoppm",
        "-r", str(dpi),
        "-png",
        "-f", str(page_num),
        "-l", str(page_num),
        "-singlefile",
        pdf_path,
        prefix,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        return None, None, None

    out_path = prefix + ".png"
    if not os.path.exists(out_path):
        return None, None, None

    with Image.open(out_path) as img:
        w_px, h_px = img.size

    return out_path, w_px, h_px


# ---------------------------------------------------------------------------
# Krypteringscheck
# ---------------------------------------------------------------------------

def _is_encrypted(pdf_path: str) -> bool:
    try:
        with open(pdf_path, "rb") as f:
            parser = PDFParser(f)
            doc = PDFDocument(parser)
            return not doc.is_extractable
    except Exception:
        return True


# ---------------------------------------------------------------------------
# Huvudfunktion
# ---------------------------------------------------------------------------

def preprocess_pdf(
    pdf_path: str,
    output_dir: str,
    render: bool = True,
    max_pages: int | None = None,
) -> PreprocessResult:
    """
    Kör Step 1 i AI-pipelinen.

    Args:
        pdf_path:   Sökväg till PDF-filen.
        output_dir: Mapp där renderade PNG:er sparas.
        render:     Om False, renderas inga PNG:er (snabbare för test).
        max_pages:  Begränsa antal sidor (None = alla).

    Returns:
        PreprocessResult med metadata och sökvägar till renderade bilder.
    """
    pdf_path = os.path.abspath(pdf_path)
    output_dir = os.path.abspath(output_dir)
    os.makedirs(output_dir, exist_ok=True)

    result = PreprocessResult(
        pdf_path=pdf_path,
        pdf_type="vector_pdf",   # uppdateras nedan
        page_count=0,
        is_encrypted=False,
    )

    # --- Krypteringscheck ---
    if _is_encrypted(pdf_path):
        result.is_encrypted = True
        result.errors.append("PDF är krypterad – kan inte extrahera innehåll.")
        return result

    # --- Iterera sidor ---
    global_has_vec = False
    global_has_raster = False
    page_num = 0

    try:
        for page in extract_pages(pdf_path):
            page_num += 1
            if max_pages and page_num > max_pages:
                break

            # Sidstorlek
            w_pt = page.width
            h_pt = page.height
            w_mm = _pt_to_mm(w_pt)
            h_mm = _pt_to_mm(h_pt)
            paper = _classify_paper(w_mm, h_mm)

            # Text för skaldetektering
            page_text = _collect_text_from_page(page)

            # Inspektera objekt
            has_vec, has_raster, n_paths, n_images, n_texts, scale_str, scale_denom = (
                _inspect_page(page, page_num, page_text)
            )

            global_has_vec = global_has_vec or has_vec
            global_has_raster = global_has_raster or has_raster

            pdf_type = _determine_pdf_type(has_vec, has_raster)

            # Skala → px/m
            px_per_m = None
            if scale_denom:
                px_per_m = _px_per_meter(scale_denom)

            # Varning om ingen skala hittad
            if not scale_str:
                result.warnings.append(
                    f"Sida {page_num}: Ingen skalangivelse hittad i text. "
                    "Manuell kalibrering krävs."
                )

            # Rendering
            png_path = None
            w_px = None
            h_px = None
            if render:
                png_path, w_px, h_px = _render_page_to_png(
                    pdf_path, page_num, output_dir
                )
                if png_path is None:
                    result.warnings.append(
                        f"Sida {page_num}: Rendering misslyckades (pdftoppm)."
                    )
                else:
                    # Gör sökvägen relativ till output_dir för portabilitet
                    png_path = os.path.relpath(png_path, output_dir)

            meta = PageMetadata(
                page_number=page_num,
                width_pt=round(w_pt, 2),
                height_pt=round(h_pt, 2),
                width_mm=w_mm,
                height_mm=h_mm,
                paper_format=paper,
                pdf_type=pdf_type,
                has_vector_paths=has_vec,
                has_raster_images=has_raster,
                vector_path_count=n_paths,
                raster_image_count=n_images,
                text_count=n_texts,
                scale_notation=scale_str,
                scale_px_per_m=px_per_m,
                rendered_png=png_path,
                render_width_px=w_px,
                render_height_px=h_px,
            )
            result.pages.append(meta)

    except Exception as exc:
        result.errors.append(f"Fel vid PDF-parsning: {exc}")
        return result

    result.page_count = page_num
    result.pdf_type = _determine_pdf_type(global_has_vec, global_has_raster)

    return result


# ---------------------------------------------------------------------------
# CLI-gränssnitt
# ---------------------------------------------------------------------------

def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Step 1: Preprocessa en PDF för AI-ritningsanalys."
    )
    parser.add_argument("pdf", help="Sökväg till PDF-filen")
    parser.add_argument(
        "--output-dir",
        default="./output",
        help="Mapp för renderade PNG:er (default: ./output)",
    )
    parser.add_argument(
        "--no-render",
        action="store_true",
        help="Hoppa över PNG-rendering (snabbare)",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=None,
        help="Max antal sidor att bearbeta",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Skriv ut JSON med indrag",
    )
    args = parser.parse_args()

    result = preprocess_pdf(
        pdf_path=args.pdf,
        output_dir=args.output_dir,
        render=not args.no_render,
        max_pages=args.max_pages,
    )

    output = json.dumps(asdict(result), indent=2 if args.pretty else None, ensure_ascii=False)
    print(output)

    # Spara även JSON till disk
    json_path = os.path.join(args.output_dir, "step1_result.json")
    os.makedirs(args.output_dir, exist_ok=True)
    with open(json_path, "w", encoding="utf-8") as f:
        f.write(output)
    print(f"\n[Sparat till {json_path}]", file=sys.stderr)


if __name__ == "__main__":
    main()
