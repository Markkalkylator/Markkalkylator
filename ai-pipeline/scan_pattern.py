#!/usr/bin/env python3
"""
scan_pattern.py — Pixel-scanning av renderad ritning
=====================================================
Hittar ALLA regioner i ritningen som liknar en given målfärg.
Exakt samma princip som Planswift/Bluebeam: ange en färg,
systemet returnerar alla ytor med den färgen + deras area.

Används av /api/ai-scan (Next.js anropar via child_process).

Argument:
  --color   HEX-färg att söka efter (t.ex. #708462)
  --thresh  RGB-avståndströskel (default 40, lägre = striktare)
  --png     Sökväg till renderad PNG (default: ./output/ritning_p001.png)
  --scale   px/m i PNG:en (default: 59.06 från step1)
  --min-m2  Minsta area att ta med (default: 0.1 m²)

Returnerar JSON på stdout:
  { regions: [{area_m2, hull_png_pts: [[x,y],...], n_pixels}], total, px_per_m }
"""

import sys
import json
import math
import time
import argparse
import numpy as np
from PIL import Image


# ─────────────────────────────────────────────────────────────────────────────
# Färgkonvertering
# ─────────────────────────────────────────────────────────────────────────────

def hex_to_rgb(h: str) -> tuple:
    h = h.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


# ─────────────────────────────────────────────────────────────────────────────
# Pixelmask: hitta alla pixlar inom tröskelvärde
# ─────────────────────────────────────────────────────────────────────────────

def make_mask(img_array: np.ndarray, target_rgb: tuple, threshold: float) -> np.ndarray:
    """
    Returnerar bool-mask: True för pixlar vars RGB-avstånd till target < threshold.
    Vektoriellberäkning → snabb på 17M pixlar (~0.3s).
    """
    t = np.array(target_rgb, dtype=np.float32)
    diff = img_array.astype(np.float32) - t
    dist = np.sqrt((diff ** 2).sum(axis=2))
    return dist < threshold


# ─────────────────────────────────────────────────────────────────────────────
# Morfologisk stängning (fyller hål i hatch-mönster)
# ─────────────────────────────────────────────────────────────────────────────

def morphological_close(mask: np.ndarray, radius: int = 8) -> np.ndarray:
    """
    Binär closing. Försöker scipy (snabb C-implementation) → PIL-fallback.
    Fyller luckor i hatch-mönster så att regioner hänger ihop.
    """
    # Scipy är ~10× snabbare än PIL för stora bilder
    try:
        from scipy.ndimage import binary_dilation, binary_erosion
        # Cirkulär kernel är bättre än kvadratisk för naturliga former
        y, x = np.ogrid[-radius:radius+1, -radius:radius+1]
        struct = (x*x + y*y) <= radius*radius
        dilated = binary_dilation(mask, structure=struct)
        closed  = binary_erosion(dilated, structure=struct)
        return closed
    except ImportError:
        pass

    # PIL-fallback (långsammare men fungerar)
    from PIL import Image as PILImage, ImageFilter
    pil     = PILImage.fromarray(mask.astype(np.uint8) * 255)
    dilated = pil.filter(ImageFilter.MaxFilter(size=radius * 2 + 1))
    closed  = dilated.filter(ImageFilter.MinFilter(size=radius * 2 + 1))
    return np.array(closed) > 128


# ─────────────────────────────────────────────────────────────────────────────
# Connected-component labeling
# ─────────────────────────────────────────────────────────────────────────────

def label_components(mask: np.ndarray):
    """
    Returnerar (labeled_array, n_labels).
    Försöker scipy.ndimage.label; fallback: enkel BFS på nedsamplade bilden.
    """
    try:
        from scipy.ndimage import label as scipy_label
        struct = np.ones((3, 3), dtype=int)  # 8-konnektivitet
        return scipy_label(mask, structure=struct)
    except ImportError:
        pass

    # Fallback: BFS, nedsamplas 4× för hastighet
    h, w = mask.shape
    step = 4
    sm = mask[::step, ::step]
    sh, sw = sm.shape
    labels_sm = np.zeros((sh, sw), dtype=np.int32)
    label_id = 0

    for sy in range(sh):
        for sx in range(sw):
            if sm[sy, sx] and labels_sm[sy, sx] == 0:
                label_id += 1
                queue = [(sy, sx)]
                labels_sm[sy, sx] = label_id
                while queue:
                    cy, cx = queue.pop()
                    for dy in (-1, 0, 1):
                        for dx in (-1, 0, 1):
                            ny, nx = cy + dy, cx + dx
                            if 0 <= ny < sh and 0 <= nx < sw and sm[ny, nx] and labels_sm[ny, nx] == 0:
                                labels_sm[ny, nx] = label_id
                                queue.append((ny, nx))

    # Skala upp lablar till original-storlek
    # PIL stöder inte int32 direkt i alla versioner — använd float32 + round
    from PIL import Image as PILImage
    lbl_float = labels_sm.astype(np.float32)
    lbl_img   = PILImage.fromarray(lbl_float, mode="F")
    lbl_up    = lbl_img.resize((w, h), PILImage.NEAREST)
    labels    = np.array(lbl_up).round().astype(np.int32)
    # Nollställ pixlar som ej var i mask
    labels[~mask] = 0
    return labels, label_id


# ─────────────────────────────────────────────────────────────────────────────
# Konvext hölje (Graham scan)
# ─────────────────────────────────────────────────────────────────────────────

def convex_hull(points: list) -> list:
    """Graham scan. points: lista av (x, y)."""
    pts = sorted(set(points))
    if len(pts) < 3:
        return pts

    def cross(O, A, B):
        return (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0])

    lower = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)

    upper = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)

    return lower[:-1] + upper[:-1]


def subsample_hull_pts(region_pixels: np.ndarray, max_hull_pts: int = 60) -> list:
    """
    Subsamplar pixlarna för ett region_label och returnerar konvext hölje.
    region_pixels: array av (x, y)-koordinater.
    """
    pts = list(zip(region_pixels[1].tolist(), region_pixels[0].tolist()))  # (x, y)
    # Subsampla för hastighet vid stora regioner
    if len(pts) > 5000:
        step = max(1, len(pts) // 5000)
        pts = pts[::step]
    hull = convex_hull(pts)
    # Begränsa antal hörn
    if len(hull) > max_hull_pts:
        step = len(hull) // max_hull_pts
        hull = hull[::step]
    return hull


# ─────────────────────────────────────────────────────────────────────────────
# Huvudfunktion
# ─────────────────────────────────────────────────────────────────────────────

def compute_texture_sig(gray: np.ndarray):
    """
    Beräknar en enkel textursignatur för en gråskale-patch.
    Returnerar None om patchen är för liten eller ett fel uppstår.
      - grad_std:   std på Sobel-gradientmagnitud (hög = skarpa kanter/hatch)
      - dark_ratio: andel pixlar < 210 brightness (mörkt material vs vit bakgrund)
      - mean_val:   medelvärde (ljushet)
    """
    try:
        if gray is None or gray.size < 9:
            return None
        arr = gray.astype(np.float32)
        h, w = arr.shape
        if h < 3 or w < 3:
            return None
        # Sobel-liknande gradient (ingen scipy krävs)
        gx = arr[:, 2:] - arr[:, :-2]   # shape: (h, w-2)
        gy = arr[2:, :] - arr[:-2, :]   # shape: (h-2, w)
        mh = min(gx.shape[0], gy.shape[0])
        mw = min(gx.shape[1], gy.shape[1])
        if mh < 1 or mw < 1:
            return None
        grad = np.sqrt(gx[:mh, :mw] ** 2 + gy[:mh, :mw] ** 2)
        return {
            "grad_std":   float(np.std(grad)),
            "dark_ratio": float(np.mean(arr < 210)),
            "mean_val":   float(np.mean(arr)),
        }
    except Exception:
        return None


def texture_match(ref: dict, reg: dict) -> bool:
    """
    Returnerar True om regionen liknar referensens ljusmiljö.
    Enda kriteriet: ljusstyrkans medelvärde (mean_val) får inte avvika för mycket.
    Vi filtrerar BARA bort helt orimliga fall — hellre 10% för mycket än missa material.
    """
    if ref is None or reg is None:
        return True

    # Enda checken: genomsnittlig ljusstyrka.
    # Betongplattor (~ljusgrå, mean ~180) ska inte matchas mot mörka asfaltsytor (~mean ~60).
    # Tillåt ±55 i mean_val (väldigt generöst — täcker rendering-variationer).
    if abs(reg["mean_val"] - ref["mean_val"]) > 55:
        return False

    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--color",    required=True, help="Fallback-färg i hex (används om --seed-pt saknas)")
    ap.add_argument("--thresh",   type=float, default=40,
                    help="RGB-avståndströskel (0–255, default 40)")
    ap.add_argument("--png",      default="./output/ritning_p001.png")
    ap.add_argument("--scale",    type=float, default=59.06, help="px/m i PNG:en")
    ap.add_argument("--min-m2",   type=float, default=0.1,   help="Minsta area m²")
    ap.add_argument("--close-r",  type=int,   default=6,     help="Closing-radie (px)")
    ap.add_argument("--ref-bbox", default=None,
                    help="Referens-bbox i PNG-pixlar: x0,y0,w,h (för texturfiltrering)")
    ap.add_argument("--seed-pt",  default=None,
                    help="Fröpunkt i PNG-pixlar: x,y — samplar exakt PNG-färg utan renderingsskillnad")
    args = ap.parse_args()

    # Ladda PNG
    try:
        img = Image.open(args.png).convert("RGB")
    except Exception as e:
        print(json.dumps({"error": f"Kunde inte ladda PNG: {e}"}))
        sys.exit(1)

    img_array = np.array(img, dtype=np.uint8)
    h, w = img_array.shape[:2]
    px_per_m = args.scale

    # Konvertera till gråskala för texturanalys
    img_gray = np.array(img.convert("L"), dtype=np.uint8)

    target_rgb = hex_to_rgb(args.color)

    # ── Extrahera dominant materialfärg från ref-bbox (hela polygonens yta) ──
    # Hatch-mönster = 70-90% vita pixlar + materialfärgade linjer däremellan.
    # En enskild fröpunkt hamnar nästan alltid på ett VIT mellanrum.
    # Lösning: sampla ALLA pixlar i ref-bbox, filtrera bort vitt, ta medianen.
    seed_color_hex = args.color
    is_hatch       = False   # True om materialet är ett hatch-mönster
    bg_ratio       = 0.0     # andel vita/ljusa pixlar i referensytan

    def extract_material_color(region_pixels):
        """Hitta dominant icke-vit färg. Returnerar (rgb_tuple, bg_ratio, is_hatch)."""
        n_total = len(region_pixels)
        if n_total == 0:
            return None, 0.0, False
        # Ljusstyrka per pixel (medel av R,G,B)
        lum = region_pixels.mean(axis=1)

        # För hatch-mönster: många vita pixlar + färgade linjer.
        # Ta ENDAST de mörkare pixlarna (lum < 210) för att hitta material-färgen,
        # ignorera de vita pixlarna helt.
        dark_mask = lum < 210
        n_dark = int(dark_mask.sum())

        # Fallback: om för få mörka pixlar, expandera gränsen
        if n_dark < 5:
            dark_mask = lum < 230
            n_dark = int(dark_mask.sum())

        n_mat    = n_dark
        bg_r     = 1.0 - n_mat / n_total
        if n_mat < 5:
            return None, bg_r, False   # allt är vitt — ingen information

        # Ta ENDAST de mörkare pixlarna för median
        dark_px  = region_pixels[dark_mask]
        med      = np.median(dark_px, axis=0)
        rgb      = (int(round(med[0])), int(round(med[1])), int(round(med[2])))
        # Hatch-mönster: > 20% vitt — många VITA pixlar mellan linjerna
        hatch    = bg_r > 0.20
        return rgb, bg_r, hatch

    # 1. Prioritet: ref-bbox (bäst — hela polygonens area)
    # VIKTIGT: ref-bbox används för texturfiltrering oavsett om färgen är tillförlitlig.
    # Men om nästan allt i bbox är vitt (bg >= 95 %) har polygonen ritats
    # över ett hatch-mellanrum och den extraherade färgen är INTE materialfärgen.
    # I det fallet behåller vi --color (step9:s pixel_hex) som scanfärg.
    #
    # HATCH-UNDANTAG: Om materialet identifieras som hatch (bg 20–95%) litar vi
    # INTE på den extraherade färgen för att ange sökfärg — step9:s pixel_hex (--color)
    # är mer exakt (mätt direkt från poppler-PNG). Ref-bbox används ändå för textursignatur.
    if args.ref_bbox:
        try:
            bx0, by0, bw, bh = [int(v) for v in args.ref_bbox.split(",")]
            bx1 = min(w, bx0 + bw)
            by1 = min(h, by0 + bh)
            if bx1 > bx0 + 2 and by1 > by0 + 2:
                region_px = img_array[by0:by1, bx0:bx1].reshape(-1, 3).astype(np.float32)
                rgb, bg_ratio, is_hatch = extract_material_color(region_px)
                if rgb is not None and bg_ratio < 0.95 and not is_hatch:
                    # Solid fill med tillräckligt material — lita på extraktionen
                    target_rgb     = rgb
                    seed_color_hex = "#{:02X}{:02X}{:02X}".format(*rgb)
                    print(f"ref-bbox ({bw}×{bh}px) → {seed_color_hex} "
                          f"(bg={bg_ratio:.0%}, solid)", file=sys.stderr)
                elif rgb is not None and is_hatch:
                    # Hatch-mönster — använd step9:s pixel_hex (--color) istället,
                    # men spara is_hatch för adaptiv tröskel/closing.
                    # Den extraherade hatch-färgen är för osäker att söka efter.
                    print(f"ref-bbox ({bw}×{bh}px) hatch (bg={bg_ratio:.0%}) "
                          f"→ behåller step9 --color {args.color}", file=sys.stderr)
                else:
                    # Nästan all vit — polygonen hamnade i ett hatch-mellanrum.
                    # Behåll --color (step9:s pixel_hex) men ref-bbox används ändå för textur.
                    bg_str = f"{bg_ratio:.0%}" if rgb is not None else "okänd"
                    print(f"ref-bbox ({bw}×{bh}px) alltför vit (bg={bg_str}) "
                          f"→ behåller --color {args.color}", file=sys.stderr)
                    is_hatch = False  # Okänt — låt ljusstyrkan bestämma adaptiv tröskel
        except Exception as e:
            print(f"ref-bbox färgfel: {e}", file=sys.stderr)

    # 2. Fallback: seed-punkt om ref-bbox inte gav ett tillförlitligt svar
    # HOPPA ÖVER om ref-bbox redan identifierade materialet som hatch —
    # seed-pt landar ofta på fog/mellanrum och ger fel (mörkare) färg.
    # Hatch-material: step9:s pixel_hex (--color) är alltid mer tillförlitlig.
    if seed_color_hex == args.color and args.seed_pt and not is_hatch:
        try:
            sx, sy = [int(v) for v in args.seed_pt.split(",")]
            sx = max(0, min(w - 1, sx))
            sy = max(0, min(h - 1, sy))
            px0, px1 = max(0, sx - 8), min(w, sx + 9)
            py0, py1 = max(0, sy - 8), min(h, sy + 9)
            patch_px = img_array[py0:py1, px0:px1].reshape(-1, 3).astype(np.float32)
            rgb, bg_ratio, is_hatch = extract_material_color(patch_px)
            if rgb is not None and bg_ratio < 0.90:
                # Tätare hatchmönster kräver att minst 10 % är materialfärgade
                target_rgb     = rgb
                seed_color_hex = "#{:02X}{:02X}{:02X}".format(*rgb)
                print(f"seed-pt ({sx},{sy}) → {seed_color_hex} (bg={bg_ratio:.0%})", file=sys.stderr)
            elif rgb is not None:
                print(f"seed-pt ({sx},{sy}) alltför vit (bg={bg_ratio:.0%}) → ignoreras", file=sys.stderr)
        except Exception as e:
            print(f"seed_pt-fel: {e}", file=sys.stderr)

    # 3. Om ref-bbox och seed-pt inte satte en färg → använd --color (step9:s pixel_hex)
    # route.js skickar steg9:s pixel_hex som --color — alltid tillförlitligare än canvas-rendering.
    brightness = (target_rgb[0] + target_rgb[1] + target_rgb[2]) / 3.0
    if brightness > 238:
        # ref-bbox/seed gav nära-vit färg — försök med --color direkt
        fallback_rgb = hex_to_rgb(args.color)
        fallback_br  = sum(fallback_rgb) / 3.0
        if fallback_br < 238:
            target_rgb     = fallback_rgb
            seed_color_hex = args.color
            brightness     = fallback_br
            is_hatch       = False
            print(f"Nära-vit extraherad → fallback till --color {args.color}", file=sys.stderr)
        else:
            # Även --color är vit — ge ett vettigt felmeddelande
            print(json.dumps({
                "error": (
                    f"Kunde inte hitta materialfärg ({seed_color_hex}). "
                    "Rita polygonen direkt över ett färgat material, "
                    "inte över ett vitt papper-område."
                )
            }))
            sys.exit(0)

    # Om ingen av metoderna ändrade target_rgb — vi kör med --color direkt (steg9 pixel_hex)
    if seed_color_hex == args.color:
        print(f"Använder --color direkt: {args.color}", file=sys.stderr)

    # ── Anpassa tröskel och closing baserat på materialtyp ──────────────────
    # OBS: is_hatch ändrar INTE brightness-gränserna — det påverkar bara closing.
    # Hatch-mönster i medium-brightness-zonen (80–160, t.ex. betongplattor)
    # behöver SAMMA strikta tröskel (30) som solid fill — annars matchar vi
    # angränsande material med liknande nyans och tar in 3× för mycket area.
    if brightness > 220:
        # Nära-vit solid fill (ljusbeige, ljusgrå) — begränsad closing
        effective_thresh  = min(args.thresh, 22)
        effective_close_r = min(args.close_r, 3)
    elif brightness > 160:
        # Mediumljus solid fill (betongplattor, ljusgrå) — standard
        effective_thresh  = min(args.thresh, 32)
        effective_close_r = min(args.close_r, 5)
    elif brightness > 80:
        # Mellanton (hatch-mönster, beläggningar etc.).
        # Tröskel 30 är tight nog att undvika angränsande material med liknande nyans,
        # men täcker ändå de anti-aliasade linjerna ±30 från materialfärgen.
        effective_thresh  = min(args.thresh, 30)
        # Hatch-mönster i denna zonen behöver lite mer closing för att fylla luckor
        effective_close_r = min(args.close_r, 8) if is_hatch else min(args.close_r, 6)
    else:
        # Mörk/mättat
        effective_thresh  = min(args.thresh, 35)  # cap även mörka för att undvika svart-bredd
        effective_close_r = min(args.close_r, 8) if is_hatch else args.close_r

    print(f"Ljushet={brightness:.0f} is_hatch={is_hatch} → "
          f"tröskel={effective_thresh} closing={effective_close_r}", file=sys.stderr)

    # ── Referenstextur från användarens polygon-bbox ───────────────────────
    ref_tex = None
    if args.ref_bbox:
        try:
            bx0, by0, bw, bh = [int(v) for v in args.ref_bbox.split(",")]
            bx1 = min(w, bx0 + bw)
            by1 = min(h, by0 + bh)
            if bx1 > bx0 + 4 and by1 > by0 + 4:
                ref_patch = img_gray[by0:by1, bx0:bx1]
                ref_tex = compute_texture_sig(ref_patch)
        except Exception:
            pass  # om bbox är felformaterad — hoppa över texturfiltrering

    t0 = time.time()

    # 1. Pixelmask
    mask = make_mask(img_array, target_rgb, effective_thresh)
    print(f"mask: {int(mask.sum())}/{w*h} px matchade ({time.time()-t0:.1f}s)", file=sys.stderr)
    t1 = time.time()

    # 2. Morfologisk stängning (fyller gaps i hatch — ej för ljusa solid-fill)
    if effective_close_r > 0:
        mask = morphological_close(mask, radius=effective_close_r)
    print(f"closing: klar ({time.time()-t1:.1f}s)", file=sys.stderr)
    t2 = time.time()

    # 3. Connected-component labeling
    labeled, n_labels = label_components(mask)
    print(f"labeling: {n_labels} labels ({time.time()-t2:.1f}s)", file=sys.stderr)

    min_px = max(1, int((args.min_m2 * px_per_m ** 2)))  # m² → pixlar

    # 4. Extrahera regioner
    # OPTIMERING: använd bincount för att filtrera bort små labels INNAN np.where-loopen.
    # Utan detta: O(n_labels × H × W) — med 11 000 labels tar det minuter.
    # Med bincount: O(H×W) en gång, sedan O(k) där k << n_labels.
    counts = np.bincount(labeled.ravel(), minlength=n_labels + 1).astype(np.int64)
    large_ids = np.where(counts >= min_px)[0]
    large_ids = large_ids[large_ids > 0]  # ta bort bakgrund (label 0)
    print(f"filter: {len(large_ids)}/{n_labels} labels ≥ {min_px}px ({args.min_m2}m²)", file=sys.stderr)

    regions = []
    skipped_texture = 0
    for lid in large_ids:
        region_idx = np.where(labeled == lid)
        n_px = int(counts[lid])
        # Bounding box
        ry0, ry1 = int(region_idx[0].min()), int(region_idx[0].max())
        rx0, rx1 = int(region_idx[1].min()), int(region_idx[1].max())

        # ── Texturfiltrering mot referens ──────────────────────────────────
        if ref_tex is not None and (ry1 - ry0) > 4 and (rx1 - rx0) > 4:
            try:
                region_patch = img_gray[ry0:ry1, rx0:rx1]
                reg_tex = compute_texture_sig(region_patch)
                if not texture_match(ref_tex, reg_tex):
                    skipped_texture += 1
                    continue
            except Exception:
                pass  # vid fel → inkludera regionen (hellre för mycket än för lite)

        # Area i m²
        area_m2 = n_px / (px_per_m ** 2)

        # Konvext hölje (PNG-pixlar)
        hull_pts = subsample_hull_pts(region_idx)

        regions.append({
            "area_m2":      round(area_m2, 3),
            "n_pixels":     n_px,
            "bbox_png":     [rx0, ry0, rx1, ry1],
            "hull_png_pts": [[x, y] for x, y in hull_pts],
        })

    # Sortera störst först
    regions.sort(key=lambda r: r["area_m2"], reverse=True)

    total_area = sum(r["area_m2"] for r in regions)
    print(f"Resultat: {len(regions)} regioner, {total_area:.1f} m², "
          f"{skipped_texture} filtrerade av textur, "
          f"mask_px={int(mask.sum())}/{w*h}", file=sys.stderr)

    output = {
        "target_color":    args.color,
        "seed_color":      seed_color_hex,
        "effective_thresh": effective_thresh,
        "effective_close_r": effective_close_r,
        "png_size":        [w, h],
        "px_per_m":        px_per_m,
        "total_regions":   len(regions),
        "total_area_m2":   round(total_area, 2),
        "skipped_texture": skipped_texture,
        "ref_tex":         ref_tex,
        "regions":         regions,
    }
    print(json.dumps(output))


if __name__ == "__main__":
    main()
