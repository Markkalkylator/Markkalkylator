import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/detect-tiles
 *
 * BINÄR KLASSIFICERING — frågar ALDRIG efter koordinater.
 * GPT-4o är dålig på att lokalisera pixelprecist men UTMÄRKT på att
 * avgöra om ett material FINNS i en bild.
 *
 * Body:
 *   tileDataUrl   – base64 JPEG av en 200px tile
 *   legendDataUrl – base64 PNG av teckenförklaringen
 *   categories    – [{ id, label, geometry }]
 *
 * Response:
 *   { results: [{ id, label, present: boolean, confidence: 0–1 }] }
 */
export async function POST(req) {
  try {
    const {
      tileDataUrl,
      legendDataUrl,
      categories = [],
    } = await req.json();

    if (!tileDataUrl || categories.length === 0) {
      return NextResponse.json({ results: [] });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY saknas" }, { status: 500 });
    }

    const categoryList = categories
      .map((c, i) => `${i + 1}. "${c.label}" (id="${c.id}")`)
      .join("\n");

    const systemPrompt =
      "Du är en expert på svenska mark- och anläggningsritningar. " +
      "Du känner igen materialmönster: korsstreck, punktraster, diagonal linjer, " +
      "textur och färgfyllning. " +
      "Du svarar ALLTID med exakt giltig JSON. Inga kommentarer.";

    const userContent = [];

    if (legendDataUrl) {
      userContent.push({
        type: "text",
        text: "BILD 1 — TECKENFÖRKLARING\nStudera noga hur varje material SER UT. " +
              "Korsstreck, prickar, linjer, färg. Memorera det visuella mönstret.",
      });
      userContent.push({
        type: "image_url",
        image_url: { url: legendDataUrl, detail: "high" },
      });
    }

    userContent.push({
      type: "text",
      text: `${legendDataUrl ? "BILD 2 — " : ""}RITNINGSUTSNITT

UPPGIFT:
För varje material nedan — avgör om dess KARAKTÄRISTISKA MÖNSTER syns i detta utsnitt.

MATERIAL:
${categoryList}

REGLER:
• Sätt present=true BARA om du tydligt kan se just det mönstret från teckenförklaringen.
• Sätt present=false om du är osäker eller om mönstret saknas.
• confidence = hur säker du är (0.0–1.0). Under 0.65 → sätt present=false.
• Glöm koordinater. Svara bara om materialet FINNS eller INTE.

Svara EXAKT med detta JSON:
{
  "results": [
    { "id": "kategori-id", "label": "Materialnamn", "present": true, "confidence": 0.87 }
  ]
}`,
    });

    userContent.push({
      type: "image_url",
      image_url: { url: tileDataUrl, detail: "high" },
    });

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        response_format: { type: "json_object" },
        max_tokens: 600,
        temperature: 0.1,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("[detect-tiles] OpenAI fel:", data?.error?.message);
      return NextResponse.json({ results: [] });
    }

    let parsed;
    try {
      parsed = JSON.parse(data?.choices?.[0]?.message?.content || "{}");
    } catch {
      return NextResponse.json({ results: [] });
    }

    const results = (parsed.results || []).map((r) => ({
      id: r.id,
      label: r.label,
      present: r.confidence >= 0.65 && r.present === true,
      confidence: r.confidence ?? 0,
    }));

    const positive = results.filter((r) => r.present);
    if (positive.length > 0) {
      console.log("[tile] ✓", positive.map((r) => `${r.label}(${Math.round(r.confidence * 100)}%)`).join(", "));
    }

    return NextResponse.json({ results });
  } catch (err) {
    console.error("[detect-tiles] Undantag:", err.message);
    return NextResponse.json({ results: [] });
  }
}
