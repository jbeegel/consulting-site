import { NextResponse } from "next/server";
/** Optional gate: when ARTPULL_PASSWORD is set, every call must carry it in x-artpull-key. */
export function allowed(req: Request): boolean {
  const pw = process.env.ARTPULL_PASSWORD;
  if (!pw) return true;
  return req.headers.get("x-artpull-key") === pw;
}
export function denied() { return NextResponse.json({ error: "Access code required" }, { status: 401 }); }
