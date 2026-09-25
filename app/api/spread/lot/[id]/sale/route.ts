// Record what a lot actually did for you: what you paid, when you listed it, and what it sold for.
// This is the ground truth both loops prefer — the price loop reads sale_price, and the liquidity loop
// reads listed_at -> sale_at. Posting only `listed_at` (no sale yet) is a legitimate and useful record:
// a listing that sits unsold is exactly the evidence the speed model needs and would otherwise never see.
import { NextResponse } from "next/server";
import { authorized, deny } from "@/lib/spread/auth";
import { config } from "@/lib/spread/config";
import { scoreLot } from "@/lib/spread/scoring";
import { scoreOptionsFor } from "@/lib/spread/scanner";
import { getStore } from "@/lib/spread/store";
import type { Outcome } from "@/lib/spread/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!authorized(req)) return deny();
  const id = Number((await params).id);
  const body = (await req.json().catch(() => ({}))) as Partial<{
    bought_price: number; sale_price: number; sale_at: number; sale_channel: string; notes: string; bought: boolean;
    listed_at: number; list_price: number; still_listed: boolean; views: number; watchers: number;
  }>;
  const store = getStore();
  const existing = await store.getOutcome(id);
  const lot = await store.getLot(id);
  if (!existing && !lot) return NextResponse.json({ detail: "unknown lot" }, { status: 404 });

  let base: Outcome;
  if (existing) {
    base = existing;
  } else {
    const val = await store.getValuation(id);
    const sc = scoreLot(lot!, val, config, Date.now() / 1000, scoreOptionsFor(lot!, null));
    base = {
      lot_id: id, title: lot!.title, category: lot!.category || "Uncategorized",
      closed_at: lot!.ends_at ?? Date.now() / 1000,
      predicted_low: val?.low ?? null, predicted_mid: val?.mid ?? null, predicted_high: val?.high ?? null,
      predicted_net: sc.net_resale, confidence: val?.confidence ?? 0, method: val?.method ?? "none", score: sc.score,
      hammer: null, landed_at_hammer: null,
      bought: null, bought_price: null, sale_price: null, sale_at: null, sale_channel: "", notes: "",
      listed_at: null, list_price: null, still_listed: null, views: null, watchers: null,
      predicted_days: sc.liquidity?.days_p50 ?? null,
      recorded_at: Date.now() / 1000,
    };
  }

  const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  const nonNeg = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null);
  const sold = num(body.sale_price);
  const saleAt = body.sale_at ?? (sold ? Date.now() / 1000 : base.sale_at);
  const listedAt = num(body.listed_at) ?? base.listed_at;
  const updated: Outcome = {
    ...base,
    bought: body.bought ?? (body.bought_price !== undefined ? true : base.bought),
    bought_price: num(body.bought_price) ?? base.bought_price,
    sale_price: sold ?? base.sale_price,
    sale_at: saleAt,
    sale_channel: body.sale_channel ?? base.sale_channel,
    notes: body.notes ?? base.notes,
    // Liquidity ground truth. If a sale came in, the listing is no longer sitting.
    listed_at: listedAt,
    list_price: num(body.list_price) ?? base.list_price,
    still_listed: saleAt ? false : body.still_listed ?? (listedAt ? true : base.still_listed),
    views: nonNeg(body.views) ?? base.views,
    watchers: nonNeg(body.watchers) ?? base.watchers,
    recorded_at: Date.now() / 1000,
  };
  await store.saveOutcome(updated);
  const days = updated.listed_at && updated.sale_at ? Math.round(((updated.sale_at - updated.listed_at) / 86400) * 10) / 10 : null;
  return NextResponse.json({ outcome: updated, days_to_sell: days, predicted_days: updated.predicted_days });
}
