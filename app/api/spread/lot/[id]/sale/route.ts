// Record what a lot actually did for you: what you paid and what it sold for. This is the ground
// truth the calibration loop prefers over auction hammer prices.
import { NextResponse } from "next/server";
import { authorized, deny } from "@/lib/spread/auth";
import { config } from "@/lib/spread/config";
import { scoreLot } from "@/lib/spread/scoring";
import { getStore } from "@/lib/spread/store";
import type { Outcome } from "@/lib/spread/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!authorized(req)) return deny();
  const id = Number((await params).id);
  const body = (await req.json().catch(() => ({}))) as Partial<{
    bought_price: number; sale_price: number; sale_at: number; sale_channel: string; notes: string; bought: boolean;
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
    const sc = scoreLot(lot!, val, config);
    base = {
      lot_id: id, title: lot!.title, category: lot!.category || "Uncategorized",
      closed_at: lot!.ends_at ?? Date.now() / 1000,
      predicted_low: val?.low ?? null, predicted_mid: val?.mid ?? null, predicted_high: val?.high ?? null,
      predicted_net: sc.net_resale, confidence: val?.confidence ?? 0, method: val?.method ?? "none", score: sc.score,
      hammer: null, landed_at_hammer: null,
      bought: null, bought_price: null, sale_price: null, sale_at: null, sale_channel: "", notes: "",
      recorded_at: Date.now() / 1000,
    };
  }

  const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  const updated: Outcome = {
    ...base,
    bought: body.bought ?? (body.bought_price !== undefined ? true : base.bought),
    bought_price: num(body.bought_price) ?? base.bought_price,
    sale_price: num(body.sale_price) ?? base.sale_price,
    sale_at: body.sale_at ?? (num(body.sale_price) ? Date.now() / 1000 : base.sale_at),
    sale_channel: body.sale_channel ?? base.sale_channel,
    notes: body.notes ?? base.notes,
    recorded_at: Date.now() / 1000,
  };
  await store.saveOutcome(updated);
  return NextResponse.json({ outcome: updated });
}
