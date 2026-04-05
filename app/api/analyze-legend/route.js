import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req) {
  try {
    const { imageDataUrl } = await req.json();

    if (!imageDataUrl || typeof imageDataUrl !== "string") {
      return NextResponse.json({ error: "Saknar imageDataUrl" }, { status: 400 });
    }

    // Kontrollera att bilden inte är för liten
    const base64Data = imageDataUrl.split(",")[1] || "";
    if (base64Data.length < 100) {
      return NextResponse.json(
        { error: "Legend-bilden är för liten eller tom. Markera ett större område." },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY saknas i .env.local" },
        { status: 500 }
      );
    }

    console.log("[analyze-legend] Skickar bild, base64 längd:", base64Data.length);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        response_format: { type: "json_object" },
        max_tokens: 1500,
        messages: [
          {
            role: "system",
            content:
              "You are an expert at reading technical construction and landscape drawings. " +
              "You analyze legend/key sections of architectural and civil engineering plans. " +
              "Always respond with valid JSON only.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  "This image shows the legend/key section of a Swedish construction or landscape drawing (mark- och anläggningsritning). " +
                  "Identify every item in the legend. For each item, determine if it represents a surface area or a line element. " +
                  "Return ONLY a JSON object in this exact format: " +
                  '{"items":[{"label":"name of the item in the legend","geometry":"area or line","unit":"m² or m","confidence":0.0}]}. ' +
                  "Use geometry='area' and unit='m²' for surfaces (asfalt, grus, plattor, gräs etc). " +
                  "Use geometry='line' and unit='m' for lines (kantsten, ledning etc). " +
                  "Include all items you can see. Do not invent items not visible in the image.",
              },
              {
                type: "image_url",
                image_url: {
                  url: imageDataUrl,
                  detail: "high",
                },
              },
            ],
          },
        ],
      }),
    });

    const data = await response.json();

    console.log("[analyze-legend] HTTP status:", response.status);

    if (!response.ok) {
      console.error("[analyze-legend] OpenAI fel:", data?.error);
      return NextResponse.json(
        { error: data?.error?.message || "OpenAI-fel", raw: data },
        { status: 500 }
      );
    }

    const choice = data?.choices?.[0];

    // Hantera explicit refusal från modellen
    if (choice?.message?.refusal) {
      console.error("[analyze-legend] GPT vägrade:", choice.message.refusal);
      return NextResponse.json(
        {
          error:
            "AI:n kunde inte analysera bilden. Kontrollera att du markerat ett tydligt legend-område med text och symboler.",
          refusal: choice.message.refusal,
        },
        { status: 422 }
      );
    }

    const outputText = choice?.message?.content || "";
    console.log("[analyze-legend] GPT text:", outputText);

    if (!outputText) {
      return NextResponse.json(
        { error: "Fick inget textsvar från modellen", raw: data },
        { status: 500 }
      );
    }

    let parsed;
    try {
      parsed = JSON.parse(outputText);
    } catch {
      return NextResponse.json(
        { error: "Modellen returnerade inte giltig JSON", rawText: outputText },
        { status: 500 }
      );
    }

    console.log("[analyze-legend] Hittade", parsed.items?.length, "kategorier");

    return NextResponse.json(parsed);
  } catch (error) {
    console.error("[analyze-legend] Serverfel:", error.message);
    return NextResponse.json(
      { error: error.message || "Okänt serverfel" },
      { status: 500 }
    );
  }
}
