// The ledger's write path: "I opened this", "I'm bidding $40", "I won it", "I passed".
import { NextResponse } from "next/server";
import { caller, deny, forbid } from "@/lib/spread/auth";
import { applyEvent } from "@/lib/spread/ledger";
import { getStore } from "@/lib/spread/store";
import type { EventKind } from "@/lib/spread/types";

export const dynamic = "force-dynamic";
const KINDS: EventKind[] = ["view", "bid_intent", "won", "lost", "skip", "listed", "sale", "kept"];

export async function POST(req: Request) {
  const me = await caller(req);
  if (!me) return deny();
  const body = (await req.json().catch(() => ({}))) as Partial<{ lot_id: number; kind: EventKind; amount: number; note: string }>;
  const lotId = Number(body.lot_id);
  if (!Number.isFinite(lotId) || !body.kind || !KINDS.includes(body.kind)) return NextResponse.json({ detail: "lot_id and a known kind required" }, { status: 400 });
  const store = getStore();
  const lot = await store.getLot(lotId);
  if (!lot) return NextResponse.json({ detail: "unknown lot" }, { status: 404 });
  const amount = Number.isFinite(Number(body.amount)) ? Number(body.amount) : null;
  const note = String(body.note ?? "").slice(0, 500);
  await store.logEvent({ user_id: me.id, lot_id: lotId, kind: body.kind, amount, at: Date.now() / 1000, note });
  const position = await applyEvent(store, me, lot, body.kind, amount, note);
  return NextResponse.json({ position });
}

export async function GET(req: Request) {
  const me = await caller(req);
  if (!me) return deny();
  const q = new URL(req.url).searchParams;
  const userId = q.get("user") || me.id;
  if (userId !== me.id && me.role !== "owner") return forbid();
  const lotId = Number(q.get("lot_id")) || undefined;
  const since = Number(q.get("since")) || undefined;
  return NextResponse.json({ events: await getStore().events({ userId, lotId, since, limit: 500 }) });
}
