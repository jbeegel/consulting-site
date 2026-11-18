import { NextResponse } from "next/server";
import { allowed, denied } from "@/lib/artpull/auth";
import { tokenFrom } from "@/lib/artpull/dropbox";
import { resolveArt } from "@/lib/artpull/resolve";
import type { Traveler } from "@/lib/artpull/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!allowed(req)) return denied();
  const body = (await req.json()) as { traveler: Partial<Traveler>; machineMap?: Record<string, string> };
  try {
    const out = await resolveArt(body.traveler ?? {}, tokenFrom(req), body.machineMap);
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
