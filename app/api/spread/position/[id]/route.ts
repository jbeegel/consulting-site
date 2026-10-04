// One person's position on one lot: read it, or settle it (listed / sold / kept, with the numbers).
import { NextResponse } from "next/server";
import { caller, deny, forbid } from "@/lib/spread/auth";
import { applyEvent } from "@/lib/spread/ledger";
import { getStore } from "@/lib/spread/store";
import type { EventKind, Lot, Position } from "@/lib/spread/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await caller(req);
  if (!me) return deny();
  const q = new URL(req.url).searchParams;
  const userId = q.get("user") || me.id;
  if (userId !== me.id && me.role !== "owner") return forbid();
  const p = await getStore().getPosition(userId, Number((await params).id));
  return p ? NextResponse.json({ position: p }) : NextResponse.json({ detail: "no position" }, { status: 404 });
}

/** The lot a position refers to, or a stand-in built from the position when the lot has been purged. */
function lotFor(p: Position, lot: Lot | null): Lot {
  if (lot) return lot;
  return {
    id: p.lot_id, title: p.title, description: "", estimate: "", quantity: 1, shipping_offered: false, url: p.lot_url,
    auction_name: p.auction_name, buyer_premium_rate: 0.15, currency: "USD", high_bid: p.hammer ?? p.won_price ?? 0, min_bid: null,
    bid_count: 0, time_left_seconds: null, time_left_text: null, ends_at: p.closed_at, is_closed: true, is_live: false, status: "CLOSED",
    reserve_satisfied: null, soft_close_minutes: null, category_id: null, category: p.category, category_path: p.category,
    fetched_at: Date.now() / 1000, alerted_at: null,
  } as unknown as Lot;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await caller(req);
  if (!me) return deny();
  const id = Number((await params).id);
  const body = (await req.json().catch(() => ({}))) as Partial<{
    user: string; won_price: number; listed: boolean; list_price: number; sale_price: number; sale_at: number; sale_channel: string; kept: boolean; lost: boolean; notes: string;
    ebay_order_id: string;
  }>;
  const store = getStore();
  const userId = body.user && me.role === "owner" ? body.user : me.id;
  const user = userId === me.id ? me : await store.getUser(userId);
  if (!user) return NextResponse.json({ detail: "unknown user" }, { status: 404 });
  const existing = await store.getPosition(user.id, id);
  const lot = lotFor(existing ?? ({ lot_id: id, title: "", lot_url: "", category: "Uncategorized", auction_name: null, closed_at: null, hammer: null, won_price: null } as Position), await store.getLot(id));
  if (!existing && !(await store.getLot(id))) return NextResponse.json({ detail: "unknown lot" }, { status: 404 });

  const steps: { kind: EventKind; amount: number | null; note: string }[] = [];
  const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null);
  if (body.won_price !== undefined && num(body.won_price) !== null) steps.push({ kind: "won", amount: num(body.won_price), note: "" });
  if (body.listed || body.list_price !== undefined) steps.push({ kind: "listed", amount: num(body.list_price), note: "" });
  if (body.ebay_order_id && existing) {
    const cnd = existing.ebay_candidates.find((c) => c.order_id === body.ebay_order_id);
    if (cnd) {
      existing.sale_at = cnd.sold_at; existing.sale_source = "ebay"; existing.ebay_candidates = [];
      await store.savePosition(existing);
      steps.push({ kind: "sale", amount: cnd.price, note: "eBay" });
    }
  }
  if (body.sale_price !== undefined && num(body.sale_price) !== null) {
    if (existing && body.sale_at) { existing.sale_at = Number(body.sale_at); await store.savePosition(existing); }
    steps.push({ kind: "sale", amount: num(body.sale_price), note: String(body.sale_channel ?? "") });
  }
  if (body.kept) steps.push({ kind: "kept", amount: null, note: "" });
  if (body.lost) steps.push({ kind: "lost", amount: null, note: "" });
  if (body.notes !== undefined && !steps.length) steps.push({ kind: "view", amount: null, note: String(body.notes).slice(0, 500) });
  if (!steps.length) return NextResponse.json({ detail: "nothing to apply" }, { status: 400 });
  let position: Position | null = existing;
  for (const s of steps) {
    await store.logEvent({ user_id: user.id, lot_id: id, kind: s.kind, amount: s.amount, at: Date.now() / 1000, note: s.note || String(body.notes ?? "").slice(0, 500) });
    position = await applyEvent(store, user, lot, s.kind, s.amount, s.note || (s.kind === "view" ? String(body.notes ?? "") : ""));
  }
  return NextResponse.json({ position });
}
