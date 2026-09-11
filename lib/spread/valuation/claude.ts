// Independent valuation with Claude + server-side web search. One request per lot. The lot's current
// bid is deliberately NOT shown to the model so the estimate can't anchor on it.
import Anthropic from "@anthropic-ai/sdk";
import type { Comp, DemandSignals, GradingAnalysis, ListingPlan, LotItem, Lot, Valuation } from "../types";

const CARD_WORDS = /\b(topps|bowman|fleer|upper deck|panini|donruss|o-?pee-?chee|leaf|prizm|select|optic|mosaic|chrome|refractor|rookie|rc|psa|bgs|sgc|cgc|pokemon|pokémon|magic the gathering|mtg|yu-?gi-?oh|trading card|baseball card|football card|basketball card|hockey card|sports card|wax pack|graded card|slab)\b/i;

/** Trading card lot? Title/category keywords; a bare year only counts alongside the word "card". */
export function isCard(lot: Lot): boolean {
  const text = `${lot.title ?? ""} ${lot.category_path ?? ""}`;
  if (CARD_WORDS.test(text)) return true;
  return /\bcards?\b/i.test(text) && /\b(19|20)\d\d\b/.test(text);
}

const CARD_PROMPT = `
THIS LOT IS A TRADING CARD. Do the full grading analysis (schema field \`grading\`, applicable=true):
1. Identify the card exactly: year, set, card number, player/subject, parallel/variation, rookie or not.
2. Read condition from the photos like a grader: centering (estimate left/right and top/bottom ratios),
   corners (sharp / soft / dinged / rounded), edges (clean / chipping / rough cut), surface (print lines,
   scratches, stains, wax, creases, snow). Say when the photo cannot show something.
3. Turn that into PSA grade probabilities (10 / 9 / 8 / 7-or-below) that sum to 1. TENS ARE RARE: use the
   set's PSA gem rate (pop 10 / total pop) as your prior for a 10 and only go above it with clear photo
   evidence of razor corners, dead centering and a flawless surface; most raw vintage cards are 5-7s;
   print-defect-prone sets almost never gem; modern pack-fresh cards can gem but rarely above 30%.
   Grading costs roughly $90 all-in per card and takes ~2 months, so the analysis must show whether the
   EXPECTED value (not the best case) clears that cost.
4. Search deeply for GRADED sales by grade: PSA Auction Prices Realized (psacard.com/auctionprices),
   SportsCardsPro / PriceCharting (price by grade), 130point.com (eBay sold aggregator), eBay sold filtered
   by 'PSA 10' / 'PSA 9' / 'PSA 8', Goldin/Heritage for high-end. Record grader, grade, price, source, URL, date.
5. Check the PSA population report (psacard.com/pop) and note the gem rate and whether a huge pop caps
   PSA 10 prices. Beckett (BGS 9.5 / Black Label) and SGC where they trade higher for that era.
6. Give the raw (ungraded) value, the recommended grader, and what to verify in hand before submitting
   (trimming, re-coloring, reprints, print lines that photos hide).
7. resale_low / resale_mid / resale_high MUST be the RAW (ungraded) sale value of the card as it sits. Never
   put a graded price in the main range; grading upside lives only in the \`grading\` field.
You may use up to 5 web searches for a card.`;
import { emptyValuation } from "./base";

const SYSTEM = `You are a veteran secondary-market appraiser and reseller (eBay power seller, estate liquidator,
pawn-shop valuation experience). You estimate what an item from an online auction lot would realistically
NET-SELL for on the open resale market in the next 30 days, based on evidence, not wishful thinking.

Rules:
- Identify the item precisely (brand, model, generation, size, variant). If the lot is vague, say what
  you assumed and lower confidence.
- Prefer SOLD/completed prices (eBay sold listings, auction results, Facebook Marketplace sold, Reverb,
  WorthPoint, Chrono24 sold, etc.) over asking prices. Note the source of every comp.
- Assume used/good condition unless the listing says otherwise; auction photos often hide flaws.
- For bulk lots, value the lot as a whole (what one buyer would pay), not the retail sum of parts.
- Flag authenticity risk for luxury brands, precious metals/coins, autographs, designer goods.
- Be conservative on obscure items, art, and collectibles; be precise on commodity electronics/tools.
- PHOTOS ARE THE EVIDENCE. Auction titles are often useless ("vintage knic knacs"); the value hides in a
  backstamp, a signature, a label, a pattern, or one piece among ten. Study every photo: read maker's marks,
  country-of-origin stamps, model numbers, hallmarks, edition numbers. For multi-item lots identify EACH
  distinct item, value each one, name the standout piece, and make the lot range the realistic total a
  reseller would net selling the good pieces individually and the rest as a group.
- LIQUIDITY IS AS IMPORTANT AS PRICE. What something is "worth" is useless if nobody is buying it: an item
  with 200 active listings and four sales a quarter is not a $40 item, it is a $40 asking price attached to
  a six-month wait. On every item report \`demand_signals\`:
  * sold_90d: how many comparable items SOLD on eBay in the last 90 days (count the sold results, don't guess).
  * active_now: how many comparable items are listed for sale RIGHT NOW (the active result count).
  * sell_through: sold / (sold + active), if you can compute it.
  * median_days_to_sell: from listing to sale, when the data shows it.
  * watchers_typical, price_dispersion ((p75 - p25) / median across the sold comps).
  * trend: rising / flat / falling over the last year, and any seasonality (holiday, back-to-school,
    baseball season, spring yard sales).
  * buyer_pool: who actually buys this and how many of them there are.
  Use round honest numbers and report -1 for anything you could not determine rather than inventing counts. A thin market with three
  sales a quarter must be reported as thin even when those three sales were high prices.
- Report prices in USD. Never exceed 3 web searches per item; stop early when you have 3+ solid comps.
- Also draft the eBay listing you would post, with three price points (quick sale = around the 25th
  percentile of sold comps, market = median, patient = 75th percentile), a best-offer floor, and a shipping
  estimate (weight class and packaging).
- The eBay listing must be written for eBay's search ranking (Best Match), not for a human editor:
  * TITLE (max 80 chars): front-load the highest-volume search terms buyers actually type (brand/maker,
    what it is, model/pattern, era, size, color, material, country). Use all 80 characters when possible.
    No filler ("L@@K", "WOW", "RARE!!" unless the item is verifiably rare), no punctuation runs, no ALL CAPS.
    Give two alternate titles that target different search phrasings.
  * CATEGORY: the leaf category where the sold comps actually live (browse the comps' categories).
  * ITEM SPECIFICS: fill every specific buyers filter on in that category (Brand, Type, Material, Color,
    Era/Decade, Country/Region of Manufacture, Original/Reproduction, Theme, Pattern, Style, Size, Features,
    Occasion, Character, Franchise, Set, Year, Model, MPN/UPC when known). Unfilled specifics cost ranking.
  * CONDITION: the eBay condition value, plus a one-line condition description that names every flaw.
  * DESCRIPTION: 4-8 short sentences; repeat the key terms naturally; what it is, marks, measurements,
    condition, what is included, shipping/handling promise. No walls of text, no HTML tricks.
  * PRICE/FORMAT: fixed price with Best Offer for items with steady sold comps; 7-day auction ending
    Sunday evening for scarce/collector items with bidding competition. Price at the comps, not at hope.
  * PHOTOS: list the exact shots to take (front, back, base/backstamp, close-up of marks, any damage, scale).
  * PROMOTED LISTINGS: suggest an ad rate (0 for commodity items with many sellers, 2-5% for competitive
    categories) and the best day/time to list.`;

const LISTING_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "eBay title, max 80 characters" },
    category: { type: "string", description: "eBay category path, e.g. Collectibles > Decorative Collectibles > Figurines" },
    condition: { type: "string", description: "eBay condition: New, Like New, Very Good, Good, Acceptable, Used, For parts" },
    item_specifics: { type: "array", items: { type: "object", properties: { name: { type: "string" }, value: { type: "string" } }, required: ["name", "value"], additionalProperties: false } },
    description: { type: "string" },
    format: { type: "string", enum: ["fixed_price", "auction"] },
    price_quick: { type: "number" },
    price_market: { type: "number" },
    price_patient: { type: "number" },
    best_offer_floor: { type: "number" },
    auction_start: { type: "number", description: "starting bid if format is auction, else 0" },
    shipping_weight_oz: { type: "number" },
    packaging: { type: "string", description: "padded mailer | small box | medium box | large box | freight" },
    shipping_cost_estimate: { type: "number", description: "what it will cost you to ship domestically, USD" },
    keywords: { type: "array", items: { type: "string" } },
    alt_titles: { type: "array", items: { type: "string" }, description: "two alternate 80-char titles targeting other search phrasings" },
    condition_description: { type: "string", description: "one line naming every flaw" },
    photo_checklist: { type: "array", items: { type: "string" }, description: "exact shots to take" },
    seo_notes: { type: "string", description: "why these terms/category/specifics rank; what buyers search" },
    promoted_rate: { type: "number", description: "suggested promoted listing ad rate as a fraction, 0 if none" },
    best_time_to_list: { type: "string" },
  },
  required: ["title", "category", "condition", "item_specifics", "description", "format", "price_quick", "price_market", "price_patient", "best_offer_floor", "auction_start", "shipping_weight_oz", "packaging", "shipping_cost_estimate", "keywords", "alt_titles", "condition_description", "photo_checklist", "seo_notes", "promoted_rate", "best_time_to_list"],
  additionalProperties: false,
} as const;

const GRADING_SCHEMA = {
  type: "object",
  description: "Trading-card grading analysis. applicable=false (and empty fields) for anything that is not a card.",
  properties: {
    applicable: { type: "boolean" },
    card: { type: "object", properties: { year: { type: "string" }, set: { type: "string" }, card_number: { type: "string" }, player_or_subject: { type: "string" }, parallel_or_variation: { type: "string" }, rookie: { type: "boolean" } }, required: ["year", "set", "card_number", "player_or_subject", "parallel_or_variation", "rookie"], additionalProperties: false },
    condition: { type: "object", properties: { centering: { type: "string", description: "e.g. '55/45 L/R, 60/40 T/B' or what the photo allows" }, corners: { type: "string" }, edges: { type: "string" }, surface: { type: "string" }, notes: { type: "string" }, photo_quality: { type: "string", enum: ["good", "limited", "unusable"] } }, required: ["centering", "corners", "edges", "surface", "notes", "photo_quality"], additionalProperties: false },
    grade_probabilities: { type: "object", description: "probabilities that PSA would return each grade; sum to 1", properties: { psa10: { type: "number" }, psa9: { type: "number" }, psa8: { type: "number" }, psa7_or_below: { type: "number" } }, required: ["psa10", "psa9", "psa8", "psa7_or_below"], additionalProperties: false },
    predicted_grade: { type: "string" },
    graded_comps: { type: "array", items: { type: "object", properties: { grader: { type: "string" }, grade: { type: "string" }, price: { type: "number" }, source: { type: "string" }, url: { type: "string" }, date: { type: "string" } }, required: ["grader", "grade", "price", "source", "url", "date"], additionalProperties: false } },
    pop: { type: "object", properties: { psa_total: { type: "integer" }, psa_10: { type: "integer" }, psa_9: { type: "integer" }, note: { type: "string", description: "gem rate, pop trend, whether the pop suppresses prices" } }, required: ["psa_total", "psa_10", "psa_9", "note"], additionalProperties: false },
    raw_value: { type: "number", description: "what it sells for ungraded, USD" },
    recommended_grader: { type: "string", enum: ["PSA", "BGS", "SGC", "CGC", "none"] },
    grading_notes: { type: "string", description: "what to verify in hand before submitting; risks (trimming, print lines, reprints)" },
  },
  required: ["applicable", "card", "condition", "grade_probabilities", "predicted_grade", "graded_comps", "pop", "raw_value", "recommended_grader", "grading_notes"],
  additionalProperties: false,
} as const;

const DEMAND_SCHEMA = {
  type: "object",
  description: "How fast this market actually moves. Counts come from eBay sold/active result counts; use null when unknown rather than guessing.",
  properties: {
    sold_90d: { type: "integer", description: "comparable items SOLD on eBay in the last 90 days; -1 if you could not determine it" },
    active_now: { type: "integer", description: "comparable items listed for sale right now; -1 if unknown" },
    sell_through: { type: "number", description: "sold / (sold + active), 0-1; -1 if unknown" },
    median_days_to_sell: { type: "number", description: "-1 if unknown" },
    watchers_typical: { type: "number", description: "typical watchers on an active listing; -1 if unknown" },
    price_dispersion: { type: "number", description: "(p75 - p25) / median across the sold comps; -1 if unknown" },
    trend: { type: "string", enum: ["rising", "flat", "falling", "unknown"] },
    seasonality: { type: "string", description: "when this sells best, or empty" },
    buyer_pool: { type: "string", description: "who buys this and how many of them there are" },
    note: { type: "string", description: "anything that changes how fast it moves: crowded category, niche buyers, shipping friction" },
  },
  required: ["sold_90d", "active_now", "sell_through", "median_days_to_sell", "watchers_typical", "price_dispersion", "trend", "seasonality", "buyer_pool", "note"],
  additionalProperties: false,
} as const;

const ITEM_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "what the item is, precisely" },
    maker_or_mark: { type: "string", description: "maker, backstamp, label or hallmark read from the photos, or 'unmarked'" },
    era: { type: "string" },
    est_low: { type: "number" },
    est_high: { type: "number" },
    confidence: { type: "number" },
    note: { type: "string", description: "why it is worth that; condition observations" },
  },
  required: ["name", "maker_or_mark", "era", "est_low", "est_high", "confidence", "note"],
  additionalProperties: false,
} as const;

const SCHEMA = {
  type: "object",
  properties: {
    items: { type: "array", items: ITEM_SCHEMA, description: "every distinct item identified in the lot (one entry for a single-item lot)" },
    standout_item: { type: "string", description: "the single most valuable item in the lot and why, or empty" },
    listing: LISTING_SCHEMA,
    grading: GRADING_SCHEMA,
    identified_item: { type: "string" },
    brand: { type: "string" },
    model: { type: "string" },
    condition_assumption: { type: "string" },
    bulk_lot: { type: "boolean" },
    unit_count: { type: "integer" },
    resale_low: { type: "number" },
    resale_mid: { type: "number" },
    resale_high: { type: "number" },
    confidence: { type: "number", description: "0-1 confidence that resale_mid is within +/-25%" },
    confidence_reason: { type: "string" },
    demand: { type: "string", enum: ["high", "medium", "low", "unknown"] },
    days_to_sell: { type: "integer" },
    demand_signals: DEMAND_SCHEMA,
    best_channel: { type: "string" },
    value_drivers: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    rationale: { type: "string" },
    comps: {
      type: "array",
      items: {
        type: "object",
        properties: { title: { type: "string" }, price: { type: "number" }, source: { type: "string" }, url: { type: "string" }, date: { type: "string" }, note: { type: "string" } },
        required: ["title", "price", "source", "url", "date", "note"],
        additionalProperties: false,
      },
    },
    authenticity_risk: { type: "boolean" },
    search_query: { type: "string", description: "best eBay sold-listings search string for this item" },
  },
  required: ["identified_item", "brand", "model", "condition_assumption", "bulk_lot", "unit_count", "resale_low", "resale_mid", "resale_high", "confidence", "confidence_reason", "demand", "days_to_sell", "demand_signals", "best_channel", "value_drivers", "risks", "rationale", "comps", "authenticity_risk", "search_query", "listing", "items", "standout_item", "grading"],
  additionalProperties: false,
} as const;

const MAX_IMAGE_BYTES = 4_500_000;
type ImageBlock = { type: "image"; source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string } };

export function lotImageUrls(lot: Lot): string[] {
  const urls = [...(lot.pictures ?? [])];
  for (const u of [lot.image_full, lot.image]) if (u && !urls.includes(u)) urls.push(u);
  return urls.filter(Boolean);
}

/** Download lot photos as Claude image blocks. Failures are skipped silently: photos are a bonus, never a blocker. */
export async function loadImages(urls: string[], maxImages = 4): Promise<ImageBlock[]> {
  const out: ImageBlock[] = [];
  for (const url of urls.slice(0, maxImages)) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "spread-hunter/0.1" }, signal: AbortSignal.timeout(15000), cache: "no-store" });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_IMAGE_BYTES || buf.length === 0) continue;
      let type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(type)) {
        type = buf[0] === 0xff && buf[1] === 0xd8 ? "image/jpeg" : buf[0] === 0x89 && buf[1] === 0x50 ? "image/png" : buf.subarray(8, 12).toString() === "WEBP" ? "image/webp" : "";
        if (!type) continue;
      }
      out.push({ type: "image", source: { type: "base64", media_type: type as ImageBlock["source"]["media_type"], data: buf.toString("base64") } });
    } catch {
      /* skip */
    }
  }
  return out;
}

/** Pull the demand block out of the model's JSON, keeping nulls as nulls: a missing count must not
 *  become a zero, because zero sales is a real and very different signal from "we didn't look". */
export function parseDemand(raw: unknown): DemandSignals | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  // -1 (or any negative) is the model's "I could not determine this". It must stay null, never become 0:
  // zero sales in 90 days is a real and very different signal from a missing measurement.
  const numOrNull = (k: string): number | null => {
    const v = d[k];
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const trend = String(d.trend ?? "unknown");
  const out: DemandSignals = {
    sold_90d: numOrNull("sold_90d"),
    active_now: numOrNull("active_now"),
    sell_through: numOrNull("sell_through"),
    median_days_to_sell: numOrNull("median_days_to_sell"),
    watchers_typical: numOrNull("watchers_typical"),
    price_dispersion: numOrNull("price_dispersion"),
    trend: (["rising", "flat", "falling"].includes(trend) ? trend : "unknown") as DemandSignals["trend"],
    seasonality: String(d.seasonality ?? ""),
    buyer_pool: String(d.buyer_pool ?? ""),
    note: String(d.note ?? ""),
  };
  if (out.sell_through === null && out.sold_90d !== null && out.active_now !== null) {
    const total = out.sold_90d + out.active_now;
    if (total > 0) out.sell_through = Math.round((out.sold_90d / total) * 1000) / 1000;
  }
  const empty = out.sold_90d === null && out.active_now === null && out.median_days_to_sell === null && out.trend === "unknown" && !out.note;
  return empty ? null : out;
}

function lotPrompt(lot: Lot, comps: Comp[]): string {
  let desc = (lot.description || "").trim();
  if (desc.length > 2500) desc = desc.slice(0, 2500) + " …";
  const parts = [
    "Appraise this online-auction lot for resale.",
    `Title: ${lot.title}`,
    "Note: a leading code like 'G)' is the auctioneer's sort prefix, not part of the item.",
    `Lot category: ${lot.category_path || lot.category || "unknown"}`,
    `Quantity in lot: ${lot.quantity || 1}`,
    `Auctioneer's estimate (may be absent or optimistic): ${lot.estimate || "none"}`,
    `Auction location: ${lot.city ?? ""} ${lot.state ?? ""}`.trim(),
    `Description:\n${desc || "(none)"}`,
  ];
  if (comps.length) {
    parts.push("Comparable listings we already pulled (verify relevance; 'asking price' entries are NOT sold prices):");
    for (const c of comps.slice(0, 15)) parts.push(`- $${c.price.toFixed(2)} | ${c.title} | ${c.source}${c.note ? " (" + c.note + ")" : ""} | ${c.date} | ${c.url}`);
  }
  parts.push("Search the web for sold comps if the evidence above is thin or ambiguous, then return the appraisal.");
  if (isCard(lot)) parts.push(CARD_PROMPT);
  return parts.join("\n");
}

export class ClaudeValuer {
  private client = new Anthropic();
  constructor(private model: string, private webSearch = true, private maxSearches = 3, private vision = true, private maxImages = 4) {}

  private request(messages: Anthropic.MessageParam[], maxSearches = this.maxSearches) {
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: 8000,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages,
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> } },
    };
    if (this.webSearch) params.tools = [{ type: "web_search_20260209", name: "web_search", max_uses: maxSearches }];
    return this.client.messages.create(params);
  }

  async value(lot: Lot, comps: Comp[] = []): Promise<Valuation> {
    const v = emptyValuation(lot);
    v.model_used = this.model;
    const images = this.vision ? await loadImages(lotImageUrls(lot), this.maxImages) : [];
    v.images_used = images.length;
    const text = lotPrompt(lot, comps);
    const content: Anthropic.MessageParam["content"] = images.length
      ? [{ type: "text", text: `Photos of the lot (${images.length} attached). Read every mark and label you can.` }, ...images, { type: "text", text }]
      : text;
    const messages: Anthropic.MessageParam[] = [{ role: "user", content }];
    let data: Record<string, unknown>;
    let searched = false;
    const searches = isCard(lot) ? 5 : this.maxSearches; // cards get a deeper pass: APR, pop report, price-by-grade
    try {
      let resp = await this.request(messages, searches);
      for (let i = 0; i < 3 && resp.stop_reason === "pause_turn"; i++) {
        messages.push({ role: "assistant", content: resp.content });
        resp = await this.request(messages, searches);
      }
      if (resp.stop_reason === "refusal") {
        v.error = "model declined";
        return v;
      }
      const text = resp.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
      searched = resp.content.some((b) => b.type === "web_search_tool_result");
      data = JSON.parse(text);
    } catch (e) {
      v.error = `${e instanceof Error ? e.name + ": " + e.message : String(e)}`.slice(0, 300);
      return v;
    }
    const n = (k: string) => Number(data[k] ?? 0) || 0;
    const s = (k: string) => String(data[k] ?? "");
    const mid = n("resale_mid");
    v.identified_item = s("identified_item"); v.brand = s("brand"); v.model = s("model");
    v.condition_assumption = s("condition_assumption");
    v.bulk_lot = !!data.bulk_lot; v.unit_count = Math.max(1, Math.trunc(n("unit_count") || 1));
    v.rationale = s("rationale");
    if (mid <= 0) return v; // method stays "none"
    v.low = Math.min(n("resale_low"), mid); v.mid = mid; v.high = Math.max(n("resale_high"), mid);
    v.confidence = Math.max(0, Math.min(1, n("confidence")));
    v.confidence_reason = s("confidence_reason");
    v.demand = (["high", "medium", "low"].includes(s("demand")) ? s("demand") : "unknown") as Valuation["demand"];
    v.days_to_sell = data.days_to_sell ? Math.trunc(n("days_to_sell")) : null;
    v.best_channel = s("best_channel");
    v.demand_signals = parseDemand(data.demand_signals);
    v.value_drivers = Array.isArray(data.value_drivers) ? data.value_drivers.map(String) : [];
    v.risks = Array.isArray(data.risks) ? data.risks.map(String) : [];
    v.comps = Array.isArray(data.comps) ? (data.comps as Comp[]).filter((c) => c && typeof c === "object") : [];
    for (const c of comps.slice(0, 10)) if (!v.comps.some((x) => x.url === c.url)) v.comps.push({ ...c, note: c.note || `raw ${c.source} pull` });
    v.authenticity_risk = !!data.authenticity_risk;
    v.search_query = s("search_query");
    v.items = Array.isArray(data.items) ? (data.items as LotItem[]).filter((i) => i && typeof i === "object" && i.name) : [];
    v.standout_item = s("standout_item");
    const g = data.grading as GradingAnalysis | undefined;
    v.grading = g && typeof g === "object" && g.applicable ? g : null;
    // Everything upstream (score, spread, radar) evaluates RAW. If the model slipped a graded price into the
    // main range, pull it back to its own raw_value and say so.
    if (v.grading && +v.grading.raw_value > 0 && v.mid && v.mid > +v.grading.raw_value * 1.25) {
      const raw = +v.grading.raw_value;
      v.low = raw * 0.8; v.mid = raw; v.high = raw * 1.25;
      v.confidence_reason = (v.confidence_reason ? v.confidence_reason + " " : "") + "Main range reset to the raw (ungraded) value; graded prices are in the grading section.";
    }
    const lst = data.listing as ListingPlan | undefined;
    if (lst && typeof lst === "object" && lst.title) v.listing = { ...lst, title: String(lst.title).slice(0, 80) };
    v.method = this.webSearch && searched ? "claude+web" : "claude";
    v.sources_consulted = [...new Set(v.comps.map((c) => (c.source || "").trim()).filter(Boolean))].sort();
    v.created_at = Date.now() / 1000;
    return v;
  }
}
