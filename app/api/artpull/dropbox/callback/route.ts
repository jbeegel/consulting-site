import { NextResponse } from "next/server";
import { COOKIE, cookieValue, exchangeCode, oauthConfigured, seal, STATE_COOKIE } from "@/lib/artpull/oauth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const back = new URL("/artpull", u.origin);
  if (!oauthConfigured()) return NextResponse.redirect(back);
  const code = u.searchParams.get("code");
  const state = u.searchParams.get("state");
  const err = u.searchParams.get("error_description") ?? u.searchParams.get("error");
  if (err) { back.searchParams.set("dropbox", `error:${err}`); return NextResponse.redirect(back); }
  if (!code || !state || state !== cookieValue(req, STATE_COOKIE)) { back.searchParams.set("dropbox", "error:state mismatch, try again"); return NextResponse.redirect(back); }
  try {
    const t = await exchangeCode(req, code);
    const res = NextResponse.redirect((back.searchParams.set("dropbox", "linked"), back));
    res.cookies.set(COOKIE, seal(t.refresh_token), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
    res.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  } catch (e) {
    back.searchParams.set("dropbox", `error:${e instanceof Error ? e.message : String(e)}`);
    return NextResponse.redirect(back);
  }
}
