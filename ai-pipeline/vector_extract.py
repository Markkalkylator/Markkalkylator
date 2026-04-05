#!/usr/bin/env python3
"""
vector_extract.py — Vektorbaserad materialextraktion från step7_refined.json
=============================================================================
Ersätter scan_pattern.py med en deterministisk, pixel-oberoende approach.

Istället för att söka igenom PNG-pixels med RGB-trösklar hämtar detta
script färdiga polygon-data från step7:s PDF-vektoranalys. Resultaten är:
  - Exakta areas (från PDF-geometri, inte pixelräkning)
  - Stabila polygoner oavsett rendering, DPI eller komprimering
  - Ingen tröskelkalibrering behövs

Argument:
  --color     Sökfärg i hex (#708462 eller liknande) — matchas mot fill_color_hex
  --step7     Sökväg till step7_refined.json (default: ./output/step7_refined.json)
  --png-w     PNG-bredd i pixlar (för koordinatvalidering)
  --png-h     PNG-höjd i pixlar
  --min-m2    Minsta zon att inkludera (default: 0.1 m²)
  --fuzzy     Tillåtet RGB-avstånd för färgmatchning (default: 20)

Returnerar JSON på stdout (samma format som scan_pattern.py):
  {
    "source": "vector",
    "target_color": "#59794C",
    "matched_color": "#59794C",
    "total_area_m2": 42.82,
    "total_regions": 6,
    "regions": [
      {
        "area_m2": 8.4,
        "n_pixels": null,
        "hull_png_pts": [[x,y], ...],
        "bbox_png": [x, y, w, h],
        "confidence": 1.0,
        "zone_id": "mc_0003_z0"
      }, ...
    ]
  }
"""

import sys
import json
import math
import argparse


def hex_to_rgb(h: str) -> tuple:
    h = h.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def rgb_distance(a: tuple, b: tuple) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def hull_pts_to_bbox(pts):
    """Returnerar [x_min, y_min, w, h] från lista av [x,y]-punkter."""
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    x0, y0 = min(xs), min(ys)
    x1, y1 = max(xs), max(ys)
    return [round(x0, 1), round(y0, 1), round(x1 - x0, 1), round(y1 - y0, 1)]


def shoelace_area(pts):
    """Beräkna area för polygon via Shoelace-formeln."""
    n = len(pts)
    if n < 3:
        return 0.0
    a = 0.0
    for i in range(n):
        j = (i + 1) % n
        a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]
    return abs(a) / 2.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--color",  required=True, help="Sökfärg i hex (#RRGGBB)")
    ap.add_argument("--step7",  default="./output/step7_refined.json")
    ap.add_argument("--png-w",  type=int, default=None)
    ap.add_argument("--png-h",  type=int, default=None)
    ap.add_argument("--min-m2", type=float, default=0.1)
    ap.add_argument("--fuzzy",  type=float, default=20.0,
                    help="Max RGB-avstånd för färgmatchning (default 20)")
    args = ap.parse_args()

    # ── Ladda step7 ──────────────────────────────────────────────────
    try:
        with open(args.step7) as f:
            step7 = json.load(f)
    except FileNotFoundError:
        print(json.dumps({"error": f"step7 saknas: {args.step7}"}))
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"step7 är ogiltig JSON: {e}"}))
        sys.exit(1)

    candidates = step7.get("refined_candidates", [])
    if not candidates:
        print(json.dumps({"error": "step7 innehåller inga refined_candidates"}))
        sys.exit(1)

    # ── Färgmatchning ─────────────────────────────────────────────────
    target_rgb = hex_to_rgb(args.color)

    best_candidate = None
    best_dist = float("inf")

    for cand in candidates:
        fill_hex = cand.get("fill_color_hex", "")
        if not fill_hex:
            continue
        try:
            cand_rgb = hex_to_rgb(fill_hex)
        except (ValueError, TypeError):
            continue
        dist = rgb_distance(target_rgb, cand_rgb)
        if dist < best_dist:
            best_dist = dist
            best_candidate = cand

    if best_candidate is None or best_dist > args.fuzzy:
        # Inga matchande material — returnera 0 regioner (inte ett fel)
        print(json.dumps({
            "source":       "vector",
            "target_color": args.color,
            "matched_color": None,
            "match_distance": round(best_dist, 1) if best_candidate else None,
            "total_area_m2": 0.0,
            "total_regions": 0,
            "regions": [],
            "note": f"Ingen kandidat inom RGB-avstånd {args.fuzzy} — närmast: {best_candidate.get('fill_color_hex','?')} (dist={round(best_dist,1)})" if best_candidate else "Inga kandidater"
        }))
        sys.exit(0)

    matched_color = best_candidate["fill_color_hex"]
    total_area_m2 = best_candidate.get("total_area_m2", 0.0)

    print(f"Matchade {args.color} → {matched_color} (dist={best_dist:.1f}, area={total_area_m2:.2f}m²)",
          file=sys.stderr)

    # ── Extrahera sub_zones → regions ────────────────────────────────
    sub_zones = best_candidate.get("sub_zones", [])
    regions = []

    for zone in sub_zones:
        zone_id   = zone.get("sub_id", "?")
        # Föredra sum_poly_area_m2 (exakt summa av individuella polygoners area)
        # framför hull_area_m2 (konvex hull — alltid överskattning)
        zone_area = (zone.get("sum_poly_area_m2") or
                     zone.get("area_m2") or
                     None)

        # Hämta hull-punkter i PNG-koordinater
        hull_pts = zone.get("hull_pts_image")  # redan i PNG-pixlar

        if not hull_pts or len(hull_pts) < 3:
            print(f"  Zonen {zone_id} saknar hull_pts_image — hoppar över",
                  file=sys.stderr)
            continue

        # Runda koordinater till heltal (PNG-pixlar är hela)
        pts = [[round(float(p[0])), round(float(p[1]))] for p in hull_pts]

        # Beräkna area från zone-data (hellre än från hull-polygon)
        if zone_area is None:
            # Försök med exakta polygon-summor från step7
            zone_area = (zone.get("sum_poly_area_m2") or
                         zone.get("hull_area_m2") or
                         total_area_m2 / max(len(sub_zones), 1))

        if zone_area < args.min_m2:
            print(f"  Zonen {zone_id} för liten ({zone_area:.3f}m² < {args.min_m2}m²) — hoppar",
                  file=sys.stderr)
            continue

        bbox = hull_pts_to_bbox(pts)

        regions.append({
            "area_m2":      round(zone_area, 4),
            "n_pixels":     None,           # vektorbased — ingen pixelräkning
            "hull_png_pts": pts,
            "bbox_png":     bbox,
            "confidence":   1.0,            # exakt från PDF-vektordata
            "zone_id":      zone_id,
        })

    # Sortera störst area först
    regions.sort(key=lambda r: -r["area_m2"])

    # Summera exakta zon-areor (mer korrekt än kandidatens total_area_m2)
    actual_total = sum(r["area_m2"] for r in regions)
    # Om inga zoner klarade min_m2-filtret, fall back på kandidatens värde
    reported_total = actual_total if actual_total > 0 else total_area_m2

    # ── Rapportera ───────────────────────────────────────────────────
    for i, r in enumerate(regions):
        print(f"  Region {i+1}: {r['area_m2']:.2f}m²  hull={len(r['hull_png_pts'])}pts"
              f"  bbox_png={r['bbox_png']}", file=sys.stderr)

    print(f"Totalt: {len(regions)} regioner, {reported_total:.2f}m² (kandidat: {total_area_m2:.2f}m²)",
          file=sys.stderr)

    result = {
        "source":        "vector",
        "target_color":  args.color,
        "matched_color": matched_color,
        "match_distance": round(best_dist, 1),
        "total_area_m2": round(reported_total, 4),
        "total_regions": len(regions),
        "skipped_texture": 0,
        "regions":       regions,
    }

    print(json.dumps(result))


if __name__ == "__main__":
    main()
