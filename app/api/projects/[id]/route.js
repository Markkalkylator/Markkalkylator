import { NextResponse } from "next/server";
import { readFile, unlink } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

export const runtime = "nodejs";

const DATA_DIR = path.join(process.cwd(), "data", "projects");

// GET /api/projects/[id] — hämta ett specifikt projekt
export async function GET(request, { params }) {
  const { id } = await params;
  const filePath = path.join(DATA_DIR, `${id}.json`);
  if (!existsSync(filePath)) {
    return NextResponse.json({ error: "Projekt hittades inte" }, { status: 404 });
  }
  try {
    const raw  = await readFile(filePath, "utf8");
    const data = JSON.parse(raw);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE /api/projects/[id] — ta bort ett projekt
export async function DELETE(request, { params }) {
  const { id } = await params;
  const filePath = path.join(DATA_DIR, `${id}.json`);
  if (!existsSync(filePath)) {
    return NextResponse.json({ error: "Projekt hittades inte" }, { status: 404 });
  }
  try {
    await unlink(filePath);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
