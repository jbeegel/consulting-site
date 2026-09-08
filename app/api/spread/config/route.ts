import { NextResponse } from "next/server";
import { authorized, deny } from "@/lib/spread/auth";
import { config } from "@/lib/spread/config";
import { TIME_BUCKETS } from "@/lib/spread/scoring";
import { getStore } from "@/lib/spread/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!authorized(req)) return deny();
  return NextResponse.json({
    buyer_premium: config.buyerPremium, sales_tax: config.salesTax, resale_fee: config.resaleFee,
    resale_shipping: config.resaleShipping, pickup_cost: config.pickupCost, model: config.model,
    valuer: config.valuer, claude_enabled: config.claudeEnabled, ebay_sold: config.ebaySold,
    ebay_api: !!(config.ebayClientId && config.ebayClientSecret), hibid: config.hibidSite,
    time_buckets: TIME_BUCKETS.map((b) => b[0]), store: getStore().kind,
    sweet_spot: { max_landed: config.sweetMaxLanded, min_net: config.sweetMinNet },
    vision: config.vision, radar_levels: ["strike", "watch", "track", "scan"],
    ebay_fees: { fvf: config.ebayFvf, fvf_media: config.ebayFvfMedia, per_order: config.ebayPerOrder, packaging: config.packagingCost },
    alerts: { webhook: !!config.alertWebhook, email: !!(config.resendKey && config.alertEmail), min_score: config.alertMinScore, window_min: config.alertWindowMin },
    cron: { status: config.cronStatus, hours: config.cronHours, value_per_run: config.valuePerRun, daily_cap: config.dailyValuationCap },
  });
}
