// Who am I, and the few things a person may set about themselves.
import { NextResponse } from "next/server";
import { caller, deny, publicUser } from "@/lib/spread/auth";
import { ebayConfigured } from "@/lib/spread/ebay-seller";
import { getStore } from "@/lib/spread/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const me = await caller(req);
  if (!me) return deny();
  const store = getStore();
  // The password-owner is a pseudo-user until something (an eBay link, bidder numbers) gives it a record.
  if (me.created_at) await store.saveUser({ ...me, last_seen_at: Date.now() / 1000 }).catch(() => undefined);
  return NextResponse.json({ user: publicUser(me), ebay_available: ebayConfigured() });
}

export async function POST(req: Request) {
  const me = await caller(req);
  if (!me) return deny();
  const body = (await req.json().catch(() => ({}))) as Partial<{ email: string; bidder_numbers: string[] }>;
  const u = { ...me };
  if (body.email !== undefined) u.email = body.email?.trim() || null;
  if (Array.isArray(body.bidder_numbers)) u.bidder_numbers = body.bidder_numbers.map(String).filter(Boolean);
  await getStore().saveUser(u);
  return NextResponse.json({ user: publicUser(u) });
}
