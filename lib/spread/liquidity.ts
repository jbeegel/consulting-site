// Liquidity — how fast the money comes back, which is a different question from what a thing is worth.
//
// A $40 item that sits for six months is worse than a $25 item that sells in three days: the second one
// turns your capital over eight times while the first one is still sitting in a bin. Value tells you the
// size of the win; liquidity tells you whether you ever collect it. This module estimates the second.
//
// THE MODEL. eBay's own numbers give a clean hazard rate. If S comparable items sold in the last 90 days
// and A are listed right now, then each active listing sells at roughly
//
//     p = (S / 90) / A        per day
//
// That single number carries everything: a deep, fast market (S big, A small) gives a high p; a category
// where everyone is listing and nobody is buying (S small, A huge) gives a p near zero, which is exactly
// the "max promotion, no views" case. From p:
//
//     days_p50 = ln 2 / p     the median wait
//     days_p80 = ln 5 / p     the slow case you should plan cash around
//     P(sold within 30d) = 1 - (1 - p)^30
//
// SELL-THROUGH (S / (S + A)) is reported alongside because it is the number resellers already know, but
// the hazard is what the arithmetic runs on: sell-through alone cannot distinguish 5-sold-of-10 in a week
// from 5-sold-of-10 in a year.
//
// DEPTH is a separate axis and it gates confidence, not speed. Three sold comps in 90 days can still
// produce a fast-looking hazard; it is a fast-looking hazard computed from three data points.
//
// The estimate degrades gracefully: measured history (what YOUR listings actually did) beats the hazard,
// the hazard beats the appraiser's days-to-sell guess, and that beats a bucket read off the demand word.
import type { DemandSignals, Liquidity, LiquidityBasis, LiquidityDepth, Valuation } from "./types";

export interface LiquidityOptions {
  /** Handling: photograph, list, pack, hand to the carrier. Capital is tied up for this too. */
  handlingDays?: number;
  /** From the feedback loop: observed days / modeled days in this category. 1 = the model was right. */
  daysMultiplier?: number;
  /** Sample size behind that multiplier, for display. */
  measuredN?: number;
  /** Cap on how slow we will claim something is; beyond this it is "does not sell" either way. */
  maxDays?: number;
}

const LN2 = Math.log(2);
const LN5 = Math.log(5);

/** Fallback median days-to-sell when there are no counts to work from. */
const DEMAND_DAYS: Record<string, number> = { high: 12, medium: 32, low: 85, unknown: 45 };

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const round = (x: number, dp = 2) => Math.round(x * 10 ** dp) / 10 ** dp;

export function depthOf(sold90d: number | null): LiquidityDepth {
  if (sold90d === null) return "unknown";
  if (sold90d >= 40) return "deep";
  if (sold90d >= 12) return "moderate";
  if (sold90d >= 4) return "thin";
  return "dead";
}

const DEPTH_FACTOR: Record<LiquidityDepth, number> = { deep: 1, moderate: 0.93, thin: 0.78, dead: 0.55, unknown: 0.8 };

export function liquidityGrade(score: number): Liquidity["grade"] {
  if (score >= 75) return "A";
  if (score >= 55) return "B";
  if (score >= 35) return "C";
  if (score >= 18) return "D";
  return "F";
}

/** "3 days" / "2 weeks" / "4 months" — the number a person actually plans around. */
export function humanDays(days: number): string {
  if (days <= 1.5) return "about a day";
  if (days < 14) return `${Math.round(days)} days`;
  if (days < 70) return `${Math.round(days / 7)} weeks`;
  if (days < 365) return `${Math.round(days / 30)} months`;
  return "a year or more";
}

/** Daily probability that one listing sells, from the sold/active counts. Null when we cannot tell. */
export function dailyHazard(sold90d: number | null, activeNow: number | null): number | null {
  if (sold90d === null || activeNow === null) return null;
  if (sold90d <= 0) return 0.0005; // listed and never selling is information, not missing data
  const perDay = sold90d / 90;
  const p = perDay / Math.max(activeNow, 1);
  return clamp(p, 0.0005, 0.35);
}

export function sellThrough(sold90d: number | null, activeNow: number | null): number | null {
  if (sold90d === null || activeNow === null) return null;
  const total = sold90d + activeNow;
  return total <= 0 ? null : round(sold90d / total, 3);
}

/**
 * Turn what we know about demand into a speed estimate. `signals` is what the appraiser researched;
 * `valuation` supplies the weaker fallbacks (its days_to_sell guess, then its demand word).
 */
export function assessLiquidity(
  signals: DemandSignals | null | undefined,
  valuation: Pick<Valuation, "demand" | "days_to_sell" | "comps"> | null,
  opts: LiquidityOptions = {},
): Liquidity {
  const handling = opts.handlingDays ?? 3;
  const maxDays = opts.maxDays ?? 365;
  const s = signals ?? null;
  const sold90d = s && Number.isFinite(s.sold_90d as number) ? Math.max(0, Math.round(s.sold_90d as number)) : null;
  const activeNow = s && Number.isFinite(s.active_now as number) ? Math.max(0, Math.round(s.active_now as number)) : null;

  let hazard = dailyHazard(sold90d, activeNow);
  let basis: LiquidityBasis = hazard !== null ? "market" : "none";
  const notes: string[] = [];

  if (hazard !== null) {
    notes.push(`${sold90d} sold in 90 days against ${activeNow} listed now.`);
  } else if (s && Number.isFinite(s.median_days_to_sell as number) && (s.median_days_to_sell as number) > 0) {
    hazard = LN2 / clamp(s.median_days_to_sell as number, 1, maxDays);
    basis = "researched";
    notes.push("No sold/active counts; using the researched median time to sell.");
  } else if (valuation?.days_to_sell && valuation.days_to_sell > 0) {
    hazard = LN2 / clamp(valuation.days_to_sell, 1, maxDays);
    basis = "researched";
    notes.push("Using the appraiser's days-to-sell estimate.");
  } else {
    // Last resort: the appraiser's one-word demand read. When even that is missing we know nothing,
    // and "we did not look" must not be scored like "we looked and it is slow" — basis stays "none",
    // which makes liquidityFactor a no-op. Ignorance is not evidence of illiquidity.
    const demand = valuation?.demand ?? "unknown";
    hazard = LN2 / (DEMAND_DAYS[demand] ?? DEMAND_DAYS.unknown);
    basis = demand === "unknown" ? "none" : "assumed";
    notes.push(demand === "unknown"
      ? "No demand data was researched for this lot, so its speed is a placeholder and does not affect the score."
      : `No sold/active counts; assuming a ${demand}-demand item.`);
  }

  // The feedback loop: if this category has actually taken longer than the model said, believe the history.
  const mult = opts.daysMultiplier && Number.isFinite(opts.daysMultiplier) ? clamp(opts.daysMultiplier, 0.3, 4) : 1;
  if (mult !== 1) {
    hazard = hazard / mult;
    basis = "measured";
    notes.push(`Your own sales in this category run ${mult > 1 ? `${round(mult, 2)}x slower` : `${round(1 / mult, 2)}x faster`} than the model (${opts.measuredN ?? 0} listings).`);
  }
  hazard = clamp(hazard, LN2 / maxDays, 0.35);

  const daysP50 = clamp(LN2 / hazard, 0.5, maxDays);
  const daysP80 = clamp(LN5 / hazard, 1, maxDays * 2);
  const sellProb30 = round(1 - Math.pow(1 - hazard, 30), 3);
  const depth = depthOf(sold90d ?? (valuation?.comps?.length ? valuation.comps.length * 2 : null));

  // Score: speed is the spine, everything else trims it.
  let score = 100 * Math.exp(-daysP50 / 45); // 7d->85, 14d->73, 30d->51, 60d->26, 120d->7
  score *= DEPTH_FACTOR[depth];
  const trend = s?.trend ?? "unknown";
  if (trend === "rising") { score *= 1.08; notes.push("Prices/demand trending up."); }
  else if (trend === "falling") { score *= 0.88; notes.push("Demand trending down — sell sooner, price at the low end."); }
  const disp = s && Number.isFinite(s.price_dispersion as number) ? (s.price_dispersion as number) : null;
  if (disp !== null && disp > 0.8) { score *= 0.9; notes.push("Sold prices are all over the map; the realized number is a coin flip."); }
  if (basis === "assumed" || basis === "none") score *= 0.85; // a guess should not outrank a measured market
  score = clamp(round(score, 1), 1, 100);

  if (depth === "dead") notes.push("Almost nothing comparable has sold recently — treat any value estimate as theoretical.");
  else if (depth === "thin") notes.push("Thin market: few sales to average, so both price and timing are uncertain.");
  if (activeNow !== null && sold90d !== null && activeNow > sold90d * 3 && sold90d > 0)
    notes.push(`Crowded: ${activeNow} sellers competing for roughly ${round(sold90d / 3, 1)} sales a month. Promotion will not fix that.`);

  return {
    score,
    grade: liquidityGrade(score),
    depth,
    sold_90d: sold90d,
    active_now: activeNow,
    sell_through: s?.sell_through ?? sellThrough(sold90d, activeNow),
    daily_hazard: round(hazard, 5),
    days_p50: round(daysP50, 1),
    days_p80: round(daysP80, 1),
    sell_probability_30d: sellProb30,
    capital_days: round(daysP50 + handling, 1),
    handling_days: handling,
    trend,
    seasonality: s?.seasonality ?? "",
    basis,
    measured_n: opts.measuredN ?? 0,
    eta: humanDays(daysP50),
    notes,
  };
}

/**
 * Profit per dollar of capital per 30 days. The metric that settles "$40 item vs $25 item": a $3 lot that
 * nets $22 in a week beats a $3 lot that nets $37 in a year, and this is the number that says so.
 */
export function monthlyRoi(profit: number, landedCost: number, capitalDays: number): number | null {
  if (!(landedCost > 0) || !(capitalDays > 0)) return null;
  return round((profit / landedCost) * (30 / capitalDays), 3);
}

/** Expected profit weighted by the chance it actually sells inside the horizon. */
export function riskAdjustedProfit(profit: number, liq: Liquidity, horizonDays = 60): number {
  const p = 1 - Math.pow(1 - liq.daily_hazard, horizonDays);
  return round(profit * p, 2);
}

/**
 * How much of a lot's headline score survives its liquidity, at the weight the user chose.
 * weight 0 ignores liquidity entirely; weight 1 lets a dead market cut the score to a third.
 */
export function liquidityFactor(liq: Liquidity | null, weight: number): number {
  if (!liq || weight <= 0 || liq.basis === "none") return 1;
  const w = clamp(weight, 0, 1);
  const full = 0.35 + 0.65 * (liq.score / 100);
  return round(1 - w * (1 - full), 4);
}

/** Per-price-point speed: cheap sells faster. Used for the three eBay price points. */
export function daysAtPrice(liq: Liquidity | null, label: "quick" | "market" | "patient"): number {
  const base = liq?.days_p50 ?? (label === "quick" ? 7 : label === "market" ? 21 : 45);
  const factor = label === "quick" ? 0.45 : label === "patient" ? 2.2 : 1;
  return Math.max(1, Math.round(base * factor));
}
