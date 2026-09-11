// Thesis discovery — mining recent eBay sold data for niches worth hunting.
//
// The rest of the system reacts to lots. This is the part that goes looking. One Claude call with web
// search returns a batch of theses, each backed by an actual sold-listings search rather than a hunch,
// and the same call is reused to REFRESH an existing thesis whose numbers have gone stale.
//
// What makes a niche good is a conjunction, and all five parts matter:
//
//   1. It sells for real money            median $20-$120, because under $20 the fees and the hour eat it
//   2. It sells FAST                      high sell-through, days-to-sell under a month
//   3. It is worthless to the auctioneer  it goes in a $1 box lot, unlisted and undescribed
//   4. It is cheap and safe to ship       flat, light, hard to break
//   5. It is identifiable from a photo    a mark, an imprint, a shape you can name
//
// The fifth is the one people forget. A niche the appraiser cannot recognise in a blurry auction
// thumbnail is a niche this tool cannot hunt, however good the economics look on paper.
import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "./config";
import type { Thesis } from "./types";

const SYSTEM = `You are a resale market analyst who finds repeatable arbitrage niches for a flipper who buys
from small-town estate and consignment auctions (HiBid) and resells on eBay.

You are looking for NICHES, not individual items: a describable class of object that recurs, that has a
steady collector market, and that auctioneers routinely undervalue. For each one you must ground the
numbers in actual eBay searches, not memory. Search eBay sold/completed listings, read the result counts,
and report what you actually saw.

A good niche satisfies ALL of these:
1. SELLS FOR REAL MONEY. Median sold price roughly $20-$150. Below $20 the eBay fees and the handling
   hour eat the trade; far above it the auction crowd has usually already noticed.
2. SELLS FAST. High sell-through (sold vs. active), median days-to-sell under about 30. A niche that
   pays $200 in nine months is worse than one that pays $30 in a week.
3. IS CHEAP AT AUCTION. It goes into a box lot, a smalls tray or a "misc" lot, typically $1-$10, because
   the auctioneer has no reason to catalogue it individually.
4. SHIPS CHEAPLY AND SAFELY. Flat, light, robust. Anything fragile, bulky or freight-only is out.
5. IS IDENTIFIABLE FROM A PHOTO. A named imprint, a maker's mark, a distinctive silhouette. If you could
   not recognise it in a mediocre auction thumbnail, it does not qualify however good the economics are.

Strongly favour: small printed-and-stamped advertising (letter openers, blotters, pocket mirrors,
thermometers, rulers, paperweights, pinbacks); bank, insurance and financial memorabilia (still banks,
obsolete notes and scrip, stock and bond certificates, passbooks, bank giveaways); town-specific and
trade-specific ephemera; fraternal and society material; railroadiana and other industrial smalls.
These have the right profile: invisible to the auctioneer, specific to a collector, cheap to post.

Avoid: mainstream electronics, current-production goods, clothing, furniture, anything needing testing or
authentication to sell, and anything where reproductions dominate the market so heavily that a photo
cannot settle it.

For every niche report the real numbers you found:
- sold_90d: how many comparable items SOLD in the last 90 days (read the sold result count)
- active_now: how many are listed right now (read the active result count)
- price_p25 / price_median / price_p75 across the sold results
- median_days_to_sell where the data supports it
- ship_cost: realistic domestic cost to post one
Use -1 for anything you genuinely could not determine. Never invent a count.

Also give the hunting instructions: search queries an auction site would match, "must_any" keyword phrases
to detect the thing in a lot title, "negative" phrases that mean it is the wrong thing (reproduction,
modern, a homonym), and "tells" — what to look for in the photo to separate the $60 example from the $6
one. Be concrete and specific; "look for quality" is useless.`;

const THESIS_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "short niche name, e.g. 'Advertising letter openers'" },
    family: { type: "string", description: "grouping, e.g. 'Advertising ephemera' or 'Bank & financial memorabilia'" },
    queries: { type: "array", items: { type: "string" }, description: "2-4 search strings for an auction site" },
    must_any: { type: "array", items: { type: "string" }, description: "keyword phrases that identify it in a lot title" },
    negative: { type: "array", items: { type: "string" }, description: "phrases meaning the wrong thing: reproduction, modern, homonyms" },
    must_all: { type: "array", items: { type: "string" }, description: "phrases that must all appear; usually empty" },
    sold_90d: { type: "integer", description: "comparable items SOLD on eBay in the last 90 days; -1 if unknown" },
    active_now: { type: "integer", description: "comparable items listed right now; -1 if unknown" },
    price_p25: { type: "number", description: "-1 if unknown" },
    price_median: { type: "number", description: "-1 if unknown" },
    price_p75: { type: "number", description: "-1 if unknown" },
    median_days_to_sell: { type: "number", description: "-1 if unknown" },
    ship_cost: { type: "number", description: "realistic domestic postage plus packaging, USD" },
    ebay_category: { type: "string" },
    trend: { type: "string", enum: ["rising", "flat", "falling", "unknown"] },
    seasonality: { type: "string" },
    typical_auction_price: { type: "number", description: "what one usually costs in a box lot at auction, USD" },
    rationale: { type: "string", description: "why this niche is mispriced at auction and who buys it" },
    tells: { type: "array", items: { type: "string" }, description: "what to look for in a photo to spot a good one" },
    risks: { type: "array", items: { type: "string" } },
    sources: { type: "array", items: { type: "string" }, description: "the searches/URLs the numbers came from" },
    confidence: { type: "number", description: "0-1 that the numbers above are right" },
  },
  required: ["name", "family", "queries", "must_any", "negative", "must_all", "sold_90d", "active_now",
    "price_p25", "price_median", "price_p75", "median_days_to_sell", "ship_cost", "ebay_category", "trend",
    "seasonality", "typical_auction_price", "rationale", "tells", "risks", "sources", "confidence"],
  additionalProperties: false,
} as const;

const SCHEMA = {
  type: "object",
  properties: { theses: { type: "array", items: THESIS_SCHEMA } },
  required: ["theses"],
  additionalProperties: false,
} as const;

/** -1 and friends mean "did not determine". They must stay null, never become 0. */
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export interface RawThesis extends Partial<Thesis> {
  name: string;
  typical_auction_price?: number | null;
}

function toRaw(d: Record<string, unknown>, now: number): RawThesis | null {
  const name = String(d.name ?? "").trim();
  if (!name) return null;
  const arr = (k: string) => (Array.isArray(d[k]) ? (d[k] as unknown[]).map(String) : []);
  return {
    name,
    family: String(d.family ?? "Other"),
    queries: arr("queries"),
    must_any: arr("must_any"),
    negative: arr("negative"),
    must_all: arr("must_all"),
    sold_90d: numOrNull(d.sold_90d),
    active_now: numOrNull(d.active_now),
    price_p25: numOrNull(d.price_p25),
    price_median: numOrNull(d.price_median),
    price_p75: numOrNull(d.price_p75),
    median_days_to_sell: numOrNull(d.median_days_to_sell),
    ship_cost: numOrNull(d.ship_cost) ?? 5,
    ebay_category: String(d.ebay_category ?? ""),
    trend: (["rising", "flat", "falling"].includes(String(d.trend)) ? d.trend : "unknown") as Thesis["trend"],
    seasonality: String(d.seasonality ?? ""),
    typical_auction_price: numOrNull(d.typical_auction_price),
    rationale: String(d.rationale ?? ""),
    tells: arr("tells"),
    risks: arr("risks"),
    sources: arr("sources"),
    confidence: Math.max(0, Math.min(1, Number(d.confidence) || 0.4)),
    origin: "discovered",
    researched_at: now,
  };
}

export class ThesisResearcher {
  private client = new Anthropic();
  constructor(private model: string, private webSearch = true, private maxSearches = 12) {}

  private async ask(prompt: string, maxSearches: number): Promise<Record<string, unknown>> {
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
    const call = () => {
      const params: Anthropic.MessageCreateParamsNonStreaming = {
        model: this.model,
        max_tokens: 16000,
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        messages,
        output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> } },
      };
      if (this.webSearch) params.tools = [{ type: "web_search_20260209", name: "web_search", max_uses: maxSearches }];
      return this.client.messages.create(params);
    };
    let resp = await call();
    // Research runs long: allow more pause_turn resumes than a single-item appraisal does.
    for (let i = 0; i < 8 && resp.stop_reason === "pause_turn"; i++) {
      messages.push({ role: "assistant", content: resp.content });
      resp = await call();
    }
    if (resp.stop_reason === "refusal") throw new Error("model declined");
    const text = resp.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
    return JSON.parse(text) as Record<string, unknown>;
  }

  /** Find new niches. `avoid` are names already in the playbook; `focus` steers the search. */
  async discover(count: number, avoid: string[], focus: string, now = Date.now() / 1000): Promise<RawThesis[]> {
    const prompt = [
      `Find ${count} resale niches that satisfy all five criteria. Research each one with real eBay `
      + `sold-listing searches and report the counts and prices you actually see.`,
      focus ? `Focus especially on: ${focus}` : "",
      avoid.length ? `Already covered, do NOT repeat these (find adjacent or different niches instead):\n- ${avoid.join("\n- ")}` : "",
      `Spend your searches on the numbers, not the prose. It is better to return ${Math.max(3, Math.floor(count / 2))} `
      + `niches with real counts than ${count} with guesses.`,
    ].filter(Boolean).join("\n\n");
    const data = await this.ask(prompt, this.maxSearches);
    const rows = Array.isArray(data.theses) ? (data.theses as Record<string, unknown>[]) : [];
    return rows.map((r) => toRaw(r, now)).filter((x): x is RawThesis => x !== null);
  }

  /** Re-measure theses we already hunt. Same schema, but anchored to the existing names and queries. */
  async refresh(theses: Thesis[], now = Date.now() / 1000): Promise<RawThesis[]> {
    const list = theses.map((t) => `- ${t.name} (search: ${t.queries.slice(0, 2).join(" / ")})`).join("\n");
    const prompt = `Re-measure these niches against eBay sold listings as they stand TODAY. Keep each name `
      + `exactly as given so the results can be matched up. Update the counts, prices, days-to-sell and trend; `
      + `correct the queries, must_any, negative and tells if you can improve them.\n\n${list}`;
    const data = await this.ask(prompt, Math.max(6, theses.length * 2));
    const rows = Array.isArray(data.theses) ? (data.theses as Record<string, unknown>[]) : [];
    return rows.map((r) => toRaw(r, now)).filter((x): x is RawThesis => x !== null);
  }
}

export function researcherFor(c: Config): ThesisResearcher | null {
  return c.claudeEnabled ? new ThesisResearcher(c.model, c.webSearch) : null;
}

/** Theses whose research has gone stale (or never happened), oldest first. */
export function staleTheses(theses: Thesis[], c: Config, now = Date.now() / 1000): Thesis[] {
  const cutoff = now - c.researchTtlDays * 86400;
  return theses
    .filter((t) => t.enabled && (t.researched_at === null || t.researched_at < cutoff))
    .sort((a, b) => (a.researched_at ?? 0) - (b.researched_at ?? 0));
}
