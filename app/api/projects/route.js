import { NextResponse } from "next/server";
import { readFile, writeFile, mkdir, readdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

export const runtime = "nodejs";

const DATA_DIR = path.join(process.cwd(), "data", "projects");

async function ensureDir() {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
}

// GET /api/projects — lista alla sparade projekt
export async function GET() {
  await ensureDir();
  try {
    const files = await readdir(DATA_DIR);
    const projects = [];
    for (const f of files.filter(f => f.endsWith(".json"))) {
      try {
        const raw  = await readFile(path.join(DATA_DIR, f), "utf8");
        const data = JSON.parse(raw);
        // Skicka bara metadata, inte hela projektet
        projects.push({
          id:       data.id,
          name:     data.name,
          date:     data.date,
          nObjects: (data.objects  || []).length,
          nNotes:   (data.notes    || []).length,
          layers:   (data.layers   || []).map(l => ({ id:l.id, name:l.name, color:l.color })),
          ppm:      data.ppm || 100,
        });
      } catch { /* skip corrupt files */ }
    }
    return NextResponse.json(
      projects.sort((a, b) => new Date(b.date) - new Date(a.date))
    );
  } catch (e) {
    return NextResponse.json([], { status: 200 });
  }
}

// POST /api/projects — spara eller uppdatera ett projekt
export async function POST(request) {
  await ensureDir();
  try {
    const body = await request.json();
    const id   = body.id || `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const project = { ...body, id, savedAt: new Date().toISOString() };
    await writeFile(
      path.join(DATA_DIR, `${id}.json`),
      JSON.stringify(project, null, 2),
      "utf8"
    );
    return NextResponse.json({ id });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
