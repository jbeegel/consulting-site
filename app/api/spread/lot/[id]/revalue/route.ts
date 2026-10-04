import { NextResponse } from "next/server";
import { caller, deny } from "@/lib/spread/auth";
import { buildOpportunity, Scanner } from "@/lib/spread/scanner";
import { getStore } from "@/lib/spread/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await caller(req);
  if (!user) return deny();
  const id = Number((await params).id);
  const store = getStore();
  const lot = await store.getLot(id);
  if (!lot) return NextResponse.json({ detail: "unknown lot" }, { status: 404 });
  // A manual re-appraisal is the one way a person can spend the owner's money directly, so it is
  // metered per person per day.
  const dayStart = Math.floor(Date.now() / 86400000) * 86400;
  const spent = (await store.events({ userId: user.id, since: dayStart, limit: 500 })).filter((e) => e.kind === "revalue").reduce((a, e) => a + (e.amount ?? 0), 0);
  if (spent >= user.daily_budget_usd) return NextResponse.json({ detail: `daily re-appraisal budget used ($${spent.toFixed(2)} of $${user.daily_budget_usd})` }, { status: 429 });
  const scanner = new Scanner();
  // Load the watchlist first: it is what injects the buyer's lenses and standing instructions into the
  // appraisal prompt, and a manual revalue is exactly when those matter most.
  const watchlist = await scanner.watchlist().catch(() => null);
  const v = await scanner.pipeline.valueLot(lot, true);
  await store.logEvent({ user_id: user.id, lot_id: id, kind: "revalue", amount: v.cost_usd ?? 0, at: Date.now() / 1000, note: v.model_used }).catch(() => undefined);
  const theses = await scanner.theses().catch(() => []);
  return NextResponse.json(buildOpportunity(lot, v, undefined, Date.now() / 1000, {}, theses, watchlist));
}
