// Research pass: discover new niches from recent eBay sold data and re-measure stale ones.
// Costs Claude calls with web search, so it is deliberate rather than part of every scan.
import { NextResponse } from "next/server";
import { authorized, deny } from "@/lib/spread/auth";
import { Scanner } from "@/lib/spread/scanner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!authorized(req)) return deny();
  const body = (await req.json().catch(() => ({}))) as { discover?: number; refresh?: number; focus?: string };
  const r = await new Scanner().research(body);
  return NextResponse.json({
    added: r.added.map((t) => ({ id: t.id, name: t.name, family: t.family, price_median: t.price_median, max_bid: t.max_bid, sold_90d: t.sold_90d, active_now: t.active_now })),
    updated: r.updated.map((t) => ({ id: t.id, name: t.name, price_median: t.price_median, max_bid: t.max_bid })),
    error: r.error,
  });
}
