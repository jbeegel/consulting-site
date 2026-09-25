// The feedback loop: grade past predictions against what actually happened, then bend future
// valuations toward reality.
//
// Two tiers of evidence, weakest first:
//
//   1. HAMMER PRICES (free, automatic, every closed lot — even ones you never bid on).
//      HiBid publishes `priceRealized`. A hammer price is not a resale value, so it cannot tell us
//      we were too LOW. But it can prove we were too HIGH: if a lot's landed cost at the hammer
//      meets or beats the net resale we predicted, then either the winner overpaid or — far more
//      often across many lots — our number was inflated. The share of lots where that happens is
//      the `overshoot_rate`, and it is a provably-wrong rate, not a guess.
//
//   2. REAL SALES (ground truth, entered when you actually sell something).
//      actual sale / predicted mid. This is the real calibration signal and it overrides tier 1
//      as soon as there is enough of it.
//
// Bias is clamped and requires a minimum sample so a thin or unlucky week cannot swing the model.

import type { Config } from "./config";
import type { CalibrationReport, CategoryCalibration, CategoryLiquidity, LiquidityReport, Outcome } from "./types";

const GLOBAL = "__all__";

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Landed cost at the hammer, over the net resale we predicted. >= 1 means the deal was never there. */
export function hammerRatio(o: Outcome): number | null {
  if (!o.landed_at_hammer || !o.predicted_net || o.predicted_net <= 0) return null;
  return o.landed_at_hammer / o.predicted_net;
}

/** Actual sale price over the mid we predicted. 1.0 is a perfect call. */
export function saleRatio(o: Outcome): number | null {
  if (!o.sale_price || !o.predicted_mid || o.predicted_mid <= 0) return null;
  return o.sale_price / o.predicted_mid;
}

function calibrateGroup(category: string, rows: Outcome[], c: Config, now: number): CategoryCalibration {
  const hammers = rows.map(hammerRatio).filter((x): x is number => x !== null && Number.isFinite(x));
  const sales = rows.map(saleRatio).filter((x): x is number => x !== null && Number.isFinite(x));
  const medHammer = median(hammers);
  const medSale = median(sales);
  const overshoot = hammers.length ? hammers.filter((r) => r >= 1).length / hammers.length : null;
  const mape = sales.length ? median(sales.map((r) => Math.abs(r - 1))) : null;

  let bias = 1;
  let confidenceFactor = 1;
  let basis: CategoryCalibration["basis"] = "none";

  if (sales.length >= c.calibrationMinSales && medSale !== null) {
    // Ground truth wins outright.
    basis = "sales";
    bias = medSale;
    // Wide dispersion against real sales means the number is a coin flip; discount confidence.
    if (mape !== null) confidenceFactor = Math.max(0.4, Math.min(1, 1 - Math.max(0, mape - 0.2)));
  } else if (hammers.length >= c.calibrationMinClosed && overshoot !== null) {
    // No sales yet. We can only detect inflation, so only ever haircut — never inflate — on this basis.
    basis = "hammer";
    const excess = Math.max(0, overshoot - 0.25); // a quarter of picks getting outbid is normal
    bias = Math.min(1, 1 - excess);
    confidenceFactor = Math.max(0.5, Math.min(1, 1 - excess));
  }

  bias = Math.max(c.calibrationMinBias, Math.min(c.calibrationMaxBias, bias));
  return {
    category,
    n_closed: rows.length,
    n_sold: sales.length,
    median_hammer_ratio: medHammer,
    overshoot_rate: overshoot,
    median_sale_ratio: medSale,
    sale_mape: mape,
    bias: Math.round(bias * 1000) / 1000,
    confidence_factor: Math.round(confidenceFactor * 1000) / 1000,
    basis,
    updated_at: now,
  };
}

// ---------------------------------------------------------------------------- liquidity feedback
//
// The price loop above asks "was the number right". This one asks "did it ever actually sell", which is
// the question a $40 item sitting unviewed for three months answers differently.
//
// Two measurements, and the second is the one that keeps you honest:
//
//   OBSERVED DAYS — for the things that sold, listed_at to sale_at. Median observed over median predicted
//   gives a per-category multiplier that stretches (or compresses) every future speed estimate.
//
//   30-DAY SELL RATE — sold within 30 days, over everything that had a fair shot at 30 days. The
//   denominator deliberately includes listings that are STILL SITTING, because those are the whole point:
//   a loop that only learns from things that sold would conclude everything sells. A listing that has been
//   up for 12 days and has not sold is not yet evidence either way, so it is excluded until day 30
//   (right-censoring); one that has been up for 90 days unsold counts fully against the rate.

/** Days from listing to sale, for the ones that sold. */
export function observedDays(o: Outcome): number | null {
  if (!o.listed_at || !o.sale_at) return null;
  const d = (o.sale_at - o.listed_at) / 86400;
  return d >= 0 && Number.isFinite(d) ? d : null;
}

/** Days a listing has been up, sold or not. */
export function daysOnMarket(o: Outcome, now: number): number | null {
  if (!o.listed_at) return null;
  const end = o.sale_at ?? now;
  const d = (end - o.listed_at) / 86400;
  return d >= 0 && Number.isFinite(d) ? d : null;
}

function calibrateLiquidityGroup(category: string, rows: Outcome[], c: Config, now: number): CategoryLiquidity {
  const listed = rows.filter((o) => !!o.listed_at);
  const sold = listed.filter((o) => o.sale_at !== null && o.sale_price !== null);
  const obs = sold.map(observedDays).filter((x): x is number => x !== null);
  // Compare like with like: only the items we both predicted and observed.
  const pairs = sold
    .map((o) => ({ obs: observedDays(o), pred: o.predicted_days }))
    .filter((x): x is { obs: number; pred: number } => x.obs !== null && !!x.pred && x.pred > 0);
  const medObs = median(obs);
  const medPred = median(pairs.map((x) => x.pred));

  let multiplier = 1;
  let basis: CategoryLiquidity["basis"] = "none";
  if (pairs.length >= c.liquidityMinSales) {
    const ratios = pairs.map((x) => x.obs / x.pred).filter((r) => Number.isFinite(r) && r > 0);
    const m = median(ratios);
    if (m !== null) {
      multiplier = Math.max(0.3, Math.min(4, m));
      basis = "measured";
    }
  }

  // Censoring: a listing only enters the 30-day denominator once it has had 30 days, or once it sold.
  const eligible = listed.filter((o) => {
    const age = daysOnMarket(o, now);
    return age !== null && (o.sale_at !== null || age >= 30);
  });
  const within30 = eligible.filter((o) => {
    const d = observedDays(o);
    return d !== null && d <= 30;
  });
  const stuck = listed.filter((o) => o.sale_at === null && (daysOnMarket(o, now) ?? 0) >= 60).length;

  return {
    category,
    n_listed: listed.length,
    n_sold: sold.length,
    observed_days: medObs === null ? null : Math.round(medObs * 10) / 10,
    predicted_days: medPred === null ? null : Math.round(medPred * 10) / 10,
    days_multiplier: Math.round(multiplier * 1000) / 1000,
    sell_rate_30d: eligible.length ? Math.round((within30.length / eligible.length) * 1000) / 1000 : null,
    stuck,
    basis,
    updated_at: now,
  };
}

function buildLiquidityReport(outcomes: Outcome[], c: Config, now: number): LiquidityReport {
  const byCat = new Map<string, Outcome[]>();
  for (const o of outcomes) {
    const k = o.category || "Uncategorized";
    (byCat.get(k) ?? byCat.set(k, []).get(k)!).push(o);
  }
  const categories = [...byCat.entries()]
    .map(([cat, rows]) => calibrateLiquidityGroup(cat, rows, c, now))
    .filter((x) => x.n_listed > 0)
    .sort((a, b) => b.n_listed - a.n_listed);
  // Realized monthly ROI: what your capital has actually earned per month, across real round trips.
  const rois = outcomes
    .map((o) => {
      const d = observedDays(o);
      if (d === null || o.sale_price === null || !o.bought_price || o.bought_price <= 0) return null;
      return ((o.sale_price - o.bought_price) / o.bought_price) * (30 / Math.max(d, 1));
    })
    .filter((x): x is number => x !== null && Number.isFinite(x));
  const medRoi = median(rois);
  return {
    global: calibrateLiquidityGroup(GLOBAL, outcomes, c, now),
    categories,
    realized_monthly_roi: medRoi === null ? null : Math.round(medRoi * 1000) / 1000,
  };
}

/** The speed adjustment to apply to a new estimate in this category. Category first, then global. */
export function liquidityAdjustmentFor(report: LiquidityReport | null | undefined, category: string): { daysMultiplier: number; measuredN: number } {
  const none = { daysMultiplier: 1, measuredN: 0 };
  if (!report) return none;
  const cat = report.categories.find((x) => x.category === (category || "Uncategorized"));
  const pick = cat && cat.basis === "measured" ? cat : report.global.basis === "measured" ? report.global : null;
  return pick ? { daysMultiplier: pick.days_multiplier, measuredN: pick.n_sold } : none;
}

export function buildReport(outcomes: Outcome[], c: Config, now = Date.now() / 1000): CalibrationReport {
  const byCat = new Map<string, Outcome[]>();
  for (const o of outcomes) {
    const k = o.category || "Uncategorized";
    (byCat.get(k) ?? byCat.set(k, []).get(k)!).push(o);
  }
  const categories = [...byCat.entries()]
    .map(([cat, rows]) => calibrateGroup(cat, rows, c, now))
    .sort((a, b) => b.n_closed - a.n_closed);
  const realized = outcomes
    .filter((o) => o.sale_price !== null && o.bought_price !== null)
    .reduce((a, o) => a + (o.sale_price! - o.bought_price!), 0);
  return {
    generated_at: now,
    global: calibrateGroup(GLOBAL, outcomes, c, now),
    categories,
    totals: {
      closed: outcomes.length,
      sold: outcomes.filter((o) => o.sale_price !== null).length,
      realized_profit: outcomes.some((o) => o.sale_price !== null) ? Math.round(realized * 100) / 100 : null,
    },
    liquidity: buildLiquidityReport(outcomes, c, now),
  };
}

/** The adjustment to apply to a new valuation in this category. Falls back to global, then to no-op. */
export function adjustmentFor(report: CalibrationReport | null, category: string, c: Config): { bias: number; confidence_factor: number; basis: string; n: number } {
  const none = { bias: 1, confidence_factor: 1, basis: "none", n: 0 };
  if (!c.calibration || !report) return none;
  const cat = report.categories.find((x) => x.category === (category || "Uncategorized"));
  const pick = cat && cat.basis !== "none" ? cat : report.global.basis !== "none" ? report.global : null;
  if (!pick) return none;
  return { bias: pick.bias, confidence_factor: pick.confidence_factor, basis: pick.basis, n: pick.n_closed };
}
