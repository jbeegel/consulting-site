// eBay sends the browser back here after consent. The signed `state` says whose account it is.
import { NextResponse } from "next/server";
import { exchangeCode, verifyState } from "@/lib/spread/ebay-seller";
import { getStore } from "@/lib/spread/store";
import { OWNER_ID, ownerUser } from "@/lib/spread/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (q: string) => NextResponse.redirect(new URL(`/spread/book.html?ebay=${q}`, url.origin));
  const code = url.searchParams.get("code"), state = url.searchParams.get("state");
  if (!code || !state) return back("denied");
  const userId = verifyState(state);
  if (!userId) return back("badstate");
  const store = getStore();
  const user = (await store.getUser(userId)) ?? (userId === OWNER_ID ? ownerUser() : null);
  if (!user) return back("nouser");
  try {
    const ebay = await exchangeCode(code);
    await store.saveUser({ ...user, ebay, created_at: user.created_at || Date.now() / 1000 });
    return back("linked");
  } catch (e) {
    console.warn("ebay link failed", e);
    return back("failed");
  }
}
