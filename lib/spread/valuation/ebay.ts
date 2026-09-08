// eBay comps. Two paths:
//  1. Sold/completed listings page (no key; server-rendered HTML). eBay blocks datacenter IPs often,
//     so on Vercel this is best-effort and returns [] on any trouble.
//  2. Browse API (official, free key: EBAY_CLIENT_ID + EBAY_CLIENT_SECRET). Returns ACTIVE listings
//     (asking prices, not sold) — weaker evidence, labelled as such, but reliable from a server.
import type { Comp } from "../types";
import { stripPrefix } from "./base";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const ITEM = /<li class="s-item[^"]*"[^>]*>([\s\S]*?)<\/li>/g;
const TITLE = /<(?:div|span|h3) class="s-item__title[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span|h3)>/;
const PRICE = /<span class="s-item__price"[^>]*>([\s\S]*?)<\/span>/;
const LINK = /<a class="s-item__link"[^>]*href="([^"]+)"/;
const DATE = /(?:Sold|Ended)\s+([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/;
const TAG = /<[^>]+>/g;
const MONEY = /[\d,]+(?:\.\d{2})?/;

function unescape(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}

export function soldSearchUrl(query: string): string {
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=60`;
}

export function cleanQuery(title: string, maxWords = 8): string {
  const junk = new Set(["lot", "of", "the", "and", "with", "new", "nib", "nwt", "untested", "as", "is", "read"]);
  const t = stripPrefix(title).replace(/\(.*?\)|\[.*?\]/g, " ").replace(/[^A-Za-z0-9\-.\s]/g, " ");
  return t.split(/\s+/).filter((w) => w.length > 1 && !junk.has(w.toLowerCase())).slice(0, maxWords).join(" ");
}

export async function fetchSoldComps(query: string, limit = 30): Promise<Comp[]> {
  if (!query.trim()) return [];
  const url = soldSearchUrl(query);
  let body: string;
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(15000), cache: "no-store" });
    if (!res.ok) return [];
    body = await res.text();
    if (!body.includes("s-item")) return [];
  } catch {
    return [];
  }
  const comps: Comp[] = [];
  for (const m of body.matchAll(ITEM)) {
    const block = m[1];
    const t = TITLE.exec(block), p = PRICE.exec(block);
    if (!t || !p) continue;
    const title = unescape(t[1].replace(TAG, "")).trim();
    if (title.toLowerCase().startsWith("shop on ebay")) continue;
    const money = MONEY.exec(unescape(p[1].replace(TAG, "")));
    if (!money) continue;
    const link = LINK.exec(block);
    const d = DATE.exec(unescape(block.replace(TAG, " ")));
    comps.push({ title, price: Number(money[0].replace(/,/g, "")), source: "ebay_sold", url: link ? link[1].split("?")[0] : url, date: d ? d[1] : "", note: "" });
    if (comps.length >= limit) break;
  }
  return comps;
}

let browseToken: { token: string; exp: number } | null = null;

async function getBrowseToken(id: string, secret: string): Promise<string | null> {
  if (browseToken && browseToken.exp > Date.now() + 60_000) return browseToken.token;
  try {
    const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64") },
      body: "grant_type=client_credentials&scope=" + encodeURIComponent("https://api.ebay.com/oauth/api_scope"),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { access_token: string; expires_in: number };
    browseToken = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
    return j.access_token;
  } catch {
    return null;
  }
}

/** Active listings via the official Browse API — asking prices, flagged as such. */
export async function fetchActiveComps(query: string, clientId: string, clientSecret: string, limit = 20): Promise<Comp[]> {
  if (!query.trim()) return [];
  const token = await getBrowseToken(clientId, clientSecret);
  if (!token) return [];
  try {
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&limit=${limit}&filter=${encodeURIComponent("buyingOptions:{FIXED_PRICE|AUCTION},conditions:{USED|NEW}")}`;
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" }, signal: AbortSignal.timeout(10000), cache: "no-store" });
    if (!res.ok) return [];
    const j = (await res.json()) as { itemSummaries?: { title: string; price?: { value: string }; itemWebUrl: string; condition?: string }[] };
    return (j.itemSummaries ?? [])
      .filter((i) => i.price?.value)
      .map((i) => ({ title: i.title, price: Number(i.price!.value), source: "ebay_active", url: i.itemWebUrl, date: "", note: `asking price${i.condition ? ", " + i.condition : ""}` }));
  } catch {
    return [];
  }
}

export function summarize(comps: Comp[]): { n: number; p25?: number; median?: number; p75?: number } {
  const prices = comps.map((c) => c.price).filter((p) => p > 0).sort((a, b) => a - b);
  if (!prices.length) return { n: 0 };
  const q = (f: number) => prices[Math.min(prices.length - 1, Math.floor(f * (prices.length - 1)))];
  return { n: prices.length, p25: q(0.25), median: q(0.5), p75: q(0.75) };
}
