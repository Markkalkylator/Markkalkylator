import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

/**
 * Läs PNG-dimensioner direkt från filhuvudet (24 bytes) — inga extra paket.
 * PNG-format: 8-byte signatur + IHDR (4 len + 4 "IHDR" + 4 width + 4 height + ...)
 * Width finns vid offset 16, height vid offset 20 (big-endian uint32).
 */
async function getPngDimensions(pngPath) {
  const buf = Buffer.alloc(24);
  const fh  = await fs.open(pngPath, "r");
  try { await fh.read(buf, 0, 24, 0); }
  finally { await fh.close(); }
  // Validera PNG-signatur
  const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (buf[i] !== PNG_SIG[i]) throw new Error("Inte en PNG");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * POST /api/ai-scan
 *
 * Skannar hela den renderade PNG:en efter alla regioner med en given färg.
 * Exakt samma princip som Planswift/Bluebeam: ange en färg → systemet
 * hittar varje pixel med den färgen, grupperar dem och räknar ytan.
 *
 * Body:
 *   color_hex    — målfärg (t.ex. "#708462" eller "#59794C")
 *   threshold    — RGB-avståndströskel 0–255 (default 40)
 *   min_area_m2  — minsta region att inkludera (default 0.1)
 *   close_radius — morfologisk closing-radie px (default 6)
 *
 * Returnerar:
 *   { regions: [{area_m2, hull_png_pts, n_pixels, bbox_png}],
 *     total_regions, total_area_m2, png_size, px_per_m }
 */
export async function POST(req) {
  try {
    const body = await req.json();
    const {
      color_hex,
      threshold    = 40,
      min_area_m2  = 0.1,
      close_radius = 6,
      canvas_pts   = null,   // [[x,y],...] i canvas-pixlar
      canvas_size  = null,   // [width, height] i canvas-pixlar
    } = body;

    if (!color_hex) {
      return NextResponse.json({ error: "color_hex saknas" }, { status: 400 });
    }

    const pipelineDir = path.join(process.cwd(), "ai-pipeline");
    const outputDir   = path.join(pipelineDir, "output");

    // ── Korsreferera mot step9 — hämta fill_color_hex och pixel_hex ─────────
    // fill_color_hex = exakt PDF-vektorfärg (används för vector_extract.py)
    // pixel_hex      = Popper-renderad PNG-färg (används för scan_pattern.py fallback)
    let resolvedColor  = color_hex;   // pixel_hex (för pixelscanning)
    let fillColorHex   = null;        // fill_color_hex (för vektorextraktion)
    let step9Label     = null;
    let step9Area      = null;

    function hexToRgb(h) {
      h = h.replace("#","");
      return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
    }
    function colorDist(a, b) {
      const [r1,g1,b1] = hexToRgb(a), [r2,g2,b2] = hexToRgb(b);
      return Math.sqrt((r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2);
    }

    try {
      const s9raw = await fs.readFile(path.join(outputDir, "step9_takeoff_table.json"), "utf8");
      const s9 = JSON.parse(s9raw);
      const candidates = Array.isArray(s9) ? s9 : (s9.candidates || []);

      let bestDist = Infinity, bestCandidate = null;
      for (const c of candidates) {
        if (!c.pixel_hex) continue;
        // Jämför inkommande färg mot både fill_color_hex och pixel_hex
        const d1 = colorDist(color_hex, c.fill_color_hex || "#000000");
        const d2 = colorDist(color_hex, c.pixel_hex);
        const d  = Math.min(d1, d2);
        if (d < bestDist) { bestDist = d; bestCandidate = c; }
      }

      // Tröskel 60 i RGB-rymd ≈ ΔE ~25 — tillräckligt generöst för render-skillnader
      if (bestCandidate && bestDist < 60) {
        resolvedColor = bestCandidate.pixel_hex;
        fillColorHex  = bestCandidate.fill_color_hex || null;
        step9Label    = (bestCandidate.material_label || "").split("\n")[0].slice(0, 50);
        step9Area     = bestCandidate.area_m2;
        console.log(`[ai-scan] ${color_hex} → step9: pixel=${resolvedColor} fill=${fillColorHex} (dist=${bestDist.toFixed(1)}, "${step9Label}")`);
      } else {
        console.log(`[ai-scan] Ingen step9-match för ${color_hex} (bästa dist=${bestDist.toFixed(1)}) — använder original`);
      }
    } catch (e) {
      console.warn("[ai-scan] Kunde inte läsa step9:", e.message);
    }

    // Hitta PNG (preferera step1-output)
    let pngPath = path.join(outputDir, "ritning_p001.png");
    try { await fs.access(pngPath); } catch {
      return NextResponse.json({ error: "PNG saknas — kör step1 först" }, { status: 404 });
    }

    // Hämta px_per_m från step1
    let pxPerM = 59.06;
    try {
      const s1 = JSON.parse(await fs.readFile(path.join(outputDir, "step1_result.json"), "utf8"));
      const page = (s1.pages && s1.pages[0]) || {};
      pxPerM = page.scale_px_per_m || 59.06;
    } catch { /* använd default */ }

    // ── STEG 1: Försök med vektorextraktion (snabb, exakt) ───────────────────
    // vector_extract.py läser step7_refined.json och returnerar exakta polygoner
    // direkt från PDF-vektordata — ingen pixelscanning, ingen tröskelkalibrering.
    const vectorScript = path.join(pipelineDir, "vector_extract.py");
    const step7Path    = path.join(outputDir, "step7_refined.json");
    let vectorResult   = null;

    if (fillColorHex) {
      try {
        await fs.access(step7Path);   // kolla att step7 finns
        const vArgs = [
          vectorScript,
          "--color",  fillColorHex,   // exakt PDF fill_color_hex från step9
          "--step7",  step7Path,
          "--min-m2", String(min_area_m2),
          "--fuzzy",  "8",            // tight match — fill_color_hex ska matcha exakt
        ];
        console.log(`[ai-scan] Försöker vektorextraktion: fill=${fillColorHex}`);
        const { stdout: vOut, stderr: vErr } = await execFileAsync("python3", vArgs, {
          timeout: 15000,
          maxBuffer: 5 * 1024 * 1024,
          encoding: "utf8",
        });
        if (vErr) console.log("[vector] debug:\n" + vErr.trim());
        const vData = JSON.parse(vOut);
        if (vData.total_regions > 0 && !vData.error) {
          vectorResult = vData;
          console.log(`[ai-scan] Vektorextraktion: ${vData.total_regions} regioner, ${vData.total_area_m2}m²`);
        } else {
          console.log(`[ai-scan] Vektorextraktion: 0 regioner — faller tillbaka på pixelscan`);
        }
      } catch (ve) {
        console.warn("[ai-scan] Vektorextraktion misslyckades:", ve.message?.slice(0,100));
      }
    }

    // Om vektorn gav resultat — returnera direkt utan pixelscan
    if (vectorResult) {
      // drawScanRegions behöver png_size för att konvertera PNG-px → canvas-px
      let pngDims = [0, 0];
      try {
        const d = await getPngDimensions(pngPath);
        pngDims = [d.width, d.height];
      } catch { /* ignorera — canvas-skalning misslyckas tyst */ }

      const resp = {
        source:        "vector",
        target_color:  fillColorHex,
        total_regions: vectorResult.total_regions,
        total_area_m2: vectorResult.total_area_m2,
        png_size:      pngDims,           // ← krävs av drawScanRegions
        regions:       vectorResult.regions.map(r => ({
          area_m2:      r.area_m2,
          hull_png_pts: r.hull_png_pts,
          bbox_png:     r.bbox_png,
          n_pixels:     null,
          confidence:   r.confidence ?? 1.0,
        })),
        step9_label:   step9Label,
        step9_area:    step9Area,
      };
      return NextResponse.json(resp);
    }

    // ── STEG 2: Fallback — pixelbaserad scanning (scan_pattern.py) ───────────
    console.log(`[ai-scan] Pixelscan fallback: color=${resolvedColor}`);
    const scriptPath = path.join(pipelineDir, "scan_pattern.py");

    const args = [
      scriptPath,
      "--color",   resolvedColor,   // steg9-validerad pixel_hex
      "--thresh",  String(threshold),
      "--png",     pngPath,
      "--scale",   String(pxPerM),
      "--min-m2",  String(min_area_m2),
      "--close-r", String(close_radius),
    ];

    // ── Konvertera canvas-polygon → PNG-koordinater ───────────────────────
    // Canvas-origo: övre vänster. PNG-origo: övre vänster.
    // Ingen Y-flip behövs: både canvas (pdfjs) och PNG (poppler) renderar
    // PDF:en med y=0 överst. Skalningen är linjär i båda axlarna.
    if (canvas_pts && canvas_pts.length >= 3 && canvas_size) {
      try {
        const { width: pngW, height: pngH } = await getPngDimensions(pngPath);
        const [cw, ch] = canvas_size;

        const pngXs = canvas_pts.map(([cx])  => Math.round(cx * pngW / cw));
        const pngYs = canvas_pts.map(([,cy]) => Math.round(cy * pngH / ch));

        // Referens-bbox för texturfiltrering
        const bx0 = Math.max(0,    Math.min(...pngXs));
        const by0 = Math.max(0,    Math.min(...pngYs));
        const bx1 = Math.min(pngW, Math.max(...pngXs));
        const by1 = Math.min(pngH, Math.max(...pngYs));
        const bw  = bx1 - bx0;
        const bh  = by1 - by0;
        if (bw > 4 && bh > 4) {
          args.push("--ref-bbox", `${bx0},${by0},${bw},${bh}`);
          console.log(`[ai-scan] ref-bbox PNG: ${bx0},${by0} ${bw}×${bh}`);
        }

        // Fröpunkt = centroid av polygonen i PNG-koordinater
        // → Python samplar exakt PNG-färg härifrån, inga renderingsskillnader
        const cx = Math.round(pngXs.reduce((s, x) => s + x, 0) / pngXs.length);
        const cy = Math.round(pngYs.reduce((s, y) => s + y, 0) / pngYs.length);
        const seedX = Math.max(0, Math.min(pngW - 1, cx));
        const seedY = Math.max(0, Math.min(pngH - 1, cy));
        args.push("--seed-pt", `${seedX},${seedY}`);
        console.log(`[ai-scan] seed-pt PNG: ${seedX},${seedY}`);

      } catch (e) {
        console.warn("[ai-scan] Kunde inte beräkna bbox/seed:", e.message);
      }
    }

    const EXEC_OPTS = {
      timeout:   180000,   // 3 minuter — PIL/scipy på 17M px kan ta 90s+
      maxBuffer: 20 * 1024 * 1024,
      encoding:  "utf8",
    };

    // Hjälpfunktion: kör python och returnera {stdout, stderr} eller kasta med riktig traceback
    async function runPython(a) {
      try {
        return await execFileAsync("python3", a, EXEC_OPTS);
      } catch (e) {
        // execFileAsync stoppar stderr i e.stderr (string nu tack vare encoding:"utf8")
        const tb = (typeof e.stderr === "string" ? e.stderr : "").trim() ||
                   (typeof e.stdout === "string" ? e.stdout : "").trim() ||
                   e.message;
        const err = new Error(tb);
        err.isExecError = true;
        throw err;
      }
    }

    let stdout, stderr;
    try {
      ({ stdout, stderr } = await runPython(args));
    } catch (execErr) {
      const tb = execErr.message || "";

      // Om numpy/scipy/PIL saknas — installera och försök igen
      if (tb.includes("ModuleNotFoundError") || tb.includes("No module named")) {
        console.log("[ai-scan] Saknade Python-paket — installerar…");
        try {
          await execFileAsync("pip3", ["install","numpy","scipy","pillow","--quiet","--user"],
            { timeout: 120000, encoding: "utf8" });
        } catch {
          try {
            await execFileAsync("pip3", ["install","numpy","scipy","pillow","--quiet","--break-system-packages"],
              { timeout: 120000, encoding: "utf8" });
          } catch { /* ignorera */ }
        }
        try {
          ({ stdout, stderr } = await runPython(args));
        } catch (retryErr) {
          return NextResponse.json({ error: retryErr.message }, { status: 500 });
        }
      } else {
        console.error("[ai-scan] Python-krasch:\n", tb);
        return NextResponse.json({ error: tb }, { status: 500 });
      }
    }

    if (stderr) console.log("[ai-scan] debug:\n" + stderr.trim());

    let result;
    try {
      result = JSON.parse(stdout);
    } catch {
      return NextResponse.json(
        { error: "Python returnerade ogiltig JSON", raw: stdout.slice(0, 500) },
        { status: 500 }
      );
    }

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    // Skicka med debug-info från stderr till klienten (visas i result-kortet)
    result._debug      = stderr ? stderr.trim().slice(0, 600) : "";
    result._step9Color = resolvedColor;
    result._step9Label = step9Label;
    result._step9Area  = step9Area;

    return NextResponse.json(result);

  } catch (err) {
    console.error("[ai-scan] Fel:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
