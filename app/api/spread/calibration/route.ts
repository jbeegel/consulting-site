// The valuer's report card: what it predicted vs. what actually happened, per category.
import { NextResponse } from "next/server";
import { authorized, deny } from "@/lib/spread/auth";
import { buildReport } from "@/lib/spread/calibration";
import { config } from "@/lib/spread/config";
import { getStore } from "@/lib/spread/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!authorized(req)) return deny();
  const store = getStore();
  const outcomes = await store.outcomes();
  const report = buildReport(outcomes, config);
  const url = new URL(req.url);
  const includeRows = url.searchParams.get("rows") === "true";
  return NextResponse.json({
    ...report,
    enabled: config.calibration,
    min_closed: config.calibrationMinClosed,
    min_sales: config.calibrationMinSales,
    outcomes: includeRows ? outcomes.slice(0, 500) : undefined,
  });
}
