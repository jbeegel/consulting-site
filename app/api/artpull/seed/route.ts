import { NextResponse } from "next/server";
import { allowed, denied } from "@/lib/artpull/auth";
import { tokenFrom } from "@/lib/artpull/dropbox";
import { seedDropbox } from "@/lib/artpull/seed";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!allowed(req)) return denied();
  const token = tokenFrom(req);
  if (!token) return NextResponse.json({ error: "Connect Dropbox first (paste a token in Settings)." }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { root?: string };
  try {
    const out = await seedDropbox(token, body.root ?? "");
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
