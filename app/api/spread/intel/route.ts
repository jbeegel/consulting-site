// Market intel: which categories are moving, where capital turns fastest, and what looks valuable
// but has no buyers. Derived entirely from stored valuations and open lots — no extra API spend.
import { NextResponse } from "next/server";
import { authorized, deny } from "@/lib/spread/auth";
import { config } from "@/lib/spread/config";
import { Scanner } from "@/lib/spread/scanner";
import type { IntelParams } from "@/lib/spread/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!authorized(req)) return deny();
  const u = new URL(req.url);
  const numParam = (k: string): number | undefined => {
    const v = u.searchParams.get(k);
    if (v === null || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const p: IntelParams = {
    liquidity_weight: numParam("liquidity_weight"),
    handling_days: numParam("handling_days"),
  };
  const intel = await new Scanner().intel(p);
  return NextResponse.json({
    ...intel,
    settings: {
      liquidity_weight: p.liquidity_weight ?? config.liquidityWeight,
      handling_days: p.handling_days ?? config.handlingDays,
      trend_window_days: config.trendWindowDays,
      liquidity_min_sales: config.liquidityMinSales,
    },
  });
}
