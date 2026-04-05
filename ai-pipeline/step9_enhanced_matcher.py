"""
AI Pipeline - Steg 9: Förbättrad matchning och pixel-korsvalidering
====================================================================
Förbättringar över steg 8:

1. BUG-FIX: Exakta legendträffar som step6 märkte "unmatched" får nu
   korrekt scoring (step6 matchar via step5 hatch-kluster; area_candidates
   utan hatch faller igenom → status unmatched trots exakt legendfärg).

2. CIE Lab ΔE fuzzy matching: om drawing-färg saknar exakt legendmatch
   men ΔE < FUZZY_STRONG (12) → matcha med skalad color_score.
   ΔE 12-22 → flagga som "möjlig", presentera som förslag.

3. Pixel-sampling från renderad PNG: sampla N pixlar INUTI varje
   polygon-sub-zon. Beräknar:
   - median_rgb_px: faktisk bildfärg (inte PDF-vektorfärg)
   - rgb_consistency: hur homogen färgen är (stddev)
   - hatch_texture_score: texturvarians → hatch vs solid fill
   Används för att kors-validera PDF-vektorfärgen.

4. Nearest-neighbor förslag för genuint okända färger (ΔE > 22).

5. Shape descriptor: compactness = area / hull_area (0→1).
   Kompakt polygon (>0.8) = sannolikt sammanhängande yta → bonus.

Output:
    step9_enhanced.json       — fullständigt förbättrat resultat
    step9_takeoff_table.json  — uppdaterad mängdningstabell
"""

from __future__ import annotations

import json
import math
import os
import sys
import argparse
from pathlib import Path
from typing import Optional
from dataclasses import dataclass, field, asdict


# ─────────────────────────────────────────────────────────────────────────────
# Konstanter
# ─────────────────────────────────────────────────────────────────────────────

FUZZY_STRONG   = 12.0   # ΔE < 12 → stark fuzzy-match
FUZZY_POSSIBLE = 22.0   # ΔE 12–22 → möjlig, presenteras som förslag
PIXEL_SAMPLE_N = 200    # antal pixlar att sampla per sub-zon

W_COLOR    = 0.40
W_PATCH    = 0.25
W_SPATIAL  = 0.20
W_EVIDENCE = 0.15

PENALTY_CONFLICT   = 0.70
PENALTY_HULL_MAX   = 0.10
PENALTY_MANY_ZONES = 0.90
PENALTY_HATCH_SRC  = 0.85
PENALTY_FUZZY      = 0.85   # fuzzy-match är lite osäkrare än exakt
AUTO_ACCEPT_THRESHOLD = 0.65


# ─────────────────────────────────────────────────────────────────────────────
# CIE Lab färgkonvertering
# ─────────────────────────────────────────────────────────────────────────────

def hex_to_rgb_int(h: str) -> tuple[int, int, int]:
    h = h.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def _rgb_int_to_lab(r: int, g: int, b: int) -> tuple[float, float, float]:
    def lin(c: int) -> float:
        c_ = c / 255.0
        return c_ / 12.92 if c_ <= 0.04045 else ((c_ + 0.055) / 1.055) ** 2.4

    rl, gl, bl = lin(r), lin(g), lin(b)
    X = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375
    Y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750
    Z = rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041

    Xn, Yn, Zn = 0.95047, 1.0, 1.08883

    def f(t: float) -> float:
        return t ** (1.0 / 3.0) if t > 0.008856 else 7.787 * t + 16.0 / 116.0

    L = 116.0 * f(Y / Yn) - 16.0
    a = 500.0 * (f(X / Xn) - f(Y / Yn))
    b_ = 200.0 * (f(Y / Yn) - f(Z / Zn))
    return L, a, b_


def hex_to_lab(h: str) -> tuple[float, float, float]:
    return _rgb_int_to_lab(*hex_to_rgb_int(h))


def delta_e(h1: str, h2: str) -> float:
    L1, a1, b1 = hex_to_lab(h1)
    L2, a2, b2 = hex_to_lab(h2)
    return math.sqrt((L1 - L2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2)


# ─────────────────────────────────────────────────────────────────────────────
# Pixel-sampling från PNG
# ─────────────────────────────────────────────────────────────────────────────

def _point_in_polygon(x: float, y: float, poly: list[list[float]]) -> bool:
    """Ray-casting algorithm."""
    n = len(poly)
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def sample_pixels_in_polygon(
    img_array,             # numpy array H×W×3
    hull_pts_image: list,  # [[x,y],...] bildkoordinater
    n: int = PIXEL_SAMPLE_N,
) -> Optional[dict]:
    """
    Samplar n pixlar inuti polygonen, returnerar statistik.
    img_array: numpy uint8 H×W×3
    hull_pts_image: polygonhörn i bildkoordinater (px, py)
    """
    if not hull_pts_image or len(hull_pts_image) < 3:
        return None

    import random
    import numpy as np

    pts = hull_pts_image
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    x0, x1 = max(0, int(min(xs))), min(img_array.shape[1] - 1, int(max(xs)))
    y0, y1 = max(0, int(min(ys))), min(img_array.shape[0] - 1, int(max(ys)))

    if x1 <= x0 or y1 <= y0:
        return None

    # Generera kandidat-pixlar
    max_candidates = (x1 - x0 + 1) * (y1 - y0 + 1)
    sample_pixels = []
    attempts = 0
    max_attempts = n * 30

    # Försök random sampling
    while len(sample_pixels) < n and attempts < max_attempts:
        px = random.randint(x0, x1)
        py = random.randint(y0, y1)
        if _point_in_polygon(px, py, pts):
            sample_pixels.append((px, py))
        attempts += 1

    # Fallback: grid-scan om polygon är liten
    if len(sample_pixels) < 10:
        for py in range(y0, y1 + 1):
            for px in range(x0, x1 + 1):
                if _point_in_polygon(px, py, pts):
                    sample_pixels.append((px, py))
        if len(sample_pixels) > n:
            random.shuffle(sample_pixels)
            sample_pixels = sample_pixels[:n]

    if not sample_pixels:
        return None

    # Extrahera RGB-värden
    rgbs = np.array([img_array[py, px] for (px, py) in sample_pixels], dtype=float)
    mean_rgb = rgbs.mean(axis=0)
    std_rgb  = rgbs.std(axis=0)
    mean_std = float(std_rgb.mean())

    # rgb_consistency: 1.0 = perfekt homogen, 0.0 = kaotisk
    rgb_consistency = max(0.0, 1.0 - mean_std / 64.0)

    # hatch_texture_score: hög varians → sannolikt hatch-mönster
    # vi tittar på lokal pixelgradient (diff mellan neighbors)
    gradients = []
    for i in range(1, len(sample_pixels)):
        px1, py1 = sample_pixels[i - 1]
        px2, py2 = sample_pixels[i]
        if abs(px1 - px2) <= 1 and abs(py1 - py2) <= 1:
            diff = float(np.abs(img_array[py1, px1].astype(float) -
                                img_array[py2, px2].astype(float)).mean())
            gradients.append(diff)
    hatch_texture_score = 0.0
    if gradients:
        avg_grad = sum(gradients) / len(gradients)
        hatch_texture_score = min(1.0, avg_grad / 80.0)  # 80 = typisk hatch-gradient

    # Konvertera medelfärg till hex
    r_, g_, b_ = [min(255, max(0, int(round(c)))) for c in mean_rgb]
    median_hex = f"#{r_:02X}{g_:02X}{b_:02X}"

    # ΔE mellan vad PDF säger och vad bilden faktiskt visar
    return {
        "n_pixels_sampled": len(sample_pixels),
        "mean_rgb": [round(float(c), 1) for c in mean_rgb],
        "mean_rgb_hex": median_hex,
        "rgb_consistency": round(rgb_consistency, 3),
        "hatch_texture_score": round(hatch_texture_score, 3),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Legendmatchning
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class LegendMatch:
    match_type: str          # "exact", "fuzzy", "none"
    matched_hex: str
    delta_e: float
    label: str
    label_short: str
    material_category: str
    is_conflict: bool
    legend_item_id: str
    color_score: float       # 0–1, skalad efter matchtyp och konfidens


def build_legend_index(step3_data: dict) -> dict:
    """Bygger upp snabbuppslagstabeller från step3."""
    exact: dict[str, list] = {}           # hex_upper → lista av legend_items
    conflict_colors: set[str] = set()

    for item in step3_data.get("legend_items", []):
        h = item["fill_color_hex"].upper()
        exact.setdefault(h, []).append(item)

    for c in step3_data.get("color_conflicts", []):
        conflict_colors.add(c["fill_color_hex"].upper())

    return {"exact": exact, "conflicts": conflict_colors}


def find_legend_match(
    drawing_hex: str,
    legend_index: dict,
    all_legend_items: list,
) -> LegendMatch:
    """
    Hitta bästa legendmatch för en drawing-färg.
    Prioritet: exakt → fuzzy (ΔE < FUZZY_STRONG) → ingen.
    """
    h = drawing_hex.upper()
    exact_items = legend_index["exact"].get(h)

    # ── Exakt match ──────────────────────────────────────────────────────────
    if exact_items:
        is_conflict = h in legend_index["conflicts"]
        item = exact_items[0]
        label = item.get("label_clean", "") or ""
        # color_score = legend patch_confidence, men minst 0.5 vid exakt träff
        patch_conf = item.get("match_confidence", 0.5) or 0.5
        # Bonus om label inte är tom
        label_bonus = 0.1 if label.strip() else 0.0
        color_score = min(1.0, patch_conf + label_bonus)
        if is_conflict:
            color_score *= 0.75  # konflikt drar ner

        return LegendMatch(
            match_type="exact",
            matched_hex=h,
            delta_e=0.0,
            label=label,
            label_short=label[:60] if label else "(legendetikett saknas)",
            material_category=item.get("material_category", "okänd"),
            is_conflict=is_conflict,
            legend_item_id=item.get("id", ""),
            color_score=round(color_score, 3),
        )

    # ── Fuzzy match (CIE Lab ΔE) ─────────────────────────────────────────────
    best_de = float("inf")
    best_item = None
    for item in all_legend_items:
        de = delta_e(h, item["fill_color_hex"].upper())
        if de < best_de:
            best_de = de
            best_item = item

    if best_item and best_de < FUZZY_STRONG:
        label = best_item.get("label_clean", "") or ""
        # Skalad color_score: 0 ΔE → 1.0, FUZZY_STRONG ΔE → 0.5
        fuzzy_scale = 1.0 - (best_de / FUZZY_STRONG) * 0.5
        patch_conf = best_item.get("match_confidence", 0.5) or 0.5
        color_score = round(patch_conf * fuzzy_scale * PENALTY_FUZZY, 3)
        lh = best_item["fill_color_hex"].upper()
        is_conflict = lh in legend_index["conflicts"]

        return LegendMatch(
            match_type="fuzzy",
            matched_hex=lh,
            delta_e=round(best_de, 2),
            label=label,
            label_short=f"[fuzzy ΔE={best_de:.1f}] {label[:50]}" if label else f"[fuzzy ΔE={best_de:.1f}]",
            material_category=best_item.get("material_category", "okänd"),
            is_conflict=is_conflict,
            legend_item_id=best_item.get("id", ""),
            color_score=color_score,
        )

    # ── Ingen match ──────────────────────────────────────────────────────────
    # Bygg nearest-neighbor lista (top 3)
    neighbors = sorted(
        [(delta_e(h, it["fill_color_hex"].upper()), i, it)
         for i, it in enumerate(all_legend_items)]
    )[:3]
    nn_hint = "; ".join(
        f"{it['fill_color_hex']} ΔE={de:.0f} ({(it.get('label_clean','') or '')[:20]})"
        for de, _, it in neighbors
    )

    return LegendMatch(
        match_type="none",
        matched_hex="",
        delta_e=best_de if best_item else 999.0,
        label="",
        label_short=f"(okänd — närmaste: {nn_hint})",
        material_category="okänd",
        is_conflict=False,
        legend_item_id="",
        color_score=0.0,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Konfidensberäkning
# ─────────────────────────────────────────────────────────────────────────────

def _spatial_score(discrepancy_pct: float) -> float:
    if discrepancy_pct <= 0:
        return 1.0
    return round(max(0.0, 1.0 - discrepancy_pct / 500.0), 3)


def _evidence_score(tile_count: int, legend_hits: int, n_polygons: int) -> float:
    if tile_count == 0 and legend_hits == 0 and n_polygons == 0:
        return 0.0
    tile_sc   = math.log1p(tile_count) / math.log1p(10000)
    legend_sc = min(1.0, legend_hits / 3.0)
    poly_sc   = min(1.0, math.log1p(n_polygons) / math.log1p(50))
    return round(tile_sc * 0.5 + legend_sc * 0.3 + poly_sc * 0.2, 3)


def _patch_score(
    match: LegendMatch,
    patch_sim_by_color: dict[str, float],
    pixel_data: Optional[dict],
    pdf_hex: str,
) -> float:
    """
    Kombinerar steg-5-patchlikhet med pixelsampling från PNG.
    Om pixel-RGB kors-validerar PDF-färgen → boost.
    """
    # Bas: steg-5 patch_similarity för matchad legendfärg
    base = patch_sim_by_color.get(match.matched_hex, 0.0)
    if match.match_type == "none":
        return 0.0

    if base == 0.0:
        # Fallback: försök PDF-färgens egna similarity
        base = patch_sim_by_color.get(pdf_hex.upper(), 0.0)

    if base == 0.0:
        base = 0.3  # prior för exakt/fuzzy-match utan steg-5-data

    if pixel_data is None:
        return round(base, 3)

    # Korsvalidering: hur nära är bildens medianat RGB matchad legendfärg?
    img_hex = pixel_data["mean_rgb_hex"]
    de_img_to_legend = delta_e(img_hex, match.matched_hex) if match.matched_hex else 99.0
    de_img_to_pdf    = delta_e(img_hex, pdf_hex)

    # Bonus: bilden bekräftar PDF-färgen
    pixel_confirm = max(0.0, 1.0 - de_img_to_pdf / 30.0)      # ΔE 0→1.0, 30→0.0
    legend_confirm = max(0.0, 1.0 - de_img_to_legend / 30.0)

    # rgb_consistency: homogen yta = solid fill = mer pålitlig
    consistency_bonus = pixel_data["rgb_consistency"] * 0.1

    # Hatch-penalty: hög texturvarians kan vara hatch → lägre säkerhet
    hatch_pen = pixel_data["hatch_texture_score"] * 0.05

    score = base * 0.5 + pixel_confirm * 0.25 + legend_confirm * 0.2 + consistency_bonus - hatch_pen
    return round(min(1.0, max(0.0, score)), 3)


def _compute_penalty(
    match: LegendMatch,
    discrepancy_pct: float,
    n_zones: int,
    source: str,
) -> tuple[float, list[str]]:
    penalty = 1.0
    reasons = []

    if match.is_conflict:
        penalty *= PENALTY_CONFLICT
        reasons.append(f"färgkonflikt (×{PENALTY_CONFLICT})")

    if match.match_type == "fuzzy":
        penalty *= PENALTY_FUZZY
        reasons.append(f"fuzzy-match ΔE={match.delta_e:.1f} (×{PENALTY_FUZZY})")

    if discrepancy_pct > 100:
        p = max(PENALTY_HULL_MAX, 1.0 - discrepancy_pct / 1000.0)
        penalty *= p
        reasons.append(f"hull-avvikelse {discrepancy_pct:.0f}% (×{p:.2f})")

    if n_zones > 4:
        penalty *= PENALTY_MANY_ZONES
        reasons.append(f"{n_zones} sub-zoner (×{PENALTY_MANY_ZONES})")

    if source == "hatch_cluster":
        penalty *= PENALTY_HATCH_SRC
        reasons.append(f"hatch-kluster (×{PENALTY_HATCH_SRC})")

    return round(penalty, 4), reasons


def _review_priority(
    match_type: str,
    final_score: float,
    area_m2: float,
) -> str:
    if match_type == "none" and area_m2 > 10:
        return "critical"
    if match_type == "none" or final_score < 0.30:
        return "high"
    if final_score < 0.60:
        return "medium"
    return "low"


# ─────────────────────────────────────────────────────────────────────────────
# Huvud-pipeline
# ─────────────────────────────────────────────────────────────────────────────

def run(
    step3_json: str,
    step5_json: str,
    step7_json: str,
    png_path: str,
    output_dir: str,
    pretty: bool = False,
) -> dict:
    with open(step3_json) as f:
        s3 = json.load(f)
    with open(step5_json) as f:
        s5 = json.load(f)
    with open(step7_json) as f:
        s7 = json.load(f)

    all_legend_items = s3.get("legend_items", [])
    legend_index = build_legend_index(s3)

    # Steg-5 patch_similarity per legendfärg
    patch_sim_by_color: dict[str, float] = {}
    for region in s5.get("classified_regions", []):
        h = region["fill_color_hex"].upper()
        ps = region.get("patch_confidence") or 0.0
        if ps > patch_sim_by_color.get(h, 0.0):
            patch_sim_by_color[h] = ps

    # Hatch-tile-antal per färg
    tile_counts: dict[str, int] = {}
    for h_raw, info in s5.get("color_map", {}).items():
        tile_counts[h_raw.upper()] = info.get("total_tiles", 0)

    # Legend-träffar per färg (antal legend_items med den färgen)
    legend_hits_by_color: dict[str, int] = {
        h: len(items) for h, items in legend_index["exact"].items()
    }

    # Ladda PNG om tillgänglig
    img_array = None
    if png_path and os.path.exists(png_path):
        try:
            import numpy as np
            from PIL import Image
            img = Image.open(png_path).convert("RGB")
            img_array = np.array(img, dtype="uint8")
            print(f"[PNG] Laddad: {img_array.shape[1]}×{img_array.shape[0]}px")
        except Exception as e:
            print(f"[VARNING] Kunde inte ladda PNG: {e}")

    scale_denom = s7.get("scale_denom", 200.0)
    page_num    = s7.get("page_number", 1)

    results = []
    all_warnings = []

    for rc in s7.get("refined_candidates", []):
        pdf_hex   = rc["fill_color_hex"]
        h_up      = pdf_hex.upper()
        area_m2   = rc["total_area_m2"]
        disc_pct  = rc.get("area_discrepancy_pct", 0.0)
        n_zones   = len(rc.get("sub_zones", []))
        n_polys   = rc.get("total_polygon_count", 0)
        source    = "hatch_cluster" if n_polys == 0 else "area_polygon"

        # ── Legendmatch (ny logik) ────────────────────────────────────────
        match = find_legend_match(pdf_hex, legend_index, all_legend_items)

        # ── Pixel-sampling per sub-zon ────────────────────────────────────
        zone_pixel_data = []
        if img_array is not None:
            for zone in rc.get("sub_zones", []):
                hull_img = zone.get("hull_pts_image", [])
                pd = sample_pixels_in_polygon(img_array, hull_img, n=PIXEL_SAMPLE_N)
                zone_pixel_data.append(pd)

        # Aggregera pixel-data (medelvärde över zoner)
        agg_pixel: Optional[dict] = None
        valid_zones = [pd for pd in zone_pixel_data if pd is not None]
        if valid_zones:
            n_tot = sum(z["n_pixels_sampled"] for z in valid_zones)
            mean_r = sum(z["mean_rgb"][0] * z["n_pixels_sampled"] for z in valid_zones) / n_tot
            mean_g = sum(z["mean_rgb"][1] * z["n_pixels_sampled"] for z in valid_zones) / n_tot
            mean_b = sum(z["mean_rgb"][2] * z["n_pixels_sampled"] for z in valid_zones) / n_tot
            avg_cons = sum(z["rgb_consistency"] for z in valid_zones) / len(valid_zones)
            avg_tex  = sum(z["hatch_texture_score"] for z in valid_zones) / len(valid_zones)
            r_, g_, b_ = [min(255, max(0, int(round(c)))) for c in (mean_r, mean_g, mean_b)]
            agg_pixel = {
                "n_pixels_sampled": n_tot,
                "mean_rgb": [round(mean_r, 1), round(mean_g, 1), round(mean_b, 1)],
                "mean_rgb_hex": f"#{r_:02X}{g_:02X}{b_:02X}",
                "rgb_consistency": round(avg_cons, 3),
                "hatch_texture_score": round(avg_tex, 3),
                "n_zones_sampled": len(valid_zones),
                # ΔE: bilden vs PDF-vektorfärg
                "delta_e_img_vs_pdf": round(delta_e(f"#{r_:02X}{g_:02X}{b_:02X}", pdf_hex), 2),
                # ΔE: bilden vs matchad legendfärg
                "delta_e_img_vs_legend": round(
                    delta_e(f"#{r_:02X}{g_:02X}{b_:02X}", match.matched_hex), 2
                ) if match.matched_hex else None,
            }

        # ── Signaler ──────────────────────────────────────────────────────
        color_sc   = match.color_score
        patch_sc   = _patch_score(match, patch_sim_by_color, agg_pixel, pdf_hex)
        spatial_sc = _spatial_score(disc_pct)
        tiles      = tile_counts.get(h_up, 0)
        leg_hits   = legend_hits_by_color.get(h_up, 0)
        ev_sc      = _evidence_score(tiles, leg_hits, n_polys)

        raw = W_COLOR * color_sc + W_PATCH * patch_sc + W_SPATIAL * spatial_sc + W_EVIDENCE * ev_sc

        # ── Penalty ───────────────────────────────────────────────────────
        penalty, p_reasons = _compute_penalty(match, disc_pct, n_zones, source)

        # Genuint okänd (ingen match) → final = 0; annars beräknat
        if match.match_type == "none":
            final = 0.0
        else:
            final = round(min(1.0, max(0.0, raw * penalty)), 3)

        priority = _review_priority(match.match_type, final, area_m2)
        auto_accepted = (final >= AUTO_ACCEPT_THRESHOLD and match.match_type != "none")

        # Kompakthet (shape descriptor): area / hull_area
        total_hull_area = sum(
            z.get("hull_area_m2", 0) for z in rc.get("sub_zones", [])
        )
        compactness = round(area_m2 / total_hull_area, 3) if total_hull_area > 0 else None

        # Nearest-neighbor förslag för okända
        nn_suggestions = []
        if match.match_type == "none":
            neighbors = sorted(
                [(delta_e(h_up, it["fill_color_hex"].upper()), i, it)
                 for i, it in enumerate(all_legend_items)]
            )[:3]
            for de, _, it in neighbors:
                nn_suggestions.append({
                    "color_hex": it["fill_color_hex"],
                    "delta_e": round(de, 1),
                    "label": (it.get("label_clean") or "")[:60],
                    "material_category": it.get("material_category", ""),
                })

        # Varning om bildfärg avviker kraftigt från PDF-vektorfärg
        if agg_pixel and agg_pixel["delta_e_img_vs_pdf"] > 15:
            msg = (f"Bildfärg ({agg_pixel['mean_rgb_hex']}) avviker ΔE="
                   f"{agg_pixel['delta_e_img_vs_pdf']:.0f} från PDF-vektorfärg ({pdf_hex}). "
                   f"Kan indikera rasteriserings-artefakt eller lageröverlapp.")
            all_warnings.append(msg)

        results.append({
            "id": f"s9_{rc['id']}",
            "source_candidate_id": rc["source_candidate_id"],
            "page_number": page_num,
            "fill_color_hex": pdf_hex,
            "match_type": match.match_type,
            "matched_legend_hex": match.matched_hex,
            "delta_e_to_legend": match.delta_e,
            "material_category": match.material_category,
            "material_label": match.label,
            "material_label_short": match.label_short,
            "is_conflict": match.is_conflict,
            "area_m2": round(area_m2, 4),
            "n_zones": n_zones,
            "n_polygons": n_polys,
            "compactness": compactness,
            "pixel_validation": agg_pixel,
            "signals": {
                "color_score": round(color_sc, 3),
                "patch_score": round(patch_sc, 3),
                "spatial_score": round(spatial_sc, 3),
                "evidence_score": round(ev_sc, 3),
                "weighted_raw": round(raw, 3),
                "penalty_factor": penalty,
                "penalty_reasons": p_reasons,
                "final_score": final,
            },
            "confidence_score": final,
            "auto_accepted": auto_accepted,
            "review_priority": priority,
            "requires_human_review": not auto_accepted,
            "nn_suggestions": nn_suggestions,
        })

    # Sortera: auto-accepterade först, sedan efter yta
    results.sort(key=lambda x: (-x["confidence_score"], -x["area_m2"]))
    for i, r in enumerate(results, 1):
        r["rank"] = i

    # Summering
    auto_area  = sum(r["area_m2"] for r in results if r["auto_accepted"])
    rev_area   = sum(r["area_m2"] for r in results if not r["auto_accepted"])
    prio_breakdown = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for r in results:
        prio_breakdown[r["review_priority"]] += 1

    summary = {
        "total_candidates": len(results),
        "auto_accepted": sum(1 for r in results if r["auto_accepted"]),
        "needs_review": sum(1 for r in results if not r["auto_accepted"]),
        "auto_accepted_area_m2": round(auto_area, 2),
        "review_area_m2": round(rev_area, 2),
        "total_area_m2": round(auto_area + rev_area, 2),
        "match_breakdown": {
            "exact": sum(1 for r in results if r["match_type"] == "exact"),
            "fuzzy": sum(1 for r in results if r["match_type"] == "fuzzy"),
            "none":  sum(1 for r in results if r["match_type"] == "none"),
        },
        "priority_breakdown": prio_breakdown,
        "auto_accept_threshold": AUTO_ACCEPT_THRESHOLD,
        "pixel_validation_enabled": img_array is not None,
    }

    # Mängdningstabell (kompakt)
    takeoff_rows = []
    for r in results:
        takeoff_rows.append({
            "rank": r["rank"],
            "id": r["id"],
            "fill_color_hex": r["fill_color_hex"],
            "matched_legend_hex": r["matched_legend_hex"],
            "match_type": r["match_type"],
            "material_category": r["material_category"],
            "material_label": r["material_label"],
            "area_m2": r["area_m2"],
            "confidence_score": r["confidence_score"],
            "is_conflict": r["is_conflict"],
            "review_priority": r["review_priority"],
            "auto_accepted": r["auto_accepted"],
            "requires_human_review": r["requires_human_review"],
            "pixel_hex": r["pixel_validation"]["mean_rgb_hex"] if r["pixel_validation"] else None,
            "delta_e_img_vs_pdf": r["pixel_validation"]["delta_e_img_vs_pdf"] if r["pixel_validation"] else None,
            "rgb_consistency": r["pixel_validation"]["rgb_consistency"] if r["pixel_validation"] else None,
            "hatch_texture_score": r["pixel_validation"]["hatch_texture_score"] if r["pixel_validation"] else None,
            "nn_suggestions": r["nn_suggestions"],
        })

    # Spara
    os.makedirs(output_dir, exist_ok=True)
    indent = 2 if pretty else None

    full_output = {
        "pdf_path": s7.get("pdf_path", ""),
        "page_number": page_num,
        "scale_denom": scale_denom,
        "auto_accept_threshold": AUTO_ACCEPT_THRESHOLD,
        "summary": summary,
        "scored_candidates": results,
        "warnings": all_warnings,
    }

    out9 = os.path.join(output_dir, "step9_enhanced.json")
    with open(out9, "w", encoding="utf-8") as f:
        json.dump(full_output, f, indent=indent, ensure_ascii=False)
    print(f"[Sparat till {out9}]")

    out9t = os.path.join(output_dir, "step9_takeoff_table.json")
    with open(out9t, "w", encoding="utf-8") as f:
        json.dump(takeoff_rows, f, indent=indent, ensure_ascii=False)
    print(f"[Sparat till {out9t}]")

    print(json.dumps(summary, indent=2, ensure_ascii=False))
    return full_output


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Steg 9: Förbättrad matchning + pixelvalidering")
    ap.add_argument("--step3-json",  required=True)
    ap.add_argument("--step5-json",  required=True)
    ap.add_argument("--step7-json",  required=True)
    ap.add_argument("--png",         default="./output/ritning_p001.png",
                    help="Renderad PNG (300 DPI) från steg 1")
    ap.add_argument("--output-dir",  default="./output")
    ap.add_argument("--pretty",      action="store_true")
    args = ap.parse_args()

    run(
        step3_json  = args.step3_json,
        step5_json  = args.step5_json,
        step7_json  = args.step7_json,
        png_path    = args.png,
        output_dir  = args.output_dir,
        pretty      = args.pretty,
    )
