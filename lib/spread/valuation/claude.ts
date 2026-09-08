// Independent valuation with Claude + server-side web search. One request per lot. The lot's current
// bid is deliberately NOT shown to the model so the estimate can't anchor on it.
import Anthropic from "@anthropic-ai/sdk";
import type { Comp, ListingPlan, Lot, Valuation } from "../types";
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
- Report prices in USD. Never exceed 3 web searches per item; stop early when you have 3+ solid comps.
- Also draft the eBay listing you would post: an 80-character keyword-dense title (brand, what it is, era,
  maker marks, size, key search words; no filler like "LOOK" or "WOW"), the best eBay category, condition,
  item specifics buyers filter on, an honest 3-6 sentence description, three price points (quick sale =
  around the 25th percentile of sold comps, market = median, patient = 75th percentile), a best-offer floor,
  and a shipping estimate (weight class and packaging).`;

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
  },
  required: ["title", "category", "condition", "item_specifics", "description", "format", "price_quick", "price_market", "price_patient", "best_offer_floor", "auction_start", "shipping_weight_oz", "packaging", "shipping_cost_estimate", "keywords"],
  additionalProperties: false,
} as const;

const SCHEMA = {
  type: "object",
  properties: {
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
  required: ["identified_item", "brand", "model", "condition_assumption", "bulk_lot", "unit_count", "resale_low", "resale_mid", "resale_high", "confidence", "confidence_reason", "demand", "days_to_sell", "best_channel", "value_drivers", "risks", "rationale", "comps", "authenticity_risk", "search_query", "listing"],
  additionalProperties: false,
} as const;

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
  constructor(private model: string, private webSearch = true, private maxSearches = 3) {}

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
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: lotPrompt(lot, comps) }];
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
    const lst = data.listing as ListingPlan | undefined;
    if (lst && typeof lst === "object" && lst.title) v.listing = { ...lst, title: String(lst.title).slice(0, 80) };
    v.method = this.webSearch && searched ? "claude+web" : "claude";
    v.sources_consulted = [...new Set(v.comps.map((c) => (c.source || "").trim()).filter(Boolean))].sort();
    v.created_at = Date.now() / 1000;
    return v;
  }
}
