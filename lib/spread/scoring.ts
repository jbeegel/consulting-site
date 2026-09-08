// Turn (lot, valuation) into an opportunity: landed cost, net resale, spread, multiple, score, heat.
import type { Config } from "./config";
import type { ListingEconomics, Lot, PricePoint, Score, Valuation } from "./types";

export const TIME_BUCKETS: [string, number][] = [
  ["<1h", 3600], ["1-3h", 3 * 3600], ["3-6h", 6 * 3600], ["6-12h", 12 * 3600],
  ["12-24h", 24 * 3600], ["1-3d", 3 * 86400], ["3d+", Infinity],
];

export function timeBucket(seconds: number | null): string {
  if (seconds === null) return "unknown";
  for (const [label, cap] of TIME_BUCKETS) if (seconds < cap) return label;
  return "3d+";
}

export function priceReliability(seconds: number | null): number {
  if (seconds === null) return 0.4;
  if (seconds < 3600) return 1.0;
  if (seconds < 6 * 3600) return 0.85;
  if (seconds < 24 * 3600) return 0.65;
  if (seconds < 3 * 86400) return 0.45;
  return 0.3;
}

export function heat(score: number): Score["heat"] {
  return score >= 60 ? "hot" : score >= 40 ? "warm" : score >= 20 ? "mild" : "cold";
}

export function landedCost(bid: number, lot: Lot, c: Config): number {
  const premium = lot.buyer_premium_rate ?? c.buyerPremium;
  return bid * (1 + premium) * (1 + c.salesTax) + c.pickupCost;
}

export function scoreLot(lot: Lot, val: Valuation | null, c: Config, now = Date.now() / 1000): Score {
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
    net_resale: null, spread: null, ratio: null, confidence: 0, score: 0, heat: "unvalued",
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
  let score = 100 * (0.6 * ratioComponent + 0.4 * dollarComponent) * (0.5 + 0.5 * conf) * (0.5 + 0.5 * base.price_reliability);
  if (spread <= 0) score = 0;
  else if (spread < c.minSpread) score *= spread / c.minSpread;
  if (val.authenticity_risk) score *= 0.75;
  score = Math.round(score * 10) / 10;
  return { ...base, net_resale: net, net_resale_low: netLow, spread, spread_low: netLow - cost, ratio, confidence: conf, score, heat: heat(score), sweet_spot: sweet };
}

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

export function whyUpside(lot: Lot, val: Valuation | null, sc: Score, c: Config): string {
  if (!sc.valued || !val || val.mid === null) return "";
  const bits: string[] = [];
  const prem = Math.round((lot.buyer_premium_rate ?? c.buyerPremium) * 100);
  bits.push(`Next bid ${money(sc.next_bid)} lands at about ${money(sc.landed_cost)} all-in (buyer's premium ${prem}%${c.salesTax ? `, tax ${Math.round(c.salesTax * 100)}%` : ""}).`);
  bits.push(`Independent resale estimate is ${money(val.low ?? val.mid)}–${money(val.high ?? val.mid)} (mid ${money(val.mid)}); after ${Math.round(c.resaleFee * 100)}% selling fees that nets about ${money(sc.net_resale!)}, a ${sc.ratio!.toFixed(1)}x return and ${money(sc.spread!)} of headroom at the mid case.`);
  if (lot.bid_count === 0) bits.push("No bids yet, so the opening bid is the price today.");
  else if (sc.seconds_left !== null && sc.seconds_left < 6 * 3600)
    bits.push(`Closing in under ${Math.max(1, Math.floor(sc.seconds_left / 3600) + 1)}h with ${lot.bid_count} bids, so the current price is close to final.`);
  else bits.push("Plenty of time left; expect the price to rise near close.");
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

export function netOut(price: number, category: string, shippingCost: number, c: Config, shippingCharged = 0) {
  const gross = price + shippingCharged;
  const rate = ebayFeeRate(category, c);
  const fvf = gross * rate;
  const perOrder = gross <= 10 ? c.ebayPerOrderSmall : c.ebayPerOrder;
  const promoted = gross * c.ebayPromoted;
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
  const points: PricePoint[] = ([["quick", quick, 7], ["market", market, 21], ["patient", patient, 45]] as const).map(([label, price, days]) => {
    const e = netOut(price, cat, ship, c, charged);
    const profit = e.net - sc.landed_cost;
    return { ...e, label, expected_days: days, profit, roi: sc.landed_cost > 0 ? profit / sc.landed_cost : null };
  });
  return {
    category: cat, fee_rate: ebayFeeRate(cat, c), shipping_cost: ship, buyer_pays_shipping: charged > 0,
    format: lst?.format || "fixed_price", best_offer_floor: lst?.best_offer_floor ?? null, auction_start: lst?.auction_start ?? null,
    points, recommended: "market",
  };
}
