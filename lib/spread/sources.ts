// Buying without an auction: local, in-person sources scored against the same playbook.
//
// An auction has a clock and a public price. A local listing has neither — it sits at a fixed asking
// price until someone drives over. That changes the arithmetic (no buyer's premium, no bidding war, but
// you spend fuel and an hour) and it changes the urgency model (there is no close time, only "before
// someone else messages them"). What does NOT change is the thesis: an advertising letter opener at $5
// on Craigslist is the same trade as one at $5 on HiBid.
//
// WHAT IS AND IS NOT POSSIBLE HERE, plainly:
//
//   Craigslist  — publishes RSS for any search. Fetched here, politely and unauthenticated.
//   OfferUp     — no public API. Their terms forbid scraping and the site is bot-protected, so this
//                 module does not scrape it. What it does instead: `parsePastedListing` takes a URL or
//                 a pasted block of text from OfferUp, Facebook Marketplace or anywhere else and runs
//                 it through the same matching and scoring. Paste a link, get the verdict.
//                 Automating it properly needs OfferUp's partner API or a licensed data provider.
//   Facebook    — same position as OfferUp.
//
// The honest version of "surface local opportunities" is therefore: Craigslist automatically, everything
// else one paste at a time, with the door open for a real API when there is one.
import type { Config } from "./config";
import type { LocalListing, Thesis } from "./types";
import { matchTheses } from "./playbook";

const MILES_PER_DEG_LAT = 69.0;

/** Rough great-circle distance, good to a mile or two at these ranges. */
export function milesBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = (b.lat - a.lat) * MILES_PER_DEG_LAT;
  const dLon = (b.lon - a.lon) * MILES_PER_DEG_LAT * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

function tag(xml: string, name: string): string {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(xml);
  if (!m) return "";
  return decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim();
}

/** First dollar amount in a string, if any. */
export function parsePrice(s: string): number | null {
  const m = /\$\s?([\d,]+(?:\.\d{1,2})?)/.exec(s ?? "");
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Parse a Craigslist search RSS feed into listings. Pure, so it is testable without the network. */
export function parseCraigslistRss(xml: string, now = Date.now() / 1000): LocalListing[] {
  const items = xml.split(/<item[\s>]/i).slice(1);
  const out: LocalListing[] = [];
  for (const chunk of items) {
    const body = chunk.slice(0, chunk.search(/<\/item>/i) + 1);
    const title = tag(body, "title");
    const link = tag(body, "link") || (/<link[^>]*rdf:resource="([^"]+)"/i.exec(body)?.[1] ?? "");
    if (!title || !link) continue;
    const desc = tag(body, "description").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const dateStr = tag(body, "dc:date") || tag(body, "pubDate");
    const posted = dateStr ? Date.parse(dateStr) / 1000 : null;
    out.push({
      source: "craigslist",
      external_id: /\/(\d+)\.html/.exec(link)?.[1] ?? link,
      title,
      description: desc,
      price: parsePrice(title) ?? parsePrice(desc),
      url: link,
      image: null,
      city: "", state: "",
      distance_miles: null,
      posted_at: Number.isFinite(posted as number) ? posted : null,
      fetched_at: now,
    });
  }
  return out;
}

/**
 * Search one Craigslist site. `site` is the subdomain ("detroit"). Returns [] rather than throwing:
 * a local source going quiet must never take a scan down with it.
 */
export async function searchCraigslist(site: string, query: string, opts: { maxPrice?: number; timeoutMs?: number } = {}): Promise<LocalListing[]> {
  if (!site) return [];
  const u = new URL(`https://${site}.craigslist.org/search/sss`);
  u.searchParams.set("query", query);
  u.searchParams.set("format", "rss");
  u.searchParams.set("sort", "date");
  if (opts.maxPrice) u.searchParams.set("max_price", String(Math.round(opts.maxPrice)));
  try {
    const res = await fetch(u.toString(), {
      headers: { "user-agent": "spread-hunter/0.1 (personal resale research)", accept: "application/rss+xml, application/xml" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15000),
      cache: "no-store",
    });
    if (!res.ok) {
      console.info("craigslist", site, query, "->", res.status);
      return [];
    }
    return parseCraigslistRss(await res.text());
  } catch (e) {
    console.info("craigslist fetch failed", site, query, e);
    return [];
  }
}

/**
 * Turn a pasted listing — a URL, or the title/price/description copied out of an app — into a listing
 * we can score. This is the supported path for OfferUp and Facebook Marketplace, where scraping is not
 * on the table.
 */
export function parsePastedListing(input: { url?: string; text?: string; price?: number; title?: string }, now = Date.now() / 1000): LocalListing | null {
  const text = (input.text ?? "").trim();
  const url = (input.url ?? "").trim();
  if (!text && !url) return null;

  let source = "pasted";
  try {
    if (url) {
      const host = new URL(url).hostname.replace(/^www\./, "");
      source = host.includes("offerup") ? "offerup"
        : host.includes("facebook") ? "facebook"
        : host.includes("craigslist") ? "craigslist"
        : host.includes("mercari") ? "mercari"
        : host.includes("ebay") ? "ebay"
        : host;
    }
  } catch {
    /* not a URL; keep "pasted" */
  }

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const title = (input.title ?? lines[0] ?? "").slice(0, 300);
  if (!title && !url) return null;
  return {
    source,
    external_id: url || title.slice(0, 80),
    title: title || url,
    description: lines.slice(1).join(" ").slice(0, 4000),
    price: input.price ?? parsePrice(text) ?? null,
    url,
    image: null,
    city: "", state: "",
    distance_miles: null,
    posted_at: null,
    fetched_at: now,
  };
}

export interface LocalHit {
  listing: LocalListing;
  theses: ReturnType<typeof matchTheses>;
  /** Asking price plus trip, against the tightest all-in ceiling among matched theses. */
  max_landed: number | null;
  /** Local buying has no buyer's premium, so the ask IS the landed cost, plus fuel. */
  landed_cost: number | null;
  verdict: "buy" | "negotiate" | "pass" | "unknown";
  note: string;
}

/**
 * Score a local listing against the playbook. No buyer's premium here — the asking price plus the cost
 * of going to get it IS the landed cost — but the trip is real money, so a $3 win 30 miles away is not
 * a win at all.
 */
export function scoreLocal(listing: LocalListing, theses: Thesis[], c: Config): LocalHit {
  const matches = matchTheses(
    { title: listing.title, description: listing.description, category_path: "" } as Parameters<typeof matchTheses>[0],
    theses,
  );
  // Compare like with like: `max_bid` strips out an auction's buyer's premium, but a local purchase has
  // none — the asking price plus the trip IS the landed cost — so judge against `max_landed`.
  const ceilings = matches.map((m) => m.max_landed).filter((x): x is number => x !== null);
  const maxBid = ceilings.length ? Math.min(...ceilings) : null;
  const trip = c.localTripCost + (listing.distance_miles ?? 0) * c.localCostPerMile;
  const landed = listing.price === null ? null : Math.round((listing.price + trip) * 100) / 100;

  let verdict: LocalHit["verdict"] = "unknown";
  let note = "";
  if (!matches.length) {
    note = "Nothing in the playbook matches this.";
  } else if (maxBid === null) {
    verdict = "unknown";
    note = `Matches ${matches[0].name}, but that niche has no researched price yet, so there is no ceiling to judge against.`;
  } else if (landed === null) {
    verdict = "unknown";
    note = `Matches ${matches[0].name} (pay up to about $${Math.round(maxBid)} all-in). No asking price given.`;
  } else if (landed <= maxBid) {
    verdict = "buy";
    note = `${matches[0].name}: $${listing.price} plus about $${Math.round(trip)} to collect is inside the $${Math.round(maxBid)} ceiling.`;
  } else if (landed <= maxBid * 1.6) {
    verdict = "negotiate";
    note = `${matches[0].name}: asking $${listing.price} lands at $${Math.round(landed)}, over the $${Math.round(maxBid)} ceiling. `
      + `Offer about $${Math.max(1, Math.floor(maxBid - trip))}.`;
  } else {
    verdict = "pass";
    note = `${matches[0].name}: $${Math.round(landed)} all-in against a $${Math.round(maxBid)} ceiling. Not at this price.`;
  }
  return { listing, theses: matches, max_landed: maxBid, landed_cost: landed, verdict, note };
}

/** Run the playbook's queries against the configured local sources. */
export async function huntLocal(theses: Thesis[], c: Config, opts: { limitPerQuery?: number } = {}): Promise<LocalListing[]> {
  if (!c.local || !c.craigslistSite) return [];
  const out: LocalListing[] = [];
  const seen = new Set<string>();
  for (const t of theses) {
    for (const q of t.queries.slice(0, 2)) {
      // Asking prices above the ceiling are not worth pulling down the wire.
      const cap = t.max_bid ? Math.ceil(t.max_bid * 3) : undefined;
      const rows = await searchCraigslist(c.craigslistSite, q, { maxPrice: cap });
      for (const r of rows.slice(0, opts.limitPerQuery ?? 20)) {
        const key = `${r.source}:${r.external_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(r);
      }
    }
  }
  return out;
}
