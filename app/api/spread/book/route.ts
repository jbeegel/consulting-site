// A person's book: every position, the unresolved wins, and the all-time totals. The owner can read
// anyone's with ?user=.
import { NextResponse } from "next/server";
import { caller, deny, forbid } from "@/lib/spread/auth";
import { buildStatement } from "@/lib/spread/ledger";
import { getStore } from "@/lib/spread/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const me = await caller(req);
  if (!me) return deny();
  const q = new URL(req.url).searchParams;
  const userId = q.get("user") || me.id;
  if (userId !== me.id && me.role !== "owner") return forbid();
  const store = getStore();
  const user = userId === me.id ? me : await store.getUser(userId);
  if (!user) return NextResponse.json({ detail: "unknown user" }, { status: 404 });
  const positions = await store.positions({ userId: user.id });
  const stmt = buildStatement(user, positions, "all");
  const months = [...new Set(positions.filter((p) => p.won_at).map((p) => new Date((p.won_at as number) * 1000).toISOString().slice(0, 7)))].sort().reverse();
  return NextResponse.json({ user: { id: user.id, name: user.name, role: user.role, share_pct: user.share_pct }, positions, totals: stmt.totals, unresolved: stmt.unresolved, months });
}
