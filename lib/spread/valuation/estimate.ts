// Fallback valuer: parse the auctioneer's own estimate text ("$100 - $200").
import type { Lot, Valuation } from "../types";
import { emptyValuation } from "./base";

const RANGE = /\$?\s*([\d,]+(?:\.\d+)?)\s*(?:-|–|to)\s*\$?\s*([\d,]+(?:\.\d+)?)/;
const SINGLE = /\$?\s*([\d,]+(?:\.\d+)?)/;

export function parseEstimate(text: string): [number, number] | null {
  if (!text) return null;
  let m = RANGE.exec(text);
  if (m) {
    const lo = Number(m[1].replace(/,/g, "")), hi = Number(m[2].replace(/,/g, ""));
    return hi > 0 ? [Math.min(lo, hi), Math.max(lo, hi)] : null;
  }
  m = SINGLE.exec(text);
  if (m) {
    const v = Number(m[1].replace(/,/g, ""));
    return v > 0 ? [v * 0.8, v * 1.2] : null;
  }
  return null;
}

export function valueFromEstimate(lot: Lot): Valuation {
  const v = emptyValuation(lot);
  const rng = parseEstimate(lot.estimate || "");
  if (!rng) {
    v.rationale = "No independent valuation available and the auctioneer published no estimate.";
    return v;
  }
  const [lo, hi] = rng;
  v.low = lo; v.high = hi; v.mid = (lo + hi) / 2;
  v.method = "hibid_estimate";
  v.confidence = 0.3;
  v.confidence_reason = "Auctioneer's own estimate only; not independently verified.";
  v.identified_item = lot.title;
  v.rationale = `Auctioneer estimate ${lot.estimate}. Treat as a rough guide; auction-house estimates skew optimistic.`;
  v.risks = ["Estimate is from the seller side, not from sold comps."];
  return v;
}
