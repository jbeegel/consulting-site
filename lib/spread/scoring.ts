// Turn (lot, valuation) into an opportunity: landed cost, net resale, spread, multiple, score, heat.
import type { Config } from "./config";
import { assessLiquidity, daysAtPrice, liquidityFactor, monthlyRoi, riskAdjustedProfit, type LiquidityOptions } from "./liquidity";
import type { GradingEconomics, ListingEconomics, Lot, PricePoint, Score, Valuation } from "./types";

export const TIME_BUCKETS: [string, number][] = [
  ["<1h", 3600], ["1-3h", 3 * 3600], ["3-6h", 6 * 3600], ["6-12h", 12 * 3600],
  ["12-24h", 24 * 3600], ["1-3d", 3 * 86400], ["3d+", Infinity],
];

export function timeBucket(seconds: number | null): string {
  if (seconds === null) return "unknown";
  for (const [label, cap] of TIME_BUCKETS) if (seconds < cap) return label;
  return "3d+";
}

/** How much the current bid tells you about the final price. A $1 bid with a week left is noise;
 *  the same $1 with an hour left is the price. Multiplies the value score directly. */
export function priceReliability(seconds: number | null): number {
  if (seconds === null) return 0.3;
  const h = seconds / 3600;
  if (h < 1) return 1.0;
  if (h < 2) return 0.95;
  if (h < 6) return 0.8;
  if (h < 12) return 0.65;
  if (h < 24) return 0.5;
  if (h < 48) return 0.35;
  if (h < 7 * 24) return 0.2;
  return 0.1;
}

/** Radar = disparity x time. STRIKE: act now. WATCH: refresh often. TRACK: valued, closing within two days.
 *  SCAN: identified as valuable but too far out for the bid to mean anything yet. */
export function radarLevel(seconds: number | null, valueScore: number): Score["radar"] {
  if (seconds === null || valueScore < 20) return "scan";
  const h = seconds / 3600;
  return h < 2 ? "strike" : h < 12 ? "watch" : h < 48 ? "track" : "scan";
}

export function heat(score: number): Score["heat"] {
  return score >= 60 ? "hot" : score >= 40 ? "warm" : score >= 20 ? "mild" : "cold";
}

export function landedCost(bid: number, lot: Lot, c: Config): number {
  const premium = lot.buyer_premium_rate ?? c.buyerPremium;
  return bid * (1 + premium) * (1 + c.salesTax) + c.pickupCost;
}

/** Per-lot knobs the user can move from the dashboard without a redeploy. */
export interface ScoreOptions {
  /** 0 ignores liquidity, 1 lets a dead market cut the score to a third of its headline. */
  liquidityWeight?: number;
  /** From the feedback loop: observed days / modeled days for this lot's category. */
  liquidity?: LiquidityOptions;
  now?: number;
}

export function scoreLot(lot: Lot, val: Valuation | null, c: Config, now = Date.now() / 1000, opts: ScoreOptions = {}): Score {
  let secs = lot.ends_at ? lot.ends_at - now : lot.time_left_seconds;
  if (secs !== null) secs = Math.max(0, secs);
  const highBid = lot.high_bid || 0;
  let nextBid = lot.min_bid ? lot.min_bid : highBid ? highBid * 1.1 : 0;
  if (nextBid <= 0) nextBid = 1;
  const qty = lot.quantity || 1;
  if ((lot.bid_amount_type ?? "").toUpperCase().endsWith("EACH") && qty > 1) nextBid *= qty;

  const base: Score = {
    lot_id: lot.id,
    seconds_left: secs,
    time_bucket: timeBucket(secs),
    next_bid: nextBid,
    landed_cost: landedCost(nextBid, lot, c),
    price_reliability: priceReliability(secs),
    valued: !!(val && val.mid),
    net_resale: null, spread: null, ratio: null, confidence: 0, value_score: 0, score: 0, heat: "unvalued", radar: "scan",
    liquidity: null, liquidity_factor: 1, score_before_liquidity: 0, monthly_roi: null, expected_profit_60d: null,
  };
  if (!base.valued || !val || !val.mid) return base;

  const mid = val.mid;
  const net = mid * (1 - c.resaleFee) - c.resaleShipping;
  const netLow = (val.low ?? mid) * (1 - c.resaleFee) - c.resaleShipping;
  const cost = base.landed_cost;
  const spread = net - cost;
  const ratio = cost > 0 ? net / cost : 0;
  const conf = val.confidence || 0;
  // Multiple matters most (a $1 -> $30 penny lot is a 25x, the bread and butter of auction flipping);
  // dollars matter too, scaled to a realistic "great flip" rather than a four-figure one.
  const sweet = cost <= c.sweetMaxLanded && net >= c.sweetMinNet;
  const ratioComponent = Math.max(0, Math.min(1, Math.log2(Math.max(ratio, 1)) / 3)); // 8x = full marks
  let dollarComponent = Math.max(0, Math.min(1, spread / Math.max(1, c.spreadFull)));
  if (sweet) dollarComponent = Math.max(dollarComponent, 0.5);
  let valueScore = 100 * (0.6 * ratioComponent + 0.4 * dollarComponent) * (0.5 + 0.5 * conf);
  if (spread <= 0) valueScore = 0;
  else if (spread < c.minSpread) valueScore *= spread / c.minSpread;
  if (val.authenticity_risk) valueScore *= 0.75;
  valueScore = Math.round(valueScore * 10) / 10;
  const beforeLiquidity = Math.round(valueScore * base.price_reliability * 10) / 10;

  // Liquidity: worth is not the same as sellable. A number nobody is buying at is a number on paper.
  const liq = assessLiquidity(val.demand_signals ?? null, val, {
    handlingDays: c.handlingDays,
    maxDays: c.maxDaysToSell,
    ...(opts.liquidity ?? {}),
  });
  const weight = opts.liquidityWeight ?? c.liquidityWeight;
  const factor = liquidityFactor(liq, weight);
  const score = Math.round(beforeLiquidity * factor * 10) / 10;

  return {
    ...base, net_resale: net, net_resale_low: netLow, spread, spread_low: netLow - cost, ratio, confidence: conf,
    value_score: valueScore, score, heat: heat(score), sweet_spot: sweet, radar: radarLevel(secs, valueScore),
    liquidity: liq, liquidity_factor: factor, score_before_liquidity: beforeLiquidity,
    monthly_roi: monthlyRoi(spread, cost, liq.capital_days),
    expected_profit_60d: riskAdjustedProfit(spread, liq),
  };
}

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
/** Monthly return on capital. Past ~10x a percentage stops reading as a number, so switch to multiples:
 *  a $1 lot that nets $30 in a week is "40x/month", not "4000%". */
const perMonth = (roi: number) => (roi >= 9.99 ? `${Math.round(roi)}x/month` : `${Math.round(roi * 100)}%/month`);

/** How a lot reads once liquidity is in the picture: the one-line verdict the table shows. */
export function liquidityVerdict(sc: Score): string {
  const liq = sc.liquidity;
  if (!liq || !sc.valued) return "";
  const roi = sc.monthly_roi;
  if (liq.grade === "F" || liq.depth === "dead")
    return `Worth ${money(sc.net_resale ?? 0)} on paper, but almost nothing comparable sells — expect ${liq.eta} or never.`;
  if (liq.grade === "D")
    return `Slow money: ${liq.eta} to sell${roi === null ? "" : `, about ${perMonth(roi)} on the capital`}.`;
  if (roi !== null && roi >= 1 && (liq.grade === "A" || liq.grade === "B"))
    return `Fast money: sells in ${liq.eta}, roughly ${perMonth(roi)} on what you tie up.`;
  return `Sells in about ${liq.eta}${roi === null ? "" : ` — ${perMonth(roi)} on the capital`}.`;
}

export function whyUpside(lot: Lot, val: Valuation | null, sc: Score, c: Config): string {
  if (!sc.valued || !val || val.mid === null) return "";
  const bits: string[] = [];
  const prem = Math.round((lot.buyer_premium_rate ?? c.buyerPremium) * 100);
  bits.push(`Next bid ${money(sc.next_bid)} lands at about ${money(sc.landed_cost)} all-in (buyer's premium ${prem}%${c.salesTax ? `, tax ${Math.round(c.salesTax * 100)}%` : ""}).`);
  bits.push(`Independent resale estimate is ${money(val.low ?? val.mid)}–${money(val.high ?? val.mid)} (mid ${money(val.mid)}); after ${Math.round(c.resaleFee * 100)}% selling fees that nets about ${money(sc.net_resale!)}, a ${sc.ratio!.toFixed(1)}x return and ${money(sc.spread!)} of headroom at the mid case.`);
  if (lot.bid_count === 0) bits.push("No bids yet, so the opening bid is the price today.");
  else if (sc.seconds_left !== null && sc.seconds_left < 6 * 3600)
    bits.push(`Closing in under ${Math.max(1, Math.floor(sc.seconds_left / 3600) + 1)}h with ${lot.bid_count} bids, so the current price is close to final.`);
  else if (sc.seconds_left !== null && sc.seconds_left > 48 * 3600)
    bits.push(`Still ${Math.floor(sc.seconds_left / 86400)}+ days out, so today's bid means little; it stays on the radar and the score climbs as the close approaches.`);
  else bits.push("Plenty of time left; expect the price to rise near close.");
  if (val.standout_item) bits.push(`Standout piece: ${val.standout_item}.`);
  const liq = sc.liquidity;
  if (liq) {
    const parts = [`Liquidity ${liq.grade} (${liq.score}/100)`];
    if (liq.sold_90d !== null && liq.active_now !== null) parts.push(`${liq.sold_90d} sold in 90 days vs ${liq.active_now} listed now`);
    if (liq.sell_through !== null) parts.push(`${Math.round(liq.sell_through * 100)}% sell-through`);
    bits.push(parts.join(", ") + `: expect about ${liq.eta} to sell (${Math.round(liq.sell_probability_30d * 100)}% chance inside 30 days), so roughly ${liq.capital_days} days of your money${sc.monthly_roi === null ? "" : ` at about ${perMonth(sc.monthly_roi)}`}.`);
    if (liq.grade === "F" || liq.depth === "dead") bits.push("Treat the resale number as theoretical until something comparable actually sells.");
    if (liq.trend === "falling") bits.push("Demand is trending down; price at the quick number, not the patient one.");
    if (liq.seasonality) bits.push(`Seasonality: ${liq.seasonality}.`);
  }
  const ge = gradingEconomics(val, sc, c);
  if (ge) {
    if (ge.upside > 0) bits.push(`Grading: expected net ${money(ge.graded_net)} graded vs ${money(ge.raw_net)} raw after ~${money(ge.grading_cost)} to grade (+${money(ge.upside)}, likely ${ge.predicted_grade || "PSA 8-9"}); recommendation: ${ge.recommendation}.`);
    else bits.push(`Grading does not pay: ~${money(ge.grading_cost)} to grade against an expected ${money(ge.ev_gross)} graded sale; sell raw.`);
  }
  if (val.value_drivers?.length) bits.push("Value drivers: " + val.value_drivers.slice(0, 3).join("; ") + ".");
  if (val.risks?.length) bits.push("Watch for: " + val.risks.slice(0, 2).join("; ") + ".");
  return bits.join(" ");
}

// ---------------------------------------------------------------------------
// eBay listing economics: what you net at each recommended price point
// ---------------------------------------------------------------------------
const MEDIA = /\b(book|books|magazine|comic|movie|dvd|blu-ray|vhs|music|cd|vinyl|record|lp|cassette)\b/i;

export function ebayFeeRate(category: string, c: Config): number {
  return MEDIA.test(category || "") ? c.ebayFvfMedia : c.ebayFvf;
}

export function netOut(price: number, category: string, shippingCost: number, c: Config, shippingCharged = 0, promotedRate = c.ebayPromoted) {
  const gross = price + shippingCharged;
  const rate = ebayFeeRate(category, c);
  const fvf = gross * rate;
  const perOrder = gross <= 10 ? c.ebayPerOrderSmall : c.ebayPerOrder;
  const promoted = gross * promotedRate;
  const net = gross - fvf - perOrder - promoted - shippingCost - c.packagingCost;
  return { price, shipping_charged: shippingCharged, fvf, fvf_rate: rate, per_order: perOrder, promoted, shipping_cost: shippingCost, packaging: c.packagingCost, net };
}

export function listingEconomics(lot: Lot, val: Valuation | null, sc: Score, c: Config): ListingEconomics | null {
  if (!val || !val.mid) return null;
  const lst = val.listing ?? null;
  const cat = lst?.category || lot.category_path || "";
  const ship = Number(lst?.shipping_cost_estimate ?? c.resaleShipping ?? 0) || 0;
  const quick = Number(lst?.price_quick || val.low || val.mid * 0.8);
  const market = Number(lst?.price_market || val.mid);
  const patient = Number(lst?.price_patient || val.high || val.mid * 1.2);
  const charged = market < 60 ? ship : 0; // buyer pays shipping on cheap items; seller absorbs on pricey ones
  const promo = c.ebayPromoted || Math.max(0, Math.min(0.2, Number(lst?.promoted_rate) || 0));
  const points: PricePoint[] = ([["quick", quick], ["market", market], ["patient", patient]] as const).map(([label, price]) => {
    const e = netOut(price, cat, ship, c, charged, promo);
    const profit = e.net - sc.landed_cost;
    // Days come from the measured market, not a constant: pricing below the comps sells sooner.
    const days = daysAtPrice(sc.liquidity, label);
    return {
      ...e, label, expected_days: days, profit,
      roi: sc.landed_cost > 0 ? profit / sc.landed_cost : null,
      monthly_roi: monthlyRoi(profit, sc.landed_cost, days + (sc.liquidity?.handling_days ?? c.handlingDays)),
    };
  });
  return {
    category: cat, fee_rate: ebayFeeRate(cat, c), shipping_cost: ship, buyer_pays_shipping: charged > 0,
    format: lst?.format || "fixed_price", best_offer_floor: lst?.best_offer_floor ?? null, auction_start: lst?.auction_start ?? null,
    points, recommended: "market",
  };
}

// ---------------------------------------------------------------------------
// Grading economics (trading cards): EV of grading vs. selling raw
// ---------------------------------------------------------------------------
type Bucket = "10" | "9" | "8" | "7-";
const BUCKETS: Bucket[] = ["10", "9", "8", "7-"];

function bucket(grade: string): Bucket | null {
  const m = /(\d+(?:\.\d)?)/.exec(String(grade ?? ""));
  if (!m) return null;
  const g = Number(m[1]);
  return g >= 9.5 ? "10" : g >= 9 ? "9" : g >= 8 ? "8" : "7-";
}

export function gradingEconomics(val: Valuation | null, sc: Score, c: Config): GradingEconomics | null {
  const g = val?.grading;
  if (!c.grading || !g || !g.applicable) return null;
  const pr = g.grade_probabilities ?? { psa10: 0, psa9: 0, psa8: 0, psa7_or_below: 0 };
  let p: Record<Bucket, number> = { "10": +pr.psa10 || 0, "9": +pr.psa9 || 0, "8": +pr.psa8 || 0, "7-": +pr.psa7_or_below || 0 };
  const tot = BUCKETS.reduce((a, b) => a + p[b], 0);
  if (tot <= 0) return null;
  p = { "10": p["10"] / tot, "9": p["9"] / tot, "8": p["8"] / tot, "7-": p["7-"] / tot };
  const by: Record<Bucket, number[]> = { "10": [], "9": [], "8": [], "7-": [] };
  for (const cmp of g.graded_comps ?? []) {
    const b = bucket(cmp.grade);
    if (b && +cmp.price > 0) by[b].push(+cmp.price);
  }
  const raw = +g.raw_value || val?.mid || 0;
  const prices: Record<Bucket, number | null> = { "10": null, "9": null, "8": null, "7-": null };
  for (const b of BUCKETS) { const xs = by[b].sort((x, y) => x - y); prices[b] = xs.length ? xs[Math.floor(xs.length / 2)] : null; }
  if (prices["7-"] === null) prices["7-"] = raw;
  if (prices["8"] === null) prices["8"] = Math.max(raw, prices["7-"] ?? raw);
  if (prices["9"] === null) prices["9"] = prices["8"];
  if (prices["10"] === null) prices["10"] = prices["9"];
  const evGross = BUCKETS.reduce((a, b) => a + p[b] * (prices[b] ?? 0), 0);
  const cost = c.gradingFee + c.gradingShip + c.packagingCost;
  const gradedNet = evGross * (1 - c.resaleFee) - cost;
  const rawNet = raw * (1 - c.resaleFee) - c.packagingCost;
  const upside = gradedNet - rawNet;
  // Robustness: what if the 10 never comes? Move its probability onto the 9. A plan that only works in
  // the gem case is a lottery ticket.
  const pNo10: Record<Bucket, number> = { ...p, "9": p["9"] + p["10"], "10": 0 };
  const evNo10 = BUCKETS.reduce((a, b) => a + pNo10[b] * (prices[b] ?? 0), 0);
  const gradedNetNo10 = evNo10 * (1 - c.resaleFee) - cost;
  const upsideNo10 = gradedNetNo10 - rawNet;
  const photoQ = g.condition?.photo_quality ?? "limited";
  const hurdle = Math.max(25, 0.3 * cost, 0.25 * Math.max(rawNet, 1)); // must clear the ~$90 outlay with margin
  const rec = photoQ === "unusable" ? "inspect in hand"
    : upside > hurdle && upsideNo10 > 0 ? "grade"
    : upside > hurdle ? "speculative: pays only if it gems"
    : upside > 0 && p["10"] + p["9"] >= 0.5 ? "grade if it looks 9+ in hand"
    : "sell raw";
  return {
    probabilities: p, prices, ev_gross: evGross, graded_net: gradedNet, raw_value: raw, raw_net: rawNet, upside,
    graded_net_no10: gradedNetNo10, upside_no10: upsideNo10, grading_cost: cost, hurdle,
    grading_fee: c.gradingFee, grading_ship: c.gradingShip, days: c.gradingDays, recommendation: rec,
    predicted_grade: g.predicted_grade ?? null, recommended_grader: g.recommended_grader ?? null, photo_quality: photoQ,
    profit_graded_vs_landed: gradedNet - sc.landed_cost,
  };
}
