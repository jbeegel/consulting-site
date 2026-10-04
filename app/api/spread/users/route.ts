// Who has a key. Owner only. The key is returned exactly once, when it is created or rotated.
import { NextResponse } from "next/server";
import { caller, deny, forbid, hashKey, newKey, OWNER_ID, publicUser } from "@/lib/spread/auth";
import { getStore } from "@/lib/spread/store";
import type { User } from "@/lib/spread/types";

export const dynamic = "force-dynamic";

const clampPct = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(1, Number(v))) : d);
const nonNeg = (v: unknown, d: number) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "user";

export async function GET(req: Request) {
  const me = await caller(req);
  if (!me) return deny();
  if (me.role !== "owner") return forbid();
  return NextResponse.json({ users: (await getStore().users()).map(publicUser) });
}

export async function POST(req: Request) {
  const me = await caller(req);
  if (!me) return deny();
  if (me.role !== "owner") return forbid();
  const body = (await req.json().catch(() => ({}))) as Partial<{ name: string; email: string; share_pct: number; daily_budget_usd: number; bidder_numbers: string[]; role: "owner" | "partner" }>;
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ detail: "name required" }, { status: 400 });
  const store = getStore();
  const taken = new Set((await store.users()).map((u) => u.id));
  let id = slug(name);
  for (let i = 2; taken.has(id) || id === OWNER_ID; i++) id = `${slug(name)}-${i}`;
  const key = newKey();
  const u: User = {
    id, name, role: body.role === "owner" ? "owner" : "partner", key_hash: hashKey(key), email: body.email?.trim() || null,
    share_pct: clampPct(body.share_pct, 0), daily_budget_usd: nonNeg(body.daily_budget_usd, 1),
    bidder_numbers: Array.isArray(body.bidder_numbers) ? body.bidder_numbers.map(String) : [],
    ebay: null, active: true, created_at: Date.now() / 1000, last_seen_at: null, last_nudged_at: null,
  };
  await store.saveUser(u);
  return NextResponse.json({ user: publicUser(u), key }, { status: 201 });
}

export async function PATCH(req: Request) {
  const me = await caller(req);
  if (!me) return deny();
  if (me.role !== "owner") return forbid();
  const body = (await req.json().catch(() => ({}))) as Partial<{ id: string; name: string; email: string; share_pct: number; daily_budget_usd: number; bidder_numbers: string[]; active: boolean; rotate_key: boolean; unlink_ebay: boolean }>;
  const store = getStore();
  const u = body.id ? await store.getUser(body.id) : null;
  if (!u) return NextResponse.json({ detail: "unknown user" }, { status: 404 });
  let key: string | undefined;
  if (body.rotate_key) { key = newKey(); u.key_hash = hashKey(key); }
  if (body.name?.trim()) u.name = body.name.trim();
  if (body.email !== undefined) u.email = body.email?.trim() || null;
  if (body.share_pct !== undefined) u.share_pct = clampPct(body.share_pct, u.share_pct);
  if (body.daily_budget_usd !== undefined) u.daily_budget_usd = nonNeg(body.daily_budget_usd, u.daily_budget_usd);
  if (Array.isArray(body.bidder_numbers)) u.bidder_numbers = body.bidder_numbers.map(String);
  if (body.active !== undefined && u.id !== OWNER_ID) u.active = !!body.active;
  if (body.unlink_ebay) u.ebay = null;
  await store.saveUser(u);
  return NextResponse.json({ user: publicUser(u), ...(key ? { key } : {}) });
}
