// Independent valuation with Claude + server-side web search. One request per lot. The lot's current
// bid is deliberately NOT shown to the model so the estimate can't anchor on it.
import Anthropic from "@anthropic-ai/sdk";
import type { Comp, ListingPlan, LotItem, Lot, Valuation } from "../types";
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
  required: ["identified_item", "brand", "model", "condition_assumption", "bulk_lot", "unit_count", "resale_low", "resale_mid", "resale_high", "confidence", "confidence_reason", "demand", "days_to_sell", "best_channel", "value_drivers", "risks", "rationale", "comps", "authenticity_risk", "search_query", "listing", "items", "standout_item"],
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
  return parts.join("\n");
}

export class ClaudeValuer {
  private client = new Anthropic();
  constructor(private model: string, private webSearch = true, private maxSearches = 3, private vision = true, private maxImages = 4) {}

  private request(messages: Anthropic.MessageParam[]) {
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: 8000,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages,
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> } },
    };
    if (this.webSearch) params.tools = [{ type: "web_search_20260209", name: "web_search", max_uses: this.maxSearches }];
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
    try {
      let resp = await this.request(messages);
      for (let i = 0; i < 3 && resp.stop_reason === "pause_turn"; i++) {
        messages.push({ role: "assistant", content: resp.content });
        resp = await this.request(messages);
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
    v.value_drivers = Array.isArray(data.value_drivers) ? data.value_drivers.map(String) : [];
    v.risks = Array.isArray(data.risks) ? data.risks.map(String) : [];
    v.comps = Array.isArray(data.comps) ? (data.comps as Comp[]).filter((c) => c && typeof c === "object") : [];
    for (const c of comps.slice(0, 10)) if (!v.comps.some((x) => x.url === c.url)) v.comps.push({ ...c, note: c.note || `raw ${c.source} pull` });
    v.authenticity_risk = !!data.authenticity_risk;
    v.search_query = s("search_query");
    v.items = Array.isArray(data.items) ? (data.items as LotItem[]).filter((i) => i && typeof i === "object" && i.name) : [];
    v.standout_item = s("standout_item");
    const lst = data.listing as ListingPlan | undefined;
    if (lst && typeof lst === "object" && lst.title) v.listing = { ...lst, title: String(lst.title).slice(0, 80) };
    v.method = this.webSearch && searched ? "claude+web" : "claude";
    v.sources_consulted = [...new Set(v.comps.map((c) => (c.source || "").trim()).filter(Boolean))].sort();
    v.created_at = Date.now() / 1000;
    return v;
  }
}
