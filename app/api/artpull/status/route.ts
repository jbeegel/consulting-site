import { NextResponse } from "next/server";
import { allowed, denied } from "@/lib/artpull/auth";
import { extractorConfigured } from "@/lib/artpull/extract";
import { connect, tokenFrom } from "@/lib/artpull/dropbox";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!allowed(req)) return denied();
  const token = tokenFrom(req);
  let dropbox: { connected: boolean; account: string | null; team: boolean; error: string | null } = { connected: false, account: null, team: false, error: null };
  if (token) {
    try { const c = await connect(token); dropbox = { connected: true, account: c.account, team: c.team, error: null }; }
    catch (e) { dropbox = { connected: false, account: null, team: false, error: e instanceof Error ? e.message : String(e) }; }
  }
  return NextResponse.json({ reader: extractorConfigured(), dropbox, gated: Boolean(process.env.ARTPULL_PASSWORD) });
}
