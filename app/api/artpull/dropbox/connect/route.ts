import { NextResponse } from "next/server";
import { authorizeUrl, oauthConfigured, STATE_COOKIE } from "@/lib/artpull/oauth";
import { randomBytes } from "node:crypto";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!oauthConfigured()) return NextResponse.json({ error: "Set DROPBOX_APP_KEY and DROPBOX_APP_SECRET to enable Connect Dropbox." }, { status: 503 });
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(authorizeUrl(req, state));
  res.cookies.set(STATE_COOKIE, state, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
  return res;
}
