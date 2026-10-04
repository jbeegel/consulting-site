// A person's own eBay sales, pulled with their consent. Standard eBay OAuth: they approve the app once
// in their browser, we keep the refresh token server-side, and the Sell Fulfillment API gives us their
// orders. Each line item is matched to a lot they won by title similarity; strong, unambiguous matches
// are applied, the rest are offered for a one-tap confirmation. Needs EBAY_CLIENT_ID, EBAY_CLIENT_SECRET
// and EBAY_RU_NAME (the redirect-URL name from the eBay developer portal).
import { createHmac, timingSafeEqual } from "node:crypto";
import { config, type Config } from "./config";
import { namesFor, similarity } from "./ledger";
import type { Store } from "./store";
import type { Position, User } from "./types";

const AUTH = "https://auth.ebay.com/oauth2/authorize";
const TOKEN = "https://api.ebay.com/identity/v1/oauth2/token";
const ORDERS = "https://api.ebay.com/sell/fulfillment/v1/order";
const SCOPE = "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly";
const AUTO_APPLY = 0.5;
const CANDIDATE = 0.25;

export function ebayConfigured(c: Config = config): boolean {
  return !!(c.ebayClientId && c.ebayClientSecret && c.ebayRuName);
}

function secret(c: Config): string {
  return c.cronSecret || c.password || "spread-hunter";
}

/** `state` carries who is linking, signed so the callback cannot be pointed at someone else's account. */
export function signState(userId: string, c: Config = config): string {
  const ts = Math.floor(Date.now() / 1000);
  const payload = `${userId}.${ts}`;
  const sig = createHmac("sha256", secret(c)).update(payload).digest("base64url");
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}
export function verifyState(state: string, c: Config = config): string | null {
  try {
    const [userId, ts, sig] = Buffer.from(state, "base64url").toString().split(".");
    if (!userId || !ts || !sig) return null;
    const expect = createHmac("sha256", secret(c)).update(`${userId}.${ts}`).digest("base64url");
    const a = Buffer.from(sig), b = Buffer.from(expect);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    if (Date.now() / 1000 - Number(ts) > 3600) return null;
    return userId;
  } catch {
    return null;
  }
}

export function consentUrl(userId: string, c: Config = config): string {
  const q = new URLSearchParams({ client_id: c.ebayClientId!, redirect_uri: c.ebayRuName!, response_type: "code", scope: SCOPE, state: signState(userId, c) });
  return `${AUTH}?${q}`;
}

async function tokenRequest(body: URLSearchParams, c: Config): Promise<{ access_token: string; expires_in: number; refresh_token?: string; refresh_token_expires_in?: number }> {
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: "Basic " + Buffer.from(`${c.ebayClientId}:${c.ebayClientSecret}`).toString("base64") },
    body, signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`eBay token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string; refresh_token_expires_in?: number };
}

export async function exchangeCode(code: string, c: Config = config): Promise<User["ebay"]> {
  const j = await tokenRequest(new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: c.ebayRuName! }), c);
  if (!j.refresh_token) throw new Error("eBay returned no refresh token");
  return { refresh_token: j.refresh_token, expires_at: Date.now() / 1000 + (j.refresh_token_expires_in ?? 47304000), linked_at: Date.now() / 1000 };
}

async function accessToken(refresh: string, c: Config): Promise<string> {
  const j = await tokenRequest(new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh, scope: SCOPE }), c);
  return j.access_token;
}

export interface SoldItem { order_id: string; title: string; price: number; sold_at: number; quantity: number }

export async function fetchSales(refresh: string, sinceSeconds: number, c: Config = config): Promise<SoldItem[]> {
  const token = await accessToken(refresh, c);
  const out: SoldItem[] = [];
  let offset = 0;
  for (let page = 0; page < 10; page++) {
    const q = new URLSearchParams({ filter: `creationdate:[${new Date(sinceSeconds * 1000).toISOString()}..]`, limit: "200", offset: String(offset) });
    const res = await fetch(`${ORDERS}?${q}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`eBay orders ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { orders?: { orderId: string; creationDate: string; orderPaymentStatus?: string; lineItems?: { title: string; quantity: number; lineItemCost?: { value: string } }[] }[]; total?: number };
    for (const o of j.orders ?? []) {
      if (o.orderPaymentStatus && o.orderPaymentStatus !== "PAID") continue; // unpaid or refunded is not a sale
      for (const li of o.lineItems ?? []) {
        out.push({ order_id: o.orderId, title: li.title, price: Number(li.lineItemCost?.value ?? 0), sold_at: Date.parse(o.creationDate) / 1000, quantity: li.quantity ?? 1 });
      }
    }
    offset += 200;
    if (!j.orders?.length || (j.total !== undefined && offset >= j.total)) break;
  }
  return out;
}

/**
 * Pair a person's eBay sales with the lots they won. One pass, best match wins: a sale is applied to
 * a position when it is clearly that lot and nothing else comes close; otherwise it is parked on the
 * closest positions as a candidate for them to confirm.
 */
export async function syncUser(store: Store, user: User, c: Config = config): Promise<{ sales: number; applied: number; candidates: number }> {
  if (!user.ebay) throw new Error("eBay not linked");
  const open = (await store.positions({ userId: user.id, status: ["won", "likely_won", "listed", "kept"] }))
    .filter((p) => p.won_at !== null);
  const since = open.length ? Math.min(...open.map((p) => p.won_at as number)) : Date.now() / 1000 - 90 * 86400;
  const sales = await fetchSales(user.ebay.refresh_token, Math.max(since, Date.now() / 1000 - 180 * 86400), c);
  const vals = await store.valuationsFor(open.map((p) => p.lot_id));
  const names = new Map(open.map((p) => [p.lot_id, namesFor(p, vals.get(p.lot_id) ?? null)]));
  const taken = new Set<number>();
  let applied = 0, candidates = 0;
  for (const s of sales) {
    const scored = open
      .filter((p) => !taken.has(p.lot_id) && (p.won_at as number) <= s.sold_at + 3600)
      .map((p) => ({ p, score: Math.max(...(names.get(p.lot_id) ?? [p.title]).map((n) => similarity(n, s.title))) }))
      .filter((x) => x.score >= CANDIDATE)
      .sort((a, b) => b.score - a.score);
    if (!scored.length) continue;
    const [best, second] = scored;
    if (best.score >= AUTO_APPLY && (!second || second.score < best.score * 0.6) && best.p.status !== "sold") {
      const p: Position = { ...best.p, status: "sold", sale_price: s.price, sale_at: s.sold_at, sale_channel: "eBay", sale_source: "ebay", ebay_candidates: [], updated_at: Date.now() / 1000 };
      await store.savePosition(p);
      await store.logEvent({ user_id: user.id, lot_id: p.lot_id, kind: "ebay_match", amount: s.price, at: Date.now() / 1000, note: `${s.order_id}: ${s.title}` });
      taken.add(p.lot_id);
      applied++;
    } else {
      for (const x of scored.slice(0, 3)) {
        const list = x.p.ebay_candidates.filter((cnd) => cnd.order_id !== s.order_id);
        list.push({ order_id: s.order_id, title: s.title, price: s.price, sold_at: s.sold_at, score: Math.round(x.score * 100) / 100 });
        x.p.ebay_candidates = list.sort((a, b) => b.score - a.score).slice(0, 5);
        x.p.updated_at = Date.now() / 1000;
        await store.savePosition(x.p);
        candidates++;
      }
    }
  }
  return { sales: sales.length, applied, candidates };
}
