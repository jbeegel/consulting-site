import { NextResponse } from "next/server";
import { authorized, deny } from "@/lib/spread/auth";
import { buildOpportunity, Scanner, scoreOptionsFor } from "@/lib/spread/scanner";
import { getStore } from "@/lib/spread/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!authorized(req)) return deny();
  const id = Number((await params).id);
  const store = getStore();
  let lot = await store.getLot(id);
  if (!lot) return NextResponse.json({ detail: "unknown lot" }, { status: 404 });
  if (new URL(req.url).searchParams.get("enrich") && !lot.pictures) {
    try {
      lot = (await new Scanner().enrichLot(id)) ?? lot;
    } catch (e) {
      console.warn("enrich failed", e);
    }
  }
  const scanner = new Scanner();
  const report = await scanner.calibration().catch(() => null);
  const weight = Number(new URL(req.url).searchParams.get("liquidity_weight"));
  const opts = scoreOptionsFor(lot, report, Number.isFinite(weight) ? { liquidity_weight: weight } : {});
  return NextResponse.json(buildOpportunity(lot, await store.getValuation(id), undefined, Date.now() / 1000, opts));
}
