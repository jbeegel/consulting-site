// The ledger: what each person did with each lot, and what it came to.
//
// Three sources feed it, in order of how much they can be trusted: HiBid's own hammer price on every
// closed lot (nobody types it), eBay's order history once a person has linked their seller account,
// and what the person tells us. The statement is built so that silence never pays: a win with no sale
// reported for `settleDays` settles at the quick-sale net the tool expected when they won it.
import { config, type Config } from "./config";
import { landedCost, listingEconomics, scoreLot } from "./scoring";
import { scoreOptionsFor } from "./scanner";
import type { Store } from "./store";
import type { EventKind, Lot, Outcome, Position, PositionStatus, Statement, StatementLine, User, Valuation } from "./types";

const now = () => Date.now() / 1000;

export function emptyPosition(user: User, lot: Lot, t = now()): Position {
  return {
    user_id: user.id, lot_id: lot.id, title: lot.title, category: lot.category || "Uncategorized",
    auction_name: lot.auction_name ?? null, lot_url: lot.url, status: "watching",
    bid_intent: null, closed_at: lot.ends_at ?? null, hammer: null,
    won_price: null, landed_cost: null, won_at: null, estimated_net: null,
    listed_at: null, list_price: null, sale_price: null, sale_at: null, sale_channel: "", sale_source: "",
    ebay_candidates: [], notes: "", created_at: t, updated_at: t,
  };
}

/** What a quick sale of this lot was expected to net, as of now. The default settlement value. */
export function quickNetFor(lot: Lot, val: Valuation | null, c: Config = config): number | null {
  if (!val) return null;
  const sc = scoreLot(lot, val, c, now(), scoreOptionsFor(lot, null, {}, c));
  const quick = listingEconomics(lot, val, sc, c)?.points.find((p) => p.label === "quick");
  return quick && quick.net > 0 ? Math.round(quick.net * 100) / 100 : null;
}

function markWon(p: Position, lot: Lot, val: Valuation | null, price: number, status: PositionStatus, c: Config, t: number): void {
  p.status = status;
  p.won_price = price;
  p.landed_cost = Math.round(landedCost(price, lot, c) * 100) / 100;
  p.won_at = p.won_at ?? t;
  p.estimated_net = p.estimated_net ?? quickNetFor(lot, val, c);
}

/**
 * Apply one event to a person's position on a lot and return the new state. The event itself is
 * logged by the caller; this is the state machine.
 */
export async function applyEvent(store: Store, user: User, lot: Lot, kind: EventKind, amount: number | null, note: string, c: Config = config): Promise<Position> {
  const t = now();
  const p = (await store.getPosition(user.id, lot.id)) ?? emptyPosition(user, lot, t);
  const val = kind === "won" || kind === "kept" ? await store.getValuation(lot.id) : null;
  switch (kind) {
    case "view":
      break; // attention only; the row exists now, which is the point
    case "bid_intent":
      if (amount !== null && amount > 0) p.bid_intent = amount;
      if (p.status === "watching" || p.status === "lost") p.status = "bidding";
      break;
    case "won": {
      const price = amount ?? p.hammer ?? p.bid_intent ?? lot.high_bid ?? 0;
      markWon(p, lot, val, price, "won", c, t);
      break;
    }
    case "lost":
    case "skip":
      if (!["won", "listed", "sold", "kept"].includes(p.status)) p.status = "lost";
      break;
    case "listed":
      p.listed_at = p.listed_at ?? t;
      if (amount !== null && amount > 0) p.list_price = amount;
      if (p.status === "won" || p.status === "likely_won") p.status = "listed";
      break;
    case "sale":
      if (amount !== null && amount >= 0) p.sale_price = amount;
      p.sale_at = p.sale_at ?? t;
      p.sale_channel = p.sale_channel || note || "";
      p.sale_source = p.sale_source || "manual";
      if (p.won_price === null) markWon(p, lot, val, p.hammer ?? p.bid_intent ?? lot.high_bid ?? 0, "sold", c, t);
      p.status = "sold";
      break;
    case "kept":
      if (p.won_price === null) markWon(p, lot, val, p.hammer ?? p.bid_intent ?? lot.high_bid ?? 0, "kept", c, t);
      p.status = "kept";
      break;
    default:
      break;
  }
  if (note && kind !== "sale") p.notes = p.notes ? p.notes + "\n" + note : note;
  p.updated_at = t;
  await store.savePosition(p);
  if (kind === "sale" || kind === "listed") await recordOutcome(store, lot, p, c).catch((e) => console.warn("outcome from position failed", e));
  return p;
}

/** A person's sale is ground truth for the calibration loop too, so it lands in spread_outcomes. */
async function recordOutcome(store: Store, lot: Lot, p: Position, c: Config): Promise<void> {
  const existing = await store.getOutcome(lot.id);
  let base: Outcome;
  if (existing) base = existing;
  else {
    const val = await store.getValuation(lot.id);
    const sc = scoreLot(lot, val, c, now(), scoreOptionsFor(lot, null, {}, c));
    base = {
      lot_id: lot.id, title: lot.title, category: lot.category || "Uncategorized", closed_at: lot.ends_at ?? now(),
      predicted_low: val?.low ?? null, predicted_mid: val?.mid ?? null, predicted_high: val?.high ?? null,
      predicted_net: sc.net_resale, confidence: val?.confidence ?? 0, method: val?.method ?? "none", score: sc.score,
      hammer: p.won_price, landed_at_hammer: p.landed_cost,
      bought: null, bought_price: null, sale_price: null, sale_at: null, sale_channel: "", notes: "",
      listed_at: null, list_price: null, still_listed: null, views: null, watchers: null,
      predicted_days: sc.liquidity?.days_p50 ?? null, recorded_at: now(),
    };
  }
  await store.saveOutcome({
    ...base, bought: true, bought_price: p.won_price ?? base.bought_price,
    sale_price: p.sale_price ?? base.sale_price, sale_at: p.sale_at ?? base.sale_at, sale_channel: p.sale_channel || base.sale_channel,
    listed_at: p.listed_at ?? base.listed_at, list_price: p.list_price ?? base.list_price,
    still_listed: p.sale_at ? false : p.listed_at ? true : base.still_listed, recorded_at: now(),
  });
}

/**
 * After lots close: compare what each person said they would bid with what the lot actually went for.
 * A bid at or above the hammer is a likely win (HiBid does not tell us who won); a bid below it is a
 * loss, and that needs no confirmation. `hammerFor` fetches a hammer we have not stored yet.
 */
export async function settlePositions(store: Store, hammerFor: (lotId: number) => Promise<number | null>, c: Config = config, limit = 100): Promise<{ likely_won: number; lost: number }> {
  const open = await store.positions({ status: ["watching", "bidding"], limit: 2000 });
  const t = now();
  const out = { likely_won: 0, lost: 0 };
  let looked = 0;
  for (const p of open) {
    const lot = await store.getLot(p.lot_id);
    const closed = (p.closed_at !== null && p.closed_at < t - 120) || (lot?.is_closed ?? false);
    if (!closed) continue;
    let hammer = p.hammer ?? (await store.getOutcome(p.lot_id))?.hammer ?? null;
    if (hammer === null && looked < limit) {
      looked++;
      hammer = await hammerFor(p.lot_id).catch(() => null);
    }
    if (hammer === null) continue;
    p.hammer = hammer;
    if (p.status === "bidding" && p.bid_intent !== null && hammer <= p.bid_intent) {
      const val = lot ? await store.getValuation(p.lot_id) : null;
      if (lot) markWon(p, lot, val, hammer, "likely_won", c, t);
      else { p.status = "likely_won"; p.won_price = hammer; p.won_at = p.won_at ?? t; }
      out.likely_won++;
    } else {
      p.status = "lost";
      out.lost++;
    }
    p.updated_at = t;
    await store.savePosition(p);
  }
  return out;
}

// ----------------------------------------------------------------------------- statements
export function settledValue(p: Position, c: Config = config, t = now()): { value: number | null; basis: StatementLine["settled_basis"] } {
  if (p.status === "lost" || p.status === "watching" || p.status === "bidding") return { value: null, basis: "loss" };
  if (p.status === "sold") return { value: p.sale_price, basis: "sale" };
  if (p.status === "kept") return { value: p.estimated_net, basis: p.estimated_net === null ? "open" : "estimate" };
  const overdue = p.won_at !== null && t - p.won_at > c.settleDays * 86400;
  if (overdue && p.estimated_net !== null) return { value: p.estimated_net, basis: "estimate" };
  return { value: null, basis: "open" };
}

export function monthOf(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 7);
}

export function buildStatement(user: User, positions: Position[], month: string, c: Config = config, t = now()): Statement {
  const mine = positions.filter((p) => p.user_id === user.id && p.won_at !== null && (month === "all" || monthOf(p.won_at) === month));
  const lines: StatementLine[] = mine.map((p) => {
    const s = settledValue(p, c, t);
    const profit = s.value !== null && p.landed_cost !== null ? Math.round((s.value - p.landed_cost) * 100) / 100 : null;
    return {
      lot_id: p.lot_id, title: p.title, lot_url: p.lot_url, status: p.status, won_at: p.won_at, landed_cost: p.landed_cost,
      sale_at: p.sale_at, sale_price: p.sale_price, settled_value: s.value, settled_basis: s.basis, profit,
      days_held: p.won_at === null ? null : Math.round(((p.sale_at ?? t) - p.won_at) / 86400),
    };
  }).sort((a, b) => (b.won_at ?? 0) - (a.won_at ?? 0));
  const wins = lines.filter((l) => l.settled_basis !== "loss");
  const landed = wins.reduce((a, l) => a + (l.landed_cost ?? 0), 0);
  const sold = wins.filter((l) => l.settled_basis === "sale").reduce((a, l) => a + (l.settled_value ?? 0), 0);
  const estimated = wins.filter((l) => l.settled_basis === "estimate").reduce((a, l) => a + (l.settled_value ?? 0), 0);
  const open = wins.filter((l) => l.settled_basis === "open").reduce((a, l) => a + (l.landed_cost ?? 0), 0);
  const settled = wins.filter((l) => l.profit !== null);
  const profit = settled.reduce((a, l) => a + (l.profit ?? 0), 0);
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    user_id: user.id, user_name: user.name, month, share_pct: user.share_pct, lines,
    totals: {
      wins: wins.length, landed: r(landed), sold: r(sold), estimated: r(estimated), open: r(open),
      revenue: r(sold + estimated), profit: r(profit), owner_share: r(Math.max(0, profit) * user.share_pct),
    },
    unresolved: lines.filter((l) => l.settled_basis === "open"),
  };
}

export function statementCsv(s: Statement): string {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const d = (n: number | null) => (n === null ? "" : new Date(n * 1000).toISOString().slice(0, 10));
  const rows = [["lot_id", "title", "status", "won", "landed_cost", "sold", "sale_price", "settled_value", "basis", "profit", "days_held", "url"].join(",")];
  for (const l of s.lines) rows.push([l.lot_id, esc(l.title), l.status, d(l.won_at), l.landed_cost ?? "", d(l.sale_at), l.sale_price ?? "", l.settled_value ?? "", l.settled_basis, l.profit ?? "", l.days_held ?? "", esc(l.lot_url)].join(","));
  rows.push("");
  rows.push(["totals", "", "", "", s.totals.landed, "", "", s.totals.revenue, "", s.totals.profit, "", ""].join(","));
  rows.push(["owner share", `${Math.round(s.share_pct * 100)}%`, "", "", "", "", "", "", "", s.totals.owner_share, "", ""].join(","));
  return rows.join("\n");
}

// ----------------------------------------------------------------------------- matching sales to lots
const STOP = new Set(["the", "and", "with", "for", "lot", "of", "a", "an", "in", "to", "vintage", "antique", "old", "rare", "nice", "set"]);
export function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
}
/** Jaccard similarity of word sets, 0-1. Good enough to pair "Hamilton 992B railroad watch" with its listing. */
export function similarity(a: string, b: string): number {
  const x = tokens(a), y = tokens(b);
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const w of x) if (y.has(w)) inter++;
  return inter / (x.size + y.size - inter);
}
/** Every name a lot goes by, so a sale titled from the appraiser's listing plan still matches. */
export function namesFor(p: Position, val: Valuation | null): string[] {
  const out = [p.title];
  if (val) {
    if (val.listing?.title) out.push(val.listing.title);
    if (val.identified_item) out.push(val.identified_item);
    if (val.standout_item) out.push(val.standout_item);
    for (const it of val.items ?? []) if (it.name) out.push(it.name);
  }
  return out;
}

// ----------------------------------------------------------------------------- nudges
/** Remind a person about wins with nothing reported, by email when we can, at most once a week. */
export async function nudge(store: Store, user: User, c: Config = config): Promise<boolean> {
  if (!user.email || !c.resendKey) return false;
  const t = now();
  if (user.last_nudged_at && t - user.last_nudged_at < 6 * 86400) return false;
  const stmt = buildStatement(user, await store.positions({ userId: user.id }), "all", c, t);
  const due = stmt.unresolved.filter((l) => l.won_at !== null && t - l.won_at > 14 * 86400);
  if (!due.length) return false;
  const money = (n: number | null) => (n === null ? "—" : "$" + Math.round(n).toLocaleString("en-US"));
  const body = [
    `${due.length} lot${due.length > 1 ? "s" : ""} you won still have no sale recorded. After ${c.settleDays} days each settles at the tool's quick-sale estimate, so a real number is always better:`,
    "",
    ...due.map((l) => `- ${l.title} — won ${new Date((l.won_at ?? 0) * 1000).toISOString().slice(0, 10)} for ${money(l.landed_cost)} all-in (${l.days_held} days ago). ${l.lot_url}`),
    "",
    "Record it on your book page: sold, kept, or still listed.",
  ].join("\n");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${c.resendKey}` },
    body: JSON.stringify({ from: c.alertFrom, to: [user.email], subject: `Spread Hunter: ${due.length} win${due.length > 1 ? "s" : ""} to settle`, text: body }),
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);
  if (!res || !res.ok) return false;
  await store.logEvent({ user_id: user.id, lot_id: 0, kind: "nudge", amount: due.length, at: t, note: "" });
  await store.saveUser({ ...user, last_nudged_at: t });
  return true;
}
