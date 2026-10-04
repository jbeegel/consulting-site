// Pull the person's eBay orders and match them to the lots they won.
import { NextResponse } from "next/server";
import { caller, deny, forbid } from "@/lib/spread/auth";
import { syncUser } from "@/lib/spread/ebay-seller";
import { getStore } from "@/lib/spread/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const me = await caller(req);
  if (!me) return deny();
  const q = new URL(req.url).searchParams;
  const userId = q.get("user") || me.id;
  if (userId !== me.id && me.role !== "owner") return forbid();
  const store = getStore();
  const user = userId === me.id ? me : await store.getUser(userId);
  if (!user) return NextResponse.json({ detail: "unknown user" }, { status: 404 });
  if (!user.ebay) return NextResponse.json({ detail: "eBay not linked" }, { status: 409 });
  try {
    return NextResponse.json(await syncUser(store, user));
  } catch (e) {
    return NextResponse.json({ detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
