import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/analyze-drawing
 *
 * Strategi: Rutnätsklassificering.
 * Vi lägger ett märkt rutnät (A1–T14) på ritningsbilden och skickar
 * till GPT-4o som svarar vilka celler varje material finns i.
 * Det är en uppgift GPT klarar bra – i stället för omöjliga pixelkoordinater.
 *
 * Body:
 *   drawingDataUrl  – base64 JPEG av ritningen MED rutnät påritat
 *   legendDataUrl   – base64 PNG av legend-symbolerna (beskuret)
 *   categories      – [{ id, label, geometry }]
 *   gridCols        – antal kolumner i rutnätet
 *   gridRows        – antal rader i rutnätet
 */
export async function POST(req) {
  try {
    const {
      drawingDataUrl,
      legendDataUrl,
      categories = [],
      gridCols = 20,
      gridRows = 14,
    } = await req.json();

    if (!drawingDataUrl) {
      return NextResponse.json({ error: "Saknar drawingDataUrl" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY saknas" }, { status: 500 });
    }

    const colLabels = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".slice(0, gridCols);

    // Build category list for the prompt
    const categoryList = categories
      .map((c, i) => `${i + 1}. "${c.label}"`)
      .join("\n");

    const systemPrompt =
      "Du är en expert på att tolka svenska mark- och anläggningsritningar (CAD/PDF). " +
      "Du identifierar material baserat på deras visuella mönster i teckenförklaringen: " +
      "korsstreck, punkter, linjeriktning, linjeavstånd och texturer. " +
      "Du svarar alltid med exakt giltig JSON.";

    const userText = `BILD 1: TECKENFÖRKLARING (legenden med materialens visuella symboler)
BILD 2: RITNINGEN med ett röd-rutnät pålagt (kolumner ${colLabels[0]}–${colLabels[colLabels.length - 1]}, rader 1–${gridRows})

Exempel på cellnamn: "${colLabels[0]}1" = övre vänstra hörnet, "${colLabels[Math.floor(gridCols/2)]}${Math.floor(gridRows/2)}" = mitten, "${colLabels[gridCols-1]}${gridRows}" = nedre högra.

UPPGIFT: Analysera varje material i listan nedan.
För varje material, identifiera ALLA rutnätsceller i Bild 2 där just det materialets mönster (från Bild 1) syns.

Material att identifiera:
${categoryList}

ANALYSMETOD (viktigt):
1. Titta på materialets symbol/mönster i Bild 1 (legenden): linjevinkel, täthet, prickstorlek, korsstreck
2. Sök igenom Bild 2 systematiskt rad för rad
3. Märk varje cell där du ser EXAKT det mönstret
4. Inkludera celler där mönstret täcker >30% av cellen
5. Skippa tomma/vita celler och legend-ytan till höger i ritningen
6. Om ett material inte syns alls → utelämna det från svaret

Svara EXAKT i detta JSON-format (inga kommentarer):
{
  "results": [
    {
      "label": "EXAKT MATERIALNAMN SOM I LISTAN",
      "categoryId": "kategori-id",
      "cells": ["${colLabels[0]}1","${colLabels[0]}2","${colLabels[1]}1"]
    }
  ]
}`;

    const userContent = [];

    // Image 1: legend
    if (legendDataUrl) {
      userContent.push({ type: "text", text: userText });
      userContent.push({
        type: "image_url",
        image_url: { url: legendDataUrl, detail: "high" },
      });
    } else {
      userContent.push({ type: "text", text: userText });
    }

    // Image 2: drawing with grid
    userContent.push({
      type: "image_url",
      image_url: { url: drawingDataUrl, detail: "high" },
    });

    console.log(`[analyze-drawing] Skickar till GPT-4o: ${categories.length} kategorier, grid ${gridCols}x${gridRows}`);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        response_format: { type: "json_object" },
        max_tokens: 4000,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
      }),
    });

    const data = await response.json();
    console.log("[analyze-drawing] HTTP:", response.status);

    if (!response.ok) {
      console.error("[analyze-drawing] OpenAI fel:", data?.error);
      return NextResponse.json(
        { error: data?.error?.message || "OpenAI-fel" },
        { status: 500 }
      );
    }

    const choice = data?.choices?.[0];
    if (choice?.message?.refusal) {
      return NextResponse.json(
        { error: "AI vägrade analysera bilderna." },
        { status: 422 }
      );
    }

    const text = choice?.message?.content || "";
    console.log("[analyze-drawing] GPT svar (500 tecken):", text.slice(0, 500));

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: "GPT returnerade ogiltig JSON", rawText: text.slice(0, 500) },
        { status: 500 }
      );
    }

    const results = parsed.results || [];
    const totalCells = results.reduce((s, r) => s + (r.cells?.length || 0), 0);
    console.log(`[analyze-drawing] ${results.length} material, ${totalCells} celler totalt`);

    return NextResponse.json({ results });
  } catch (err) {
    console.error("[analyze-drawing] Fel:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
