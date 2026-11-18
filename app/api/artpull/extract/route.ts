import { NextResponse } from "next/server";
import { allowed, denied } from "@/lib/artpull/auth";
import { extractorConfigured, extractTraveler } from "@/lib/artpull/extract";
import { SAMPLE_TRAVELER } from "@/lib/artpull/demo";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  if (!allowed(req)) return denied();
  const body = (await req.json()) as { image?: string; mediaType?: string; sample?: boolean };
  if (body.sample) return NextResponse.json({ traveler: SAMPLE_TRAVELER, model: "sample", usage: null });
  if (!extractorConfigured()) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set, so the traveler reader is off. Use the sample traveler to rehearse." }, { status: 503 });
  if (!body.image) return NextResponse.json({ error: "No image" }, { status: 400 });
  const mt = (body.mediaType ?? "image/jpeg") as "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  try {
    const out = await extractTraveler(body.image, mt);
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
