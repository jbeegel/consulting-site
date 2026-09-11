// Local, non-auction buying: Craigslist searches driven by the playbook, plus a paste-a-listing path
// for OfferUp and Facebook Marketplace, which have no public API and forbid scraping.
import { NextResponse } from "next/server";
import { authorized, deny } from "@/lib/spread/auth";
import { config } from "@/lib/spread/config";
import { Scanner } from "@/lib/spread/scanner";
import { huntLocal, parsePastedListing, scoreLocal } from "@/lib/spread/sources";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  if (!authorized(req)) return deny();
  const theses = await new Scanner().theses();
  if (!config.local || !config.craigslistSite) {
    return NextResponse.json({
      hits: [], enabled: false,
      detail: "Set SPREAD_CRAIGSLIST_SITE to your local craigslist subdomain (e.g. 'detroit') to search automatically. "
        + "OfferUp and Facebook Marketplace have no public API and their terms forbid scraping, so paste a link to this endpoint instead.",
    });
  }
  const limit = Number(new URL(req.url).searchParams.get("limit")) || 60;
  const listings = await huntLocal(theses, config);
  const hits = listings.map((l) => scoreLocal(l, theses, config))
    .filter((h) => h.theses.length)
    .sort((a, b) => ({ buy: 0, negotiate: 1, unknown: 2, pass: 3 })[a.verdict] - ({ buy: 0, negotiate: 1, unknown: 2, pass: 3 })[b.verdict]);
  return NextResponse.json({ enabled: true, site: config.craigslistSite, scanned: listings.length, hits: hits.slice(0, limit) });
}

/** Score one pasted listing: a URL, or title/price/description copied out of any app. */
export async function POST(req: Request) {
  if (!authorized(req)) return deny();
  const body = (await req.json().catch(() => ({}))) as { url?: string; text?: string; price?: number; title?: string; distance_miles?: number };
  const listing = parsePastedListing(body);
  if (!listing) return NextResponse.json({ detail: "send a url or some text" }, { status: 400 });
  if (typeof body.distance_miles === "number") listing.distance_miles = body.distance_miles;
  const theses = await new Scanner().theses();
  return NextResponse.json(scoreLocal(listing, theses, config));
}
