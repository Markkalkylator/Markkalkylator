import { NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";

export const runtime = "nodejs";

/**
 * GET /api/ai-takeoff
 *
 * Returnerar step9-kandidater normaliserade för UI:t,
 * plus polygon-koordinater från step7 (hull_pts_pdf) och
 * PDF-dimensioner så klienten kan omvandla PDF-pt → canvas-px.
 */
export async function GET() {
  try {
    const outputDir = path.join(process.cwd(), "ai-pipeline", "output");

    // ── Läs step9 (föredragen) eller step8 som fallback ──────────────────
    let tableData, usedFile;
    for (const fname of ["step9_takeoff_table.json", "step8_takeoff_table.json"]) {
      try {
        const raw = await fs.readFile(path.join(outputDir, fname), "utf8");
        tableData = JSON.parse(raw);
        usedFile = fname;
        break;
      } catch { /* prova nästa */ }
    }
    if (!tableData) {
      return NextResponse.json(
        { error: "Ingen AI-analys hittades. Kör pipeline:n först." },
        { status: 404 }
      );
    }
    const rows = Array.isArray(tableData) ? tableData : (tableData.rows || []);

    // ── Läs step7 för polygondata (hull_pts_pdf per sub-zon) ─────────────
    let polygonsByColor = {};  // fill_color_hex → [hull_pts_pdf, ...]
    try {
      const s7raw = await fs.readFile(path.join(outputDir, "step7_refined.json"), "utf8");
      const s7 = JSON.parse(s7raw);
      for (const rc of (s7.refined_candidates || [])) {
        const hulls = (rc.sub_zones || [])
          .map(z => z.hull_pts_pdf)
          .filter(h => h && h.length >= 3);
        if (hulls.length > 0) {
          polygonsByColor[rc.fill_color_hex.toUpperCase()] = hulls;
        }
      }
    } catch { /* step7 saknas → inga polygoner */ }

    // ── Läs PDF-dimensioner från step1 ───────────────────────────────────
    let pdfDims = { width_pt: 1190.55, height_pt: 842.0 };
    try {
      const s1raw = await fs.readFile(path.join(outputDir, "step1_result.json"), "utf8");
      const s1 = JSON.parse(s1raw);
      const page = (s1.pages && s1.pages[0]) || {};
      pdfDims = {
        width_pt:  page.width_pt  || s1.page_width_pt  || 1191,
        height_pt: page.height_pt || s1.page_height_pt || 842,
      };
    } catch { /* använd default */ }

    // ── Normalisera kandidater ────────────────────────────────────────────
    const candidates = rows.map(r => {
      const hexUp = (r.fill_color_hex || "").toUpperCase();
      return {
        id:               r.id,
        rank:             r.rank,
        fill_color_hex:   r.fill_color_hex,
        matched_legend_hex: r.matched_legend_hex || r.fill_color_hex,
        match_type:       r.match_type || "exact",
        material_label:   r.material_label || r.material_label_short || "(okänd)",
        material_category: r.material_category || "okänd",
        area_m2:          r.area_m2,
        confidence_score: r.confidence_score,
        review_priority:  r.review_priority,
        auto_accepted:    r.auto_accepted || false,
        is_conflict:      r.is_conflict || false,
        requires_human_review: r.requires_human_review !== false,
        pixel_hex:        r.pixel_hex || null,
        delta_e_img_vs_pdf: r.delta_e_img_vs_pdf || null,
        rgb_consistency:  r.rgb_consistency || null,
        hatch_texture_score: r.hatch_texture_score || null,
        nn_suggestions:   r.nn_suggestions || [],
        // Polygon-koordinater (PDF-punkter) för auto-rita på canvas
        hull_polygons_pdf: polygonsByColor[hexUp] || [],
      };
    });

    const totalArea = candidates.reduce((s, c) => s + c.area_m2, 0);
    const autoArea  = candidates.filter(c => c.auto_accepted).reduce((s, c) => s + c.area_m2, 0);
    const byPriority = { critical: 0, high: 0, medium: 0, low: 0 };
    candidates.forEach(c => { byPriority[c.review_priority] = (byPriority[c.review_priority] || 0) + 1; });

    const summary = {
      total_candidates:      candidates.length,
      auto_accepted:         candidates.filter(c => c.auto_accepted).length,
      needs_review:          candidates.filter(c => !c.auto_accepted).length,
      total_area_m2:         Math.round(totalArea * 10) / 10,
      auto_accepted_area_m2: Math.round(autoArea * 10) / 10,
      review_area_m2:        Math.round((totalArea - autoArea) * 10) / 10,
      priority_breakdown:    byPriority,
      source_file:           usedFile,
    };

    return NextResponse.json({
      candidates,
      summary,
      pdf_dims: pdfDims,   // ← används av klienten för PDF→canvas transform
      generated_at: new Date().toISOString(),
    });

  } catch (err) {
    console.error("[ai-takeoff] Fel:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
