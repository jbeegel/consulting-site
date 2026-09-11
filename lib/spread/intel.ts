// Market intel — the layer above any single lot. Three questions a per-lot score cannot answer:
//
//   Which categories are actually moving right now?  (trends, from the valuations we already paid for)
//   Where is my capital best used today?             (velocity leaders: profit per dollar per month)
//   What looks great and is secretly unsellable?     (value traps: high mid, no buyers)
//
// Everything here is derived from data already on disk — stored valuations and open lots — so the intel
// panel costs nothing extra to render and gets sharper with every scan.
import type { Config } from "./config";
import { assessLiquidity } from "./liquidity";
import type { CategoryTrend, LiquidityReport, MarketIntel, Opportunity, TrendPoint, Valuation } from "./types";

const day = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const r1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);

/** One row per valuation, reduced to the numbers a trend cares about. */
interface Sample { day: string; at: number; category: string; liquidity: number; days: number; sellThrough: number | null; mid: number | null }

function sample(v: Valuation, c: Config): Sample | null {
  if (!v.created_at) return null;
  const liq = assessLiquidity(v.demand_signals ?? null, v, { handlingDays: c.handlingDays, maxDays: c.maxDaysToSell });
  return {
    day: day(v.created_at),
    at: v.created_at,
    category: v.category || "Uncategorized",
    liquidity: liq.score,
    days: liq.days_p50,
    sellThrough: liq.sell_through,
    mid: v.mid,
  };
}

/**
 * Category trends over a rolling window. "Warming" compares the recent half against the earlier half of
 * the same window, so it reflects a change in what the market is doing rather than which lots we happened
 * to scan. Categories with too little history in one half are reported as "new" instead of a fake delta.
 */
export function buildTrends(valuations: Valuation[], c: Config, windowDays = c.trendWindowDays, now = Date.now() / 1000): CategoryTrend[] {
  const cutoff = now - windowDays * 86400;
  const mid = now - (windowDays / 2) * 86400;
  const samples = valuations
    .filter((v) => v.created_at >= cutoff && v.mid)
    .map((v) => sample(v, c))
    .filter((s): s is Sample => s !== null);

  const byCat = new Map<string, Sample[]>();
  for (const s of samples) (byCat.get(s.category) ?? byCat.set(s.category, []).get(s.category)!).push(s);

  const out: CategoryTrend[] = [];
  for (const [category, rows] of byCat) {
    const byDay = new Map<string, Sample[]>();
    for (const s of rows) (byDay.get(s.day) ?? byDay.set(s.day, []).get(s.day)!).push(s);
    const points: TrendPoint[] = [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([d, xs]) => ({
        day: d,
        n: xs.length,
        liquidity: r1(median(xs.map((x) => x.liquidity))),
        days_p50: r1(median(xs.map((x) => x.days))),
        mid: r1(median(xs.map((x) => x.mid).filter((x): x is number => x !== null))),
      }));

    const early = rows.filter((s) => s.at < mid).map((s) => s.liquidity);
    const late = rows.filter((s) => s.at >= mid).map((s) => s.liquidity);
    const me = median(early);
    const ml = median(late);
    // Both halves need at least a couple of observations before a delta means anything.
    const comparable = early.length >= 2 && late.length >= 2 && me !== null && ml !== null;
    const change = comparable ? Math.round((ml - me) * 10) / 10 : null;
    const direction: CategoryTrend["direction"] = !comparable ? "new" : change! >= 5 ? "warming" : change! <= -5 ? "cooling" : "steady";

    out.push({
      category,
      n: rows.length,
      liquidity: r1(median(rows.map((s) => s.liquidity))),
      days_p50: r1(median(rows.map((s) => s.days))),
      sell_through: median(rows.map((s) => s.sellThrough).filter((x): x is number => x !== null)),
      median_mid: r1(median(rows.map((s) => s.mid).filter((x): x is number => x !== null))),
      change,
      direction,
      points,
    });
  }
  return out.sort((a, b) => (b.liquidity ?? 0) - (a.liquidity ?? 0) || b.n - a.n);
}

/**
 * The live board. `opps` are today's open, valued lots; `history` is every valuation inside the window.
 * Velocity leaders answer "where should the next dollar go"; value traps are the mirror image — the lots
 * whose headline number would have fooled you.
 */
export function buildIntel(opps: Opportunity[], history: Valuation[], liquidity: LiquidityReport, c: Config, now = Date.now() / 1000): MarketIntel {
  const trends = buildTrends(history, c, c.trendWindowDays, now);
  const valued = opps.filter((o) => o.score.valued && o.score.liquidity && (o.score.spread ?? 0) > 0);

  const velocity_leaders = valued
    .filter((o) => o.score.monthly_roi !== null && o.score.liquidity!.grade <= "C") // A, B or C only
    .sort((a, b) => (b.score.monthly_roi ?? 0) - (a.score.monthly_roi ?? 0))
    .slice(0, 12)
    .map((o) => ({
      lot_id: o.lot.id,
      title: o.lot.title,
      category: o.lot.category || "Uncategorized",
      monthly_roi: o.score.monthly_roi!,
      liquidity_grade: o.score.liquidity!.grade,
      eta: o.score.liquidity!.eta,
      spread: Math.round(o.score.spread!),
      landed_cost: Math.round(o.score.landed_cost * 100) / 100,
      ends_at: o.lot.ends_at,
    }));

  const value_traps = opps
    .filter((o) => {
      const liq = o.score.liquidity;
      if (!liq || !o.valuation?.mid) return false;
      // Looks like money (would have scored well on upside alone) but the market underneath is not there.
      return o.score.score_before_liquidity >= 30 && (liq.grade === "F" || liq.depth === "dead" || liq.days_p50 >= 120);
    })
    .sort((a, b) => b.score.score_before_liquidity - a.score.score_before_liquidity)
    .slice(0, 12)
    .map((o) => {
      const liq = o.score.liquidity!;
      const reason = liq.depth === "dead"
        ? `Only ${liq.sold_90d ?? 0} comparable sales in 90 days.`
        : liq.active_now !== null && liq.sold_90d !== null && liq.active_now > liq.sold_90d
        ? `${liq.active_now} listed against ${liq.sold_90d} sold in 90 days.`
        : `Median time to sell is about ${liq.eta}.`;
      return {
        lot_id: o.lot.id,
        title: o.lot.title,
        category: o.lot.category || "Uncategorized",
        mid: o.valuation?.mid ?? null,
        liquidity_grade: liq.grade,
        eta: liq.eta,
        reason,
      };
    });

  return {
    generated_at: now,
    window_days: c.trendWindowDays,
    trends,
    warming: trends.filter((t) => t.direction === "warming").sort((a, b) => (b.change ?? 0) - (a.change ?? 0)).slice(0, 6),
    cooling: trends.filter((t) => t.direction === "cooling").sort((a, b) => (a.change ?? 0) - (b.change ?? 0)).slice(0, 6),
    liquidity,
    velocity_leaders,
    value_traps,
  };
}

/** Apply the user's own risk parameters to a ranked list. Server-side so alerts honour them too. */
export function applyIntelFilters(opps: Opportunity[], p: { min_liquidity_grade?: string | null; max_days_to_sell?: number | null; rank_by?: string }): Opportunity[] {
  let out = opps;
  const minGrade = p.min_liquidity_grade;
  if (minGrade && "ABCDF".includes(minGrade)) {
    // Grades sort naturally: "A" <= "B" <= ... Unvalued lots have no grade and are kept, since the
    // filter is about rejecting known-illiquid items, not about hiding things we have not looked at yet.
    out = out.filter((o) => !o.score.liquidity || o.score.liquidity.grade <= minGrade);
  }
  if (p.max_days_to_sell && p.max_days_to_sell > 0) {
    out = out.filter((o) => !o.score.liquidity || o.score.liquidity.days_p50 <= p.max_days_to_sell!);
  }
  const rank = p.rank_by ?? "score";
  const key = (o: Opportunity) =>
    rank === "velocity" ? o.score.monthly_roi ?? -1
    : rank === "liquidity" ? o.score.liquidity?.score ?? -1
    : rank === "spread" ? o.score.spread ?? -1
    : o.score.score;
  return [...out].sort((a, b) => key(b) - key(a));
}
