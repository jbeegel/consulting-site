// Start linking a person's eBay seller account: hand back the consent URL for the browser to open.
import { NextResponse } from "next/server";
import { caller, deny } from "@/lib/spread/auth";
import { consentUrl, ebayConfigured } from "@/lib/spread/ebay-seller";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const me = await caller(req);
  if (!me) return deny();
  if (!ebayConfigured()) return NextResponse.json({ detail: "eBay linking needs EBAY_CLIENT_ID, EBAY_CLIENT_SECRET and EBAY_RU_NAME" }, { status: 503 });
  return NextResponse.json({ url: consentUrl(me.id) });
}
