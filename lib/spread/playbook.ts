// The Playbook — hunting demand-first instead of lot-first.
//
// Everything before this module starts from a lot and asks "what is this worth". That finds value but
// it is passive: you only ever evaluate what the scanner happened to pull. A $1 advertising letter
// opener that sells for $30 in three hours is not a lucky accident, it is a repeatable NICHE, and the
// way to work a niche is to know its numbers first and then go looking for it.
//
// A THESIS is that knowledge, written down and testable:
//
//   what to search for  ->  queries, and the negatives that mean "wrong thing"
//   what it sells for   ->  p25 / median / p75 from real eBay sold data
//   how fast            ->  sold_90d vs active_now, median days to sell
//   what to pay         ->  max_bid, derived, the only number you act on at 2am
//
// MAX BID is the point of the whole exercise. Given a target return on capital, a resale median and a
// time to sell, there is exactly one bid above which the trade stops being worth doing, and it is
// arithmetic rather than nerve:
//
//   net        = median x (1 - fees) - shipping - packaging
//   k          = target_monthly_roi x capital_days / 30
//   landed_max = net / (1 + k)                    ... and never more than net / min_multiple
//   max_bid    = (landed_max - pickup) / ((1 + premium) x (1 + tax))
//
// Theses arrive three ways: SEEDED (a starter pack), DISCOVERED (a research pass over recent eBay sold
// data — see discovery.ts), or YOUR_SALES (mined from what you have actually flipped profitably, so the
// system keeps proposing more of what already worked for you).
import type { Config } from "./config";
import { assessLiquidity } from "./liquidity";
import { ebayFeeRate } from "./scoring";
import type { Liquidity, Lot, Outcome, Thesis, ThesisMatch, ThesisStats } from "./types";

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const round2 = (x: number) => Math.round(x * 100) / 100;

/** Lowercase, strip punctuation to spaces, collapse whitespace. Keeps digits: "1918" matters. */
export function normalizeText(s: string): string {
  return ` ${(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

/** A phrase matches when every one of its words is present as a whole word. */
function phraseIn(haystack: string, phrase: string): boolean {
  const words = normalizeText(phrase).trim().split(" ").filter(Boolean);
  if (!words.length) return false;
  return words.every((w) => haystack.includes(` ${w} `));
}

export function slugify(s: string): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "thesis";
}

/**
 * Does this lot look like the thing the thesis hunts for?
 *
 * The title carries most of the signal — an auctioneer who bothered to type "advertising letter opener"
 * is telling you what it is — so a title hit counts double. The description is searched too because box
 * lots bury the good item in a sentence. A negative term anywhere kills the match outright: the cost of
 * a false positive (a wasted valuation call, or worse, a bid) is far higher than a missed one.
 */
export function matchThesis(lot: Lot, t: Thesis): ThesisMatch | null {
  if (!t.enabled) return null;
  const title = normalizeText(`${lot.title ?? ""}`);
  const body = normalizeText(`${lot.description ?? ""} ${lot.category_path ?? ""}`);
  const both = title + body;

  for (const n of t.negative ?? []) if (phraseIn(both, n)) return null;
  if ((t.must_all ?? []).some((p) => !phraseIn(both, p))) return null;

  const hitsTitle = (t.must_any ?? []).filter((p) => phraseIn(title, p));
  const hitsBody = (t.must_any ?? []).filter((p) => !phraseIn(title, p) && phraseIn(body, p));
  if (!hitsTitle.length && !hitsBody.length) return null;

  // 0-1. Two title phrases is already a confident match; body-only hits cap out lower.
  const raw = hitsTitle.length * 2 + hitsBody.length;
  const strength = clamp(raw / 4, 0.15, 1);
  return {
    thesis_id: t.id,
    name: t.name,
    family: t.family,
    strength: Math.round(strength * 100) / 100,
    where: hitsTitle.length ? "title" : "description",
    matched: [...hitsTitle, ...hitsBody].slice(0, 4),
    max_bid: t.max_bid,
    max_landed: t.max_landed,
    price_median: t.price_median,
    eta: t.median_days_to_sell === null ? "" : `${Math.round(t.median_days_to_sell)}d`,
  };
}

/** All theses this lot matches, strongest first. */
export function matchTheses(lot: Lot, theses: Thesis[]): ThesisMatch[] {
  return theses
    .map((t) => matchThesis(lot, t))
    .filter((m): m is ThesisMatch => m !== null)
    .sort((a, b) => b.strength - a.strength || (b.max_bid ?? 0) - (a.max_bid ?? 0));
}

/** The liquidity this thesis implies, so a matched-but-unvalued lot still gets a speed read. */
export function thesisLiquidity(t: Thesis, c: Config): Liquidity {
  return assessLiquidity(
    {
      sold_90d: t.sold_90d, active_now: t.active_now, sell_through: t.sell_through,
      median_days_to_sell: t.median_days_to_sell, watchers_typical: null, price_dispersion: null,
      trend: t.trend ?? "unknown", seasonality: t.seasonality ?? "", buyer_pool: "", note: "",
    },
    null,
    { handlingDays: c.handlingDays, maxDays: c.maxDaysToSell },
  );
}

/**
 * The most this niche can COST YOU ALL-IN and still clear the target return on capital.
 *
 * This is the source of truth, and it is the right number for any channel: at an auction you convert it
 * back to a bid by stripping the buyer's premium, while buying locally the price plus the trip IS the
 * landed cost and compares directly. Null when the thesis has no researched price — an un-researched
 * thesis must not hand you a number.
 */
export function maxLandedFor(t: Thesis, c: Config, opts: { targetMonthlyRoi?: number } = {}): number | null {
  const median = t.price_median;
  if (!median || median <= 0) return null;
  const feeRate = ebayFeeRate(t.ebay_category ?? t.family ?? "", c);
  const ship = t.ship_cost ?? c.resaleShipping ?? 0;
  const net = median * (1 - feeRate) - ship - c.packagingCost;
  if (net <= 0) return null;

  const liq = thesisLiquidity(t, c);
  const capitalDays = Math.max(1, liq.capital_days);
  const target = opts.targetMonthlyRoi ?? c.targetMonthlyRoi;
  const k = Math.max(0, target) * (capitalDays / 30);

  let landedMax = net / (1 + k);
  // Belt and braces: never pay within `minMultiple` of net even if the thing sells the same day.
  landedMax = Math.min(landedMax, net / Math.max(1.2, c.minBuyMultiple));
  return landedMax > 0 ? round2(landedMax) : null;
}

/** The landed ceiling converted back to a bid: strip the buyer's premium, tax and pickup. */
export function maxBidFor(t: Thesis, c: Config, opts: { premium?: number; targetMonthlyRoi?: number } = {}): number | null {
  const landedMax = maxLandedFor(t, c, opts);
  if (landedMax === null) return null;
  const premium = opts.premium ?? c.buyerPremium;
  const bid = (landedMax - c.pickupCost) / ((1 + premium) * (1 + c.salesTax));
  return bid > 0.5 ? round2(bid) : null;
}

/** Recompute the derived fields on a thesis. Call after any edit or refresh. */
export function refreshThesis(t: Thesis, c: Config, now = Date.now() / 1000): Thesis {
  const sellThrough = t.sell_through ?? (t.sold_90d !== null && t.active_now !== null && t.sold_90d + t.active_now > 0
    ? Math.round((t.sold_90d / (t.sold_90d + t.active_now)) * 1000) / 1000
    : null);
  const withST = { ...t, sell_through: sellThrough };
  const liq = thesisLiquidity(withST, c);
  // With no market data at all the liquidity model falls back to a placeholder. Reporting that as a
  // grade would dress a guess up as a measurement, so an unresearched thesis shows nothing.
  const measured = liq.basis !== "none";
  return {
    ...withST,
    max_bid: maxBidFor(withST, c),
    max_landed: maxLandedFor(withST, c),
    liquidity_score: measured ? liq.score : null,
    liquidity_grade: measured ? liq.grade : null,
    days_p50: measured ? liq.days_p50 : null,
    updated_at: now,
  };
}

export function refreshAll(theses: Thesis[], c: Config, now = Date.now() / 1000): Thesis[] {
  return theses.map((t) => refreshThesis(t, c, now));
}

/** Fill in the fields a partial thesis (seed, model output, hand edit) leaves out. */
export function normalizeThesis(input: Partial<Thesis> & { name: string }, c: Config, now = Date.now() / 1000): Thesis {
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean) : []);
  const base: Thesis = {
    id: input.id || slugify(input.name),
    name: input.name.trim(),
    family: (input.family || "Other").trim(),
    queries: arr(input.queries).length ? arr(input.queries) : [input.name.trim()],
    negative: arr(input.negative),
    must_any: arr(input.must_any).length ? arr(input.must_any) : [input.name.trim()],
    must_all: arr(input.must_all),
    sold_90d: num(input.sold_90d),
    active_now: num(input.active_now),
    sell_through: num(input.sell_through),
    price_p25: num(input.price_p25),
    price_median: num(input.price_median),
    price_p75: num(input.price_p75),
    median_days_to_sell: num(input.median_days_to_sell),
    ship_cost: num(input.ship_cost) ?? 5,
    ebay_category: input.ebay_category ?? "",
    trend: (["rising", "flat", "falling"].includes(String(input.trend)) ? input.trend : "unknown") as Thesis["trend"],
    seasonality: input.seasonality ?? "",
    max_bid: null,
    max_landed: null,
    liquidity_score: null,
    liquidity_grade: null,
    days_p50: null,
    rationale: input.rationale ?? "",
    tells: arr(input.tells),
    risks: arr(input.risks),
    sources: arr(input.sources),
    confidence: typeof input.confidence === "number" ? clamp(input.confidence, 0, 1) : 0.4,
    origin: (["seed", "discovered", "your_sales", "manual"].includes(String(input.origin)) ? input.origin : "manual") as Thesis["origin"],
    enabled: input.enabled !== false,
    researched_at: input.researched_at ?? null,
    last_hunted_at: input.last_hunted_at ?? null,
    created_at: input.created_at ?? now,
    updated_at: now,
    stats: input.stats ?? emptyStats(),
  };
  return refreshThesis(base, c, now);
}

export function emptyStats(): ThesisStats {
  return { lots_matched: 0, bought: 0, sold: 0, spend: 0, revenue: 0, realized_monthly_roi: null, last_match_at: null };
}

/**
 * Mine the user's own realized round trips for niches worth hunting again.
 *
 * This is the flywheel: the letter opener was a $1 buy that sold for $30 in hours, and once that is
 * recorded there is no reason the system should ever need to be told about letter openers again. We look
 * for words that recur across profitable, fast sales — never across a single lucky one.
 */
export function thesesFromOutcomes(outcomes: Outcome[], c: Config, existing: Thesis[] = [], now = Date.now() / 1000): Thesis[] {
  const known = new Set(existing.flatMap((t) => [t.id, ...t.must_any.map((p) => slugify(p))]));
  const STOP = new Set(("the a an and or of for with in on at to from by lot lots vintage antique old new set pair "
    + "large small size inch inches used nice rare estate box case item items piece pieces original approx approximately "
    + "condition good great excellent unmarked marked").split(" "));

  interface Bucket { word: string; sales: number; spend: number; revenue: number; days: number[]; prices: number[]; titles: string[]; category: string }
  const buckets = new Map<string, Bucket>();

  for (const o of outcomes) {
    if (o.sale_price === null || !o.bought_price || o.bought_price <= 0) continue;
    // A sale the playbook already hunts teaches nothing new. Skipping these is what stops the
    // letter-opener wins from re-proposing "letter", "opener" and "advertising" as separate niches.
    const probe = { title: o.title, description: "", category_path: o.category } as Lot;
    if (matchTheses(probe, existing).length) continue;
    const days = o.listed_at && o.sale_at ? (o.sale_at - o.listed_at) / 86400 : null;
    const tokens = normalizeText(o.title).trim().split(" ").filter((w) => w.length > 3 && !STOP.has(w));
    // Bigrams first: "pocket mirror" is a niche, "pocket" is not.
    const pairs = tokens.slice(0, -1).map((w, i) => `${w} ${tokens[i + 1]}`);
    for (const w of new Set([...tokens, ...pairs])) {
      const b = buckets.get(w) ?? { word: w, sales: 0, spend: 0, revenue: 0, days: [], prices: [], titles: [], category: o.category || "Other" };
      b.sales++;
      b.spend += o.bought_price;
      b.revenue += o.sale_price;
      b.prices.push(o.sale_price);
      if (days !== null && days > 0) b.days.push(days);
      if (b.titles.length < 3) b.titles.push(o.title);
      buckets.set(w, b);
    }
  }

  const out: Thesis[] = [];
  // A phrase beats the words inside it when both describe the same sales, so take phrases first and
  // drop any single word already accounted for by one we kept.
  const claimed = new Set<string>();
  const ordered = [...buckets.values()].sort((a, b) => b.sales - a.sales || b.word.split(" ").length - a.word.split(" ").length);
  for (const b of ordered) {
    if (b.sales < c.thesisMinSales) continue;
    if (known.has(slugify(b.word))) continue;
    const roiPerSale = (b.revenue - b.spend) / b.spend;
    if (roiPerSale < c.thesisMinRoi) continue;
    const parts = b.word.split(" ");
    if (parts.length === 1 && claimed.has(b.word)) continue;
    for (const p of parts) claimed.add(p);
    const sorted = [...b.prices].sort((x, y) => x - y);
    const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    const medDays = b.days.length ? [...b.days].sort((x, y) => x - y)[Math.floor(b.days.length / 2)] : null;
    out.push(normalizeThesis({
      name: b.word.replace(/^\w/, (ch) => ch.toUpperCase()),
      family: b.category,
      queries: [b.word],
      must_any: [b.word],
      price_p25: round2(at(0.25)), price_median: round2(at(0.5)), price_p75: round2(at(0.75)),
      median_days_to_sell: medDays === null ? null : Math.round(medDays),
      confidence: clamp(0.3 + 0.1 * b.sales, 0, 0.8),
      origin: "your_sales",
      rationale: `You have sold ${b.sales} things matching "${b.word}" at a median of $${Math.round(at(0.5))}, `
        + `turning $${Math.round(b.spend)} into $${Math.round(b.revenue)}. Proposed from your own results, not research.`,
      tells: b.titles,
      researched_at: now,
      // Sold/active counts are unknown: these come from your sales, not from an eBay market scan.
      // The discovery refresh fills them in, and until then liquidity falls back to the observed days.
    }, c, now));
  }
  return out.sort((a, b) => (b.price_median ?? 0) - (a.price_median ?? 0)).slice(0, c.thesisMaxFromSales);
}

/** Roll each thesis's real-world results back onto it, so the playbook grades itself like everything else. */
export function applyOutcomeStats(theses: Thesis[], outcomes: Outcome[], lotsById: Map<number, Lot>): Thesis[] {
  const stats = new Map<string, ThesisStats>(theses.map((t) => [t.id, emptyStats()]));
  for (const o of outcomes) {
    const lot = lotsById.get(o.lot_id);
    // Outcomes carry the title; rebuild a minimal lot when the original has been purged.
    const probe: Lot = lot ?? ({ title: o.title, description: "", category_path: o.category } as Lot);
    for (const m of matchTheses(probe, theses)) {
      const s = stats.get(m.thesis_id)!;
      s.lots_matched++;
      s.last_match_at = Math.max(s.last_match_at ?? 0, o.closed_at);
      if (o.bought_price) { s.bought++; s.spend += o.bought_price; }
      if (o.sale_price !== null) { s.sold++; s.revenue += o.sale_price; }
    }
  }
  return theses.map((t) => {
    const s = stats.get(t.id) ?? emptyStats();
    const roi = s.spend > 0 && s.sold > 0 ? (s.revenue - s.spend) / s.spend : null;
    return { ...t, stats: { ...s, spend: round2(s.spend), revenue: round2(s.revenue), realized_monthly_roi: roi === null ? null : Math.round(roi * 1000) / 1000 } };
  });
}

/** Which theses to hunt next: least recently hunted first, so the search budget rotates. */
export function huntOrder(theses: Thesis[], n: number, now = Date.now() / 1000): Thesis[] {
  return theses
    .filter((t) => t.enabled && t.queries.length)
    .sort((a, b) => (a.last_hunted_at ?? 0) - (b.last_hunted_at ?? 0) || (b.confidence - a.confidence))
    .slice(0, Math.max(0, n));
}
