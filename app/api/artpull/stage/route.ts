import { NextResponse } from "next/server";
import { allowed, denied } from "@/lib/artpull/auth";
import { tokenFrom } from "@/lib/artpull/dropbox";
import { stageArt } from "@/lib/artpull/stage";
import type { Traveler } from "@/lib/artpull/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!allowed(req)) return denied();
  const body = (await req.json()) as { artPath: string; machine: string; traveler: Partial<Traveler>; queueRoot?: string };
  if (!body.artPath || !body.machine) return NextResponse.json({ error: "artPath and machine are required" }, { status: 400 });
  try {
    const out = await stageArt({ token: tokenFrom(req), artPath: body.artPath, machine: body.machine, traveler: body.traveler ?? {}, queueRoot: body.queueRoot });
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
