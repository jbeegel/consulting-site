// The monthly statement: what was won, what it came to, and the owner's share. JSON, or CSV with ?format=csv.
import { NextResponse } from "next/server";
import { caller, deny, forbid } from "@/lib/spread/auth";
import { buildStatement, statementCsv } from "@/lib/spread/ledger";
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
  const month = /^\d{4}-\d{2}$/.test(q.get("month") ?? "") ? (q.get("month") as string) : q.get("month") === "all" ? "all" : new Date().toISOString().slice(0, 7);
  const stmt = buildStatement(user, await store.positions({ userId: user.id }), month);
  if (q.get("format") === "csv") {
    return new NextResponse(statementCsv(stmt), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="spread-${user.id}-${month}.csv"` } });
  }
  return NextResponse.json(stmt);
}
