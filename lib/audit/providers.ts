// DataForSEO providers for the Opportunity Audit.
//
// Defensive posture throughout: every wrapper returns null on any failure
// so live mode degrades per-module and never errors. All endpoints are
// DataForSEO — the audit runs single-supplier:
//
//   Labs ranked_keywords        — the domain's real ranking keywords + volumes
//   Labs competitors_domain     — who actually shares these SERPs
//   Labs domain_rank_overview   — portfolio size + estimated traffic value
//   Labs bulk_keyword_difficulty— difficulty for the audited set
//   SERP organic advanced       — feature mix + AI Overview presence/citation
//   AI keyword dataset          — AI-assistant search volumes (200M+ queries)
//     (ai_optimization/ai_keyword_data/keywords_search_volume)

export function dataforseoConfigured(): boolean {
  return Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
}

const TIMEOUT_MS = 12000;
const US = { location_code: 2840, language_code: "en" };

async function dfsPost<T>(path: string, task: Record<string, unknown>): Promise<T | null> {
  if (!dataforseoConfigured()) return null;
  try {
    const auth = Buffer.from(
      `${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`
    ).toString("base64");
    const res = await fetch(`https://api.dataforseo.com/v3/${path}`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify([task]),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data?.tasks?.[0]?.result?.[0] ?? null) as T | null;
  } catch {
    return null;
  }
}

export interface RankedKeyword {
  term: string;
  volume: number;
  cpc: number;
  position: number;
}

// The domain's actual ranking keywords, highest-volume first. This is the
// live overlay's ground truth for "what do you rank for today".
export async function dfsRankedKeywords(domain: string, limit = 60): Promise<RankedKeyword[] | null> {
  const r = await dfsPost<{
    items?: {
      keyword_data?: { keyword?: string; keyword_info?: { search_volume?: number; cpc?: number } };
      ranked_serp_element?: { serp_item?: { rank_group?: number; type?: string } };
    }[];
  }>("dataforseo_labs/google/ranked_keywords/live", {
    target: domain,
    ...US,
    limit,
    order_by: ["keyword_data.keyword_info.search_volume,desc"],
  });
  if (!r?.items) return null;
  const out: RankedKeyword[] = [];
  for (const i of r.items) {
    const term = i.keyword_data?.keyword;
    const pos = i.ranked_serp_element?.serp_item?.rank_group;
    if (!term || !pos || i.ranked_serp_element?.serp_item?.type !== "organic") continue;
    out.push({
      term,
      volume: i.keyword_data?.keyword_info?.search_volume ?? 0,
      cpc: i.keyword_data?.keyword_info?.cpc ?? 0,
      position: pos,
    });
  }
  return out.length ? out : null;
}

// AI-assistant search volumes from DataForSEO's AI keyword dataset — the
// GEO demand signal. One call covers up to 1,000 keywords.
export async function dfsAiKeywordVolumes(
  keywords: string[]
): Promise<Map<string, number> | null> {
  if (keywords.length === 0) return null;
  const r = await dfsPost<{
    items?: { keyword?: string; ai_search_volume?: number }[];
  }>("ai_optimization/ai_keyword_data/keywords_search_volume/live", {
    keywords: keywords.slice(0, 1000),
    ...US,
  });
  if (!r?.items) return null;
  const map = new Map<string, number>();
  for (const i of r.items) {
    if (i.keyword) map.set(i.keyword.toLowerCase(), i.ai_search_volume ?? 0);
  }
  return map.size ? map : null;
}

export interface SerpFeatureScan {
  features: string[]; // item types present on the SERP
  position: number | null; // brand's organic rank, null = not in top 100
  aiOverviewPresent: boolean;
  aiCited: boolean;
}

// One SERP read → the feature mix, the brand's position, and whether the
// AI Overview cites the brand. ~$0.002/keyword.
export async function dfsSerpFeatureScan(
  keyword: string,
  domain: string
): Promise<SerpFeatureScan | null> {
  const r = await dfsPost<{
    items?: { type?: string; domain?: string; url?: string; rank_group?: number }[];
  }>("serp/google/organic/live/advanced", {
    keyword,
    ...US,
    device: "desktop",
    depth: 30,
    load_async_ai_overview: true,
  });
  if (!r?.items) return null;
  const features = Array.from(
    new Set(
      r.items
        .map((i) => i.type)
        .filter((t): t is string => Boolean(t) && t !== "organic")
    )
  );
  const hit = r.items.find(
    (i) =>
      i.type === "organic" &&
      (i.domain?.replace(/^www\./, "").includes(domain) || i.url?.includes(domain))
  );
  const aio = r.items.find((i) => i.type === "ai_overview");
  const aiCited = aio ? JSON.stringify(aio).toLowerCase().includes(domain.toLowerCase()) : false;
  return {
    features,
    position: hit?.rank_group ?? null,
    aiOverviewPresent: Boolean(aio),
    aiCited,
  };
}

export interface DomainCompetitor {
  domain: string;
  sharedKeywords: number;
  organicKeywords: number;
  estTrafficValue: number; // DataForSEO ETV in USD/mo
  avgPosition: number;
}

// Who actually shares these SERPs — replaces the demo competitor set with
// the domains DataForSEO observes intersecting the brand's keywords.
export async function dfsCompetitorsDomain(domain: string): Promise<DomainCompetitor[] | null> {
  const r = await dfsPost<{
    items?: {
      domain?: string;
      avg_position?: number;
      intersections?: number;
      full_domain_metrics?: { organic?: { count?: number; etv?: number } };
    }[];
  }>("dataforseo_labs/google/competitors_domain/live", {
    target: domain,
    ...US,
    limit: 8,
    exclude_top_domains: true,
  });
  if (!r?.items) return null;
  const out = r.items
    .filter((i) => i.domain && i.domain !== domain)
    .map((i) => ({
      domain: i.domain as string,
      sharedKeywords: i.intersections ?? 0,
      organicKeywords: i.full_domain_metrics?.organic?.count ?? 0,
      estTrafficValue: Math.round(i.full_domain_metrics?.organic?.etv ?? 0),
      avgPosition: Math.round(i.avg_position ?? 0),
    }))
    .slice(0, 5);
  return out.length ? out : null;
}

export interface KeywordIdea {
  term: string;
  volume: number;
  cpc: number;
  difficulty: number | null;
}

// Category demand the domain may not rank for at all — seeded from its own
// top terms. This is where "unclaimed demand" clusters come from.
export async function dfsKeywordIdeas(seeds: string[], limit = 100): Promise<KeywordIdea[] | null> {
  if (seeds.length === 0) return null;
  const r = await dfsPost<{
    items?: {
      keyword?: string;
      keyword_info?: { search_volume?: number; cpc?: number };
      keyword_properties?: { keyword_difficulty?: number };
    }[];
  }>("dataforseo_labs/google/keyword_ideas/live", {
    keywords: seeds.slice(0, 5),
    ...US,
    limit,
    order_by: ["keyword_info.search_volume,desc"],
    filters: [["keyword_info.search_volume", ">", 40]],
  });
  if (!r?.items) return null;
  const out: KeywordIdea[] = [];
  for (const i of r.items) {
    if (!i.keyword) continue;
    out.push({
      term: i.keyword,
      volume: i.keyword_info?.search_volume ?? 0,
      cpc: i.keyword_info?.cpc ?? 0,
      difficulty: i.keyword_properties?.keyword_difficulty ?? null,
    });
  }
  return out.length ? out : null;
}

// Keyword difficulty for the audited set — one call, whole list.
export async function dfsBulkDifficulty(keywords: string[]): Promise<Map<string, number> | null> {
  if (keywords.length === 0) return null;
  const r = await dfsPost<{
    items?: { keyword?: string; keyword_difficulty?: number }[];
  }>("dataforseo_labs/google/bulk_keyword_difficulty/live", {
    keywords: keywords.slice(0, 1000),
    ...US,
  });
  if (!r?.items) return null;
  const map = new Map<string, number>();
  for (const i of r.items) {
    if (i.keyword && typeof i.keyword_difficulty === "number") {
      map.set(i.keyword.toLowerCase(), i.keyword_difficulty);
    }
  }
  return map.size ? map : null;
}

export interface DomainOverview {
  organicKeywords: number;
  estTrafficValue: number; // USD/mo
  estTraffic: number; // visits/mo
}

// Portfolio-level anchor: how many keywords the domain ranks for and what
// that traffic would cost — the headline "traffic value" in live mode.
export async function dfsDomainOverview(domain: string): Promise<DomainOverview | null> {
  const r = await dfsPost<{
    items?: { metrics?: { organic?: { count?: number; etv?: number; estimated_paid_traffic_cost?: number; } } }[];
  }>("dataforseo_labs/google/domain_rank_overview/live", {
    target: domain,
    ...US,
  });
  const organic = r?.items?.[0]?.metrics?.organic;
  if (!organic) return null;
  return {
    organicKeywords: organic.count ?? 0,
    estTrafficValue: Math.round(organic.estimated_paid_traffic_cost ?? organic.etv ?? 0),
    estTraffic: Math.round(organic.etv ?? 0),
  };
}
