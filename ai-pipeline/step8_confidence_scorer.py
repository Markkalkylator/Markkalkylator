"""
AI Pipeline - Steg 8: Konfidenspoängsättning och mängdningstabell
=================================================================
Syfte:
    Beräknar ett slutligt, vägt konfidenspoäng per material-kandidat
    baserat på alla tillgängliga signaler från steg 1-7.
    Producerar den slutliga mängdningstabellen redo för human-in-the-loop.

Konfidensmodell (4 signaler):
    color_score    (w=0.40) — färgmatchningskonfidans från steg 3/5
    patch_score    (w=0.25) — visuell patchlikhet från steg 5
    spatial_score  (w=0.20) — spatial koherens (inverse hull-avvikelse)
    evidence_score (w=0.15) — bevisvärde (hatch-tiles, legend-träffar)

Straffaktorer:
    - Färgkonflikt:           × 0.70
    - Hull-avvikelse > 100%:  × (1 − avvikelse/1000), min 0.10
    - Mer än 4 sub-zoner:     × 0.90
    - Källa = hatch_cluster:  × 0.85 (ingen exakt polygon)

Review-prioritet:
    critical  — unmatched + stor area (> 10 m²)
    high      — unmatched ELLER final_score < 0.30
    medium    — conflict ELLER 0.30 ≤ score < 0.60
    low       — score ≥ 0.60

Output:
    step8_scored.json        — fullständigt scorat resultat
    step8_takeoff_table.json — mängdningstabell (kompakt, UI-redo)
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import asdict, dataclass, field
from typing import Literal

# ---------------------------------------------------------------------------
# Viktkoefficienter
# ---------------------------------------------------------------------------

W_COLOR    = 0.40
W_PATCH    = 0.25
W_SPATIAL  = 0.20
W_EVIDENCE = 0.15

# Penaltyfaktorer
PENALTY_CONFLICT    = 0.70
PENALTY_HULL_MAX    = 0.10   # minimum efter hull-avvikelse-penalty
PENALTY_MANY_ZONES  = 0.90   # > 4 sub-zoner
PENALTY_HATCH_SRC   = 0.85   # hatch_cluster-källa

ReviewPriority = Literal["critical", "high", "medium", "low"]


# ---------------------------------------------------------------------------
# Ladda steg 3 patch-konfidanser
# ---------------------------------------------------------------------------

def _load_patch_confidence(step3_data: dict) -> dict[str, float]:
    """hex_upper → bästa patch_confidence från steg 3 legend_items."""
    best: dict[str, float] = {}
    for item in step3_data.get("legend_items", []):
        hex_c = (item.get("fill_color_hex") or "").upper()
        conf = item.get("match_confidence") or 0.0
        if conf > best.get(hex_c, 0.0):
            best[hex_c] = conf
    return best


def _load_patch_similarity(step5_data: dict) -> dict[str, float]:
    """hex_upper → bästa patch_similarity (bildpatch) från steg 5."""
    best: dict[str, float] = {}
    for region in step5_data.get("classified_regions", []):
        hex_c = region["fill_color_hex"].upper()
        pc = region.get("patch_confidence") or 0.5
        if pc > best.get(hex_c, 0.0):
            best[hex_c] = pc
    return best


def _load_tile_counts(step5_data: dict) -> dict[str, int]:
    """hex_upper → totalt antal hatch-tiles."""
    counts: dict[str, int] = {}
    for g in step5_data.get("color_map", {}).items():
        hex_c, info = g
        counts[hex_c.upper()] = info.get("total_tiles", 0)
    return counts


# ---------------------------------------------------------------------------
# Konfidensberäkning
# ---------------------------------------------------------------------------

def _spatial_score(discrepancy_pct: float) -> float:
    """
    Konverterar hull-avvikelse till spatial_score (0–1).
    0% avvikelse → 1.0, 500%+ → 0.0.
    """
    if discrepancy_pct <= 0:
        return 1.0
    score = max(0.0, 1.0 - discrepancy_pct / 500.0)
    return round(score, 3)


def _evidence_score(tile_count: int, legend_items_matched: int) -> float:
    """
    Bevisvärde baserat på antal hatch-tiles och legend-träffar.
    Logistisk funktion: 5000 tiles → ~0.85, 100 tiles → ~0.50.
    """
    if tile_count == 0 and legend_items_matched == 0:
        return 0.0
    # Normalisera tile-count logaritmiskt
    import math
    tile_score = math.log1p(tile_count) / math.log1p(10000)
    legend_score = min(1.0, legend_items_matched / 3.0)
    return round(tile_score * 0.7 + legend_score * 0.3, 3)


def _compute_penalty(
    status: str,
    discrepancy_pct: float,
    n_zones: int,
    source: str,
) -> tuple[float, list[str]]:
    """Beräknar multiplikativ penalty-faktor och förklaring."""
    penalty = 1.0
    reasons = []

    if status == "conflict":
        penalty *= PENALTY_CONFLICT
        reasons.append(f"färgkonflikt (×{PENALTY_CONFLICT})")

    if discrepancy_pct > 100:
        p = max(PENALTY_HULL_MAX, 1.0 - discrepancy_pct / 1000.0)
        penalty *= p
        reasons.append(f"hull-avvikelse {discrepancy_pct:.0f}% (×{p:.2f})")

    if n_zones > 4:
        penalty *= PENALTY_MANY_ZONES
        reasons.append(f"{n_zones} sub-zoner (×{PENALTY_MANY_ZONES})")

    if source == "hatch_cluster":
        penalty *= PENALTY_HATCH_SRC
        reasons.append(f"hatch-kluster utan exakt polygon (×{PENALTY_HATCH_SRC})")

    return round(penalty, 3), reasons


def _review_priority(
    status: str,
    final_score: float,
    area_m2: float,
) -> ReviewPriority:
    if status == "unmatched" and area_m2 > 10:
        return "critical"
    if status == "unmatched" or final_score < 0.30:
        return "high"
    if status == "conflict" or final_score < 0.60:
        return "medium"
    return "low"


# ---------------------------------------------------------------------------
# Dataklasser
# ---------------------------------------------------------------------------

@dataclass
class ConfidenceBreakdown:
    color_score:    float
    patch_score:    float
    spatial_score:  float
    evidence_score: float
    weighted_raw:   float   # före penalty
    penalty_factor: float
    penalty_reasons: list[str]
    final_score:    float


@dataclass
class ScoredCandidate:
    id: str
    source_candidate_id: str
    page_number: int
    fill_color_hex: str
    material_category: str
    material_label: str
    material_label_short: str
    status: str
    review_priority: ReviewPriority
    confidence: ConfidenceBreakdown
    area_m2: float
    area_method: str
    n_zones: int
    n_polygons: int
    has_exact_geometry: bool
    requires_human_review: bool
    review_reason: str | None
    quantity_unit: str
    is_active: bool


@dataclass
class TakeoffRow:
    """En rad i mängdningstabellen — klar för UI."""
    rank: int
    id: str
    fill_color_hex: str
    material_category: str
    material_label: str
    area_m2: float
    confidence_score: float
    review_priority: ReviewPriority
    status: str
    n_zones: int
    requires_human_review: bool
    review_reason: str | None
    is_active: bool
    auto_accepted: bool         # True om score ≥ auto_accept_threshold


@dataclass
class ScoringResult:
    pdf_path: str
    page_number: int
    scale_denom: float
    auto_accept_threshold: float
    scored_candidates: list[ScoredCandidate] = field(default_factory=list)
    takeoff_table: list[TakeoffRow] = field(default_factory=list)
    summary: dict = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Huvudfunktion
# ---------------------------------------------------------------------------

def score_candidates(
    step3_json_path: str,
    step5_json_path: str,
    step7_json_path: str,
    output_dir: str = "./output",
    auto_accept_threshold: float = 0.65,
) -> ScoringResult:
    """
    Beräknar slutliga konfidenspoäng och mängdningstabell.

    Args:
        step3_json_path:        step3_result.json
        step5_json_path:        step5_result.json
        step7_json_path:        step7_refined.json
        output_dir:             Utdatamapp
        auto_accept_threshold:  Score ≥ detta → auto-accepterad

    Returns:
        ScoringResult
    """
    with open(step3_json_path, encoding="utf-8") as f:
        s3 = json.load(f)
    with open(step5_json_path, encoding="utf-8") as f:
        s5 = json.load(f)
    with open(step7_json_path, encoding="utf-8") as f:
        s7 = json.load(f)

    pdf_path  = s7.get("pdf_path", "")
    page_num  = s7.get("page_number", 1)
    scale     = s7.get("scale_denom", 200.0)

    # Signaler från alla steg
    patch_conf_by_color   = _load_patch_confidence(s3)
    patch_sim_by_color    = _load_patch_similarity(s5)
    tile_counts           = _load_tile_counts(s5)
    legend_items_by_color = {}
    for item in s3.get("legend_items", []):
        hc = (item.get("fill_color_hex") or "").upper()
        legend_items_by_color.setdefault(hc, []).append(item)

    result = ScoringResult(
        pdf_path=pdf_path,
        page_number=page_num,
        scale_denom=scale,
        auto_accept_threshold=auto_accept_threshold,
    )

    scored: list[ScoredCandidate] = []

    for rc in s7.get("refined_candidates", []):
        hex_c  = rc["fill_color_hex"].upper()
        status = rc["status"]
        source_id = rc["source_candidate_id"]
        area   = rc["total_area_m2"]
        disc   = rc["area_discrepancy_pct"]
        n_zones = len(rc["sub_zones"])
        n_polys = rc["total_polygon_count"]

        # Hämta source från steg 6 (area_polygon/hatch_cluster/merged)
        # Approximation: om n_polys == 0 → hatch_cluster
        source = "hatch_cluster" if n_polys == 0 else "area_polygon"

        # === Signal 1: Färgkonfidans (steg 3 legend-match) ===
        cs = patch_conf_by_color.get(hex_c, 0.0)
        if status == "unmatched":
            cs = 0.0

        # === Signal 2: Bildpatch-likhet (steg 5) ===
        ps = patch_sim_by_color.get(hex_c, 0.5)
        if status == "unmatched":
            ps = 0.0

        # === Signal 3: Spatial koherens (steg 7 hull-avvikelse) ===
        ss = _spatial_score(disc)

        # === Signal 4: Bevisvärde (tiles + legend-träffar) ===
        tiles = tile_counts.get(hex_c, 0)
        legend_hits = len(legend_items_by_color.get(hex_c, []))
        es = _evidence_score(tiles, legend_hits)
        if status == "unmatched":
            es = 0.0

        # Viktat råpoäng
        raw = (W_COLOR * cs + W_PATCH * ps + W_SPATIAL * ss + W_EVIDENCE * es)

        # Penalty
        penalty, p_reasons = _compute_penalty(status, disc, n_zones, source)
        final = round(raw * penalty, 3) if status != "unmatched" else 0.0
        final = min(1.0, max(0.0, final))

        priority = _review_priority(status, final, area)

        breakdown = ConfidenceBreakdown(
            color_score=round(cs, 3),
            patch_score=round(ps, 3),
            spatial_score=round(ss, 3),
            evidence_score=round(es, 3),
            weighted_raw=round(raw, 3),
            penalty_factor=penalty,
            penalty_reasons=p_reasons,
            final_score=final,
        )

        sc = ScoredCandidate(
            id=f"sc_{rc['id']}",
            source_candidate_id=source_id,
            page_number=page_num,
            fill_color_hex=hex_c,
            material_category=rc["material_category"],
            material_label=rc["material_label_short"],
            material_label_short=rc["material_label_short"],
            status=status,
            review_priority=priority,
            confidence=breakdown,
            area_m2=area,
            area_method=rc["area_method"],
            n_zones=n_zones,
            n_polygons=n_polys,
            has_exact_geometry=(n_polys > 0),
            requires_human_review=rc["requires_human_review"],
            review_reason=rc.get("review_reason"),
            quantity_unit=rc.get("quantity_unit", "m2"),
            is_active=rc.get("is_active", False),
        )
        scored.append(sc)

    # Sortera: priority (critical→low) + score desc
    prio_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    scored.sort(key=lambda s: (prio_order[s.review_priority], -s.confidence.final_score))

    result.scored_candidates = scored

    # --- Mängdningstabell ---
    rank = 0
    for sc in sorted(scored, key=lambda s: -s.area_m2):
        rank += 1
        auto = sc.confidence.final_score >= auto_accept_threshold
        result.takeoff_table.append(TakeoffRow(
            rank=rank,
            id=sc.id,
            fill_color_hex=sc.fill_color_hex,
            material_category=sc.material_category,
            material_label=sc.material_label_short,
            area_m2=sc.area_m2,
            confidence_score=sc.confidence.final_score,
            review_priority=sc.review_priority,
            status=sc.status,
            n_zones=sc.n_zones,
            requires_human_review=sc.requires_human_review,
            review_reason=sc.review_reason,
            is_active=sc.is_active,
            auto_accepted=auto,
        ))

    # Sammanfattning
    auto_rows = [r for r in result.takeoff_table if r.auto_accepted]
    review_rows = [r for r in result.takeoff_table if not r.auto_accepted]

    result.summary = {
        "total_candidates":        len(scored),
        "auto_accepted":           len(auto_rows),
        "needs_review":            len(review_rows),
        "auto_accepted_area_m2":   round(sum(r.area_m2 for r in auto_rows), 2),
        "review_area_m2":          round(sum(r.area_m2 for r in review_rows), 2),
        "total_area_m2":           round(sum(r.area_m2 for r in result.takeoff_table), 2),
        "priority_breakdown": {
            "critical": sum(1 for s in scored if s.review_priority == "critical"),
            "high":     sum(1 for s in scored if s.review_priority == "high"),
            "medium":   sum(1 for s in scored if s.review_priority == "medium"),
            "low":      sum(1 for s in scored if s.review_priority == "low"),
        },
        "auto_accept_threshold": auto_accept_threshold,
    }

    # Varna om stora ytor hamnar i critical/high
    critical = [r for r in result.takeoff_table if r.review_priority == "critical"]
    if critical:
        total_crit_area = sum(r.area_m2 for r in critical)
        result.warnings.append(
            f"{len(critical)} kandidat(er) med CRITICAL-prioritet "
            f"({total_crit_area:.1f} m²) — saknar legendmatchning och är stora ytor. "
            "Manuell tilldelning krävs."
        )

    # Spara
    os.makedirs(output_dir, exist_ok=True)

    full_path = os.path.join(output_dir, "step8_scored.json")
    with open(full_path, "w", encoding="utf-8") as f:
        json.dump(asdict(result), f, ensure_ascii=False)

    takeoff_path = os.path.join(output_dir, "step8_takeoff_table.json")
    with open(takeoff_path, "w", encoding="utf-8") as f:
        json.dump([asdict(r) for r in result.takeoff_table], f,
                  ensure_ascii=False, indent=2)

    return result


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    import argparse
    parser = argparse.ArgumentParser(
        description="Step 8: Konfidenspoängsättning och mängdningstabell.")
    parser.add_argument("--step3-json", required=True)
    parser.add_argument("--step5-json", required=True)
    parser.add_argument("--step7-json", required=True)
    parser.add_argument("--output-dir", default="./output")
    parser.add_argument("--threshold", type=float, default=0.65,
                        help="Auto-accepteringströskel (default: 0.65)")
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()

    result = score_candidates(
        step3_json_path=args.step3_json,
        step5_json_path=args.step5_json,
        step7_json_path=args.step7_json,
        output_dir=args.output_dir,
        auto_accept_threshold=args.threshold,
    )

    if args.pretty:
        print(json.dumps(result.summary, indent=2, ensure_ascii=False))
    else:
        print(json.dumps(asdict(result), ensure_ascii=False))

    print(f"\n[Sparat till {args.output_dir}/step8_scored.json]", file=sys.stderr)
    print(f"[Sparat till {args.output_dir}/step8_takeoff_table.json]", file=sys.stderr)


if __name__ == "__main__":
    main()
