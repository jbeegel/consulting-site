// Firecrawl wrappers — the observation layer of the Journey Map.
//
// Two endpoints, used defensively like every other provider in this
// codebase: /v1/map to discover the site's URLs, /v1/scrape to read the
// pages that matter as LLM-ready markdown. Every call returns null on
// failure; the journey pipeline decides what's fatal.

import type { CrawledPage } from "./journey-types";

const FC_BASE = "https://api.firecrawl.dev/v1";
const MAX_PAGES = 28; // scrape budget per journey — cost & latency ceiling
const SCRAPE_CONCURRENCY = 5;
const SNIPPET_CHARS = 700;

export function firecrawlConfigured(): boolean {
  return Boolean(process.env.FIRECRAWL_API_KEY);
}

async function fcPost<T>(path: string, body: unknown, timeoutMs: number): Promise<T | null> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${FC_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface MapResponse {
  success: boolean;
  links?: string[];
}

interface ScrapeResponse {
  success: boolean;
  data?: {
    markdown?: string;
    metadata?: {
      title?: string;
      description?: string;
      sourceURL?: string;
      statusCode?: number;
    };
  };
}

// Discover the site's URLs. Returns absolute URLs or null if the site
// can't be mapped at all.
export async function fcMapSite(domain: string): Promise<string[] | null> {
  const res = await fcPost<MapResponse>("/map", { url: `https://${domain}`, limit: 200 }, 30_000);
  if (!res?.success || !Array.isArray(res.links) || res.links.length === 0) return null;
  return res.links;
}

const SKIP_EXT = /\.(jpg|jpeg|png|gif|webp|svg|ico|css|js|pdf|zip|xml|txt|mp4|webm|woff2?)($|\?)/i;
const SKIP_PATH =
  /(\/wp-json\/|\/cdn-cgi\/|\/cart|\/checkout|\/account|\/login|\/signup|\/search|\/tag\/|\/feed|\/page\/\d+|\/\d{4}\/\d{2}\/$)/i;

// Pick the pages worth reading: same host, no assets/utility pages, shallow
// paths first (they carry the site's structure), homepage always included.
export function selectPages(domain: string, links: string[]): string[] {
  const seen = new Set<string>();
  const candidates: { url: string; depth: number; score: number }[] = [];
  for (const raw of links) {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    if (!u.hostname.endsWith(domain.replace(/^www\./, ""))) continue;
    u.hash = "";
    u.search = "";
    const clean = u.toString().replace(/\/$/, "");
    if (seen.has(clean)) continue;
    seen.add(clean);
    const path = u.pathname;
    if (SKIP_EXT.test(path) || SKIP_PATH.test(path)) continue;
    const depth = path.split("/").filter(Boolean).length;
    // Structural pages first; money pages get a boost so deep PDPs still make
    // the cut on large stores.
    const boost = /(product|collection|shop|category|service|about|faq|blog|guide|learn|how|gift|corporate|wholesale|event)/i.test(
      path
    )
      ? -1
      : 0;
    candidates.push({ url: clean, depth, score: depth + boost });
  }
  candidates.sort((a, b) => a.score - b.score || a.url.length - b.url.length);
  const home = `https://${domain}`;
  const picked = [home, ...candidates.map((c) => c.url).filter((u) => u !== home && u !== `${home}/`)];
  return [...new Set(picked)].slice(0, MAX_PAGES);
}

function headingsOf(markdown: string): string[] {
  return markdown
    .split("\n")
    .filter((l) => /^#{1,3}\s/.test(l))
    .map((l) => l.replace(/^#+\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

function snippetOf(markdown: string): string {
  const body = markdown
    .split("\n")
    .filter((l) => !/^#{1,6}\s/.test(l) && !/^\s*[!\[]/.test(l))
    .join(" ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return body.slice(0, SNIPPET_CHARS);
}

async function scrapeOne(url: string): Promise<CrawledPage | null> {
  const res = await fcPost<ScrapeResponse>(
    "/scrape",
    { url, formats: ["markdown"], onlyMainContent: true, timeout: 25_000 },
    35_000
  );
  const md = res?.data?.markdown;
  if (!res?.success || !md) return null;
  const meta = res.data?.metadata ?? {};
  if (typeof meta.statusCode === "number" && meta.statusCode >= 400) return null;
  const u = new URL(url);
  return {
    url,
    path: u.pathname === "" ? "/" : u.pathname,
    title: (meta.title ?? "").slice(0, 200),
    description: (meta.description ?? "").slice(0, 300),
    headings: headingsOf(md),
    wordCount: md.split(/\s+/).filter(Boolean).length,
    snippet: snippetOf(md),
  };
}

// Map + scrape in one call. onProgress fires as pages land so the job's
// phase line stays honest. Returns null only if the site is unreachable.
export async function crawlSite(
  domain: string,
  onProgress?: (done: number, total: number) => void | Promise<void>
): Promise<CrawledPage[] | null> {
  const links = await fcMapSite(domain);
  // A site /map can't see (blocked, tiny, brand-new) still has a homepage.
  const targets = links ? selectPages(domain, links) : [`https://${domain}`];
  const pages: CrawledPage[] = [];
  let done = 0;
  for (let i = 0; i < targets.length; i += SCRAPE_CONCURRENCY) {
    const batch = targets.slice(i, i + SCRAPE_CONCURRENCY);
    const results = await Promise.all(batch.map(scrapeOne));
    for (const p of results) if (p) pages.push(p);
    done += batch.length;
    await onProgress?.(Math.min(done, targets.length), targets.length);
  }
  return pages.length > 0 ? pages : null;
}
