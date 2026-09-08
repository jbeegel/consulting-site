import { createHash } from "node:crypto";
import type { Lot, Valuation } from "../types";

const STOP = new Set(["lot", "of", "the", "and", "with", "a", "an", "for", "in", "new", "used", "pcs", "pc", "set"]);

const PREFIX = /^\s*(?:[A-Za-z]{1,2}\)|\(?[A-Za-z]{1,2}\)|#?\d{1,4}[.)-])\s*/;

/** Auctioneers prefix titles with sort codes like "G) " or "12) "; drop them before searching. */
export function stripPrefix(title: string): string {
  return (title || "").replace(PREFIX, "").trim();
}

/** Stable key for "same item" so identical lots across auctions reuse a valuation. */
export function titleKey(title: string, quantity?: number | null): string {
  const words = (stripPrefix(title).toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => !STOP.has(w));
  let base = words.join(" ");
  if (quantity && quantity > 1) base += ` x${Math.trunc(quantity)}`;
  return createHash("sha1").update(base).digest("hex").slice(0, 16);
}

export function emptyValuation(lot: Lot): Valuation {
  return {
    lot_id: lot.id,
    title_key: titleKey(lot.title, lot.quantity),
    identified_item: "", brand: "", model: "",
    low: null, mid: null, high: null, currency: "USD",
    confidence: 0, confidence_reason: "", method: "none", demand: "unknown", days_to_sell: null,
    best_channel: "", condition_assumption: "", value_drivers: [], risks: [], rationale: "", comps: [],
    search_query: "", authenticity_risk: false, bulk_lot: false, unit_count: 1, sources_consulted: [],
    model_used: "", created_at: Date.now() / 1000, error: "",
  };
}

export function usable(v: Valuation | null | undefined): v is Valuation {
  return !!v && v.mid !== null && v.mid > 0 && v.method !== "none";
}
