import { NextResponse } from "next/server";
import { allowed, denied } from "@/lib/artpull/auth";
import { extractorConfigured } from "@/lib/artpull/extract";
import { connect, getMetadata, tokenFrom } from "@/lib/artpull/dropbox";
import { oauthConfigured, refreshFromCookie } from "@/lib/artpull/oauth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!allowed(req)) return denied();
  const token = await tokenFrom(req);
  const probe = new URL(req.url).searchParams.get("probe");
  let dropbox: { connected: boolean; account: string | null; team: boolean; error: string | null; probe: { path: string; found: boolean } | null } = { connected: false, account: null, team: false, error: null, probe: null };
  if (token) {
    try {
      const c = await connect(token);
      dropbox = { connected: true, account: c.account, team: c.team, error: null, probe: null };
      if (probe) {
        const m = await getMetadata(c, probe).catch(() => null);
        dropbox.probe = { path: probe, found: Boolean(m) };
      }
    }
    catch (e) { dropbox = { connected: false, account: null, team: false, error: e instanceof Error ? e.message : String(e), probe: null }; }
  }
  const oauth = oauthConfigured();
  const linked = oauth && Boolean(refreshFromCookie(req));
  const viaHeader = Boolean(req.headers.get("x-dropbox-token"));
  return NextResponse.json({ reader: extractorConfigured(), dropbox: { ...dropbox, source: viaHeader ? "token" : linked ? "linked" : dropbox.connected ? "env" : null }, oauth, linked, gated: Boolean(process.env.ARTPULL_PASSWORD) });
}
