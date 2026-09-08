// Shared-secret gate for the Spread Hunter API. If SPREAD_PASSWORD is set, every /api/spread route
// requires `x-spread-key`; the cron route also accepts `Authorization: Bearer <CRON_SECRET>` (what
// Vercel Cron sends). With neither configured the API is open — fine for local dev, not for prod.
import { NextResponse } from "next/server";
import { config } from "./config";

export function authorized(req: Request, { cron = false } = {}): boolean {
  const key = req.headers.get("x-spread-key");
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (config.password && key === config.password) return true;
  if (cron && config.cronSecret && bearer === config.cronSecret) return true;
  if (config.cronSecret && bearer === config.cronSecret) return true;
  return !config.password && !(cron && config.cronSecret);
}

export function deny(): NextResponse {
  return NextResponse.json({ error: "unauthorized: set the Spread Hunter password" }, { status: 401 });
}
