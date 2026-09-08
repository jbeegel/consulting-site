import { NextResponse } from "next/server";
import { authorized, deny } from "@/lib/spread/auth";
import { buildOpportunity } from "@/lib/spread/scanner";
import { getStore } from "@/lib/spread/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!authorized(req)) return deny();
  const u = new URL(req.url);
  const hours = Number(u.searchParams.get("hours")) || null;
  const category = u.searchParams.get("category") || null;
  const minScore = Number(u.searchParams.get("min_score")) || 0;
  const q = (u.searchParams.get("q") || "").toLowerCase();
  const includeUnvalued = u.searchParams.get("include_unvalued") !== "false";
  const limit = Number(u.searchParams.get("limit")) || 2000;
  const now = Date.now() / 1000;
  const store = getStore();
  const lots = await store.lots({ endsBefore: hours ? now + hours * 3600 : null, endsAfter: now - 60, category });
  const vals = await store.valuationsFor(lots.map((l) => l.id));
  const out = [];
  for (const lot of lots) {
    if (q && !`${lot.title} ${lot.auction_name ?? ""}`.toLowerCase().includes(q)) continue;
    const v = vals.get(lot.id) ?? null;
    if (!v && !includeUnvalued) continue;
    const opp = buildOpportunity(lot, v, undefined, now);
    if (v && opp.score.score < minScore) continue;
    out.push(opp);
  }
  out.sort((a, b) => b.score.score - a.score.score || (b.score.spread ?? 0) - (a.score.spread ?? 0));
  return NextResponse.json({ generated_at: now, count: out.length, opportunities: out.slice(0, limit) });
}
