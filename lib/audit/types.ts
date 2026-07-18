// The Opportunity Audit contract.
//
// The audit answers the question a prospect actually buys on: "where is
// the money we're not capturing, in classic search AND in AI answers,
// and what would it be worth to go get it?"
//
// Demo mode synthesizes it deterministically from the market profile;
// live mode fulfills it from DataForSEO (ranked keywords, SERP features,
// competitor domains, and the AI keyword dataset's AI search volumes).

export interface TrendPoint {
  label: string; // e.g. "M-11" .. "Now"
  value: number;
}

export type Intent = "transactional" | "commercial" | "informational" | "local";
export type ClusterStage = "capture" | "grow" | "defend";

export interface AuditKeyword {
  term: string;
  intent: Intent;
  volume: number; // monthly Google searches
  aiVolume: number; // monthly AI-assistant searches (DataForSEO AI keyword dataset)
  cpc: number; // USD — what this click costs in ads
  difficulty: number; // 0-100 keyword difficulty
  position: number | null; // current organic rank; null = not in top 100
  serpFeatures: string[]; // e.g. ["ai_overview", "shopping", "people_also_ask"]
  aiOverviewPresent: boolean;
  aiCited: boolean; // brand cited when AI answers this query
}

// A cluster is the unit of opportunity: a group of buying intents that one
// content/PDP/landing play can win, with the revenue math attached.
export interface OpportunityCluster {
  id: string;
  name: string; // e.g. "Event & wedding bulk orders"
  stage: ClusterStage; // capture = not ranking, grow = striking distance, defend = ranking but threatened
  keywords: AuditKeyword[];
  totalVolume: number;
  totalAiVolume: number;
  avgDifficulty: number;
  bestPosition: number | null;
  targetPosition: number;
  currentTraffic: number; // est. monthly organic visits today (CTR model)
  potentialTraffic: number; // est. monthly visits at target positions
  monthlyRevenue: { conservative: number; base: number; aggressive: number }; // incremental $/mo
  competitorOwning: string | null; // who holds the SERP today
  why: string; // analyst note: why this cluster, why now
  play: string; // the concrete move
}

// Striking-distance keywords: positions 4-15, where one push changes the CTR class.
export interface QuickWin {
  term: string;
  position: number;
  volume: number;
  aiVolume: number;
  targetPosition: number;
  monthlyUpside: number; // incremental $/mo at target
  note: string;
}

export interface SerpFeatureStat {
  feature: string; // machine key
  label: string; // display label
  presence: number; // % of audited keywords showing this feature
  owned: number; // % of those where the brand owns/appears in it
  note: string;
}

export interface GeoReadinessCheck {
  check: string;
  status: "pass" | "partial" | "fail";
  detail: string;
  fix: string;
}

export interface CompetitorGapRow {
  name: string;
  domain: string;
  sharedKeywords: number; // keywords you both rank for
  theirExclusive: number; // keywords they rank for and you don't
  estTrafficValue: number; // $/mo their organic traffic would cost in ads
  aiCitationRate: number;
  threat: string; // one-line read
}

export interface RoadmapPhase {
  phase: string; // "Days 0-30"
  focus: string;
  moves: string[];
  kpi: string;
  expectedLift: string;
}

export interface AuditEconomics {
  aov: number; // assumed average order value, surfaced honestly
  conversionRate: number; // assumed site conversion, e.g. 0.022
  trafficValueNow: number; // $/mo the current organic traffic would cost as ads
  currentMonthlyTraffic: number; // modeled organic visits/mo across audited set
  potentialMonthlyTraffic: number; // at target positions
  opportunity: { conservative: number; base: number; aggressive: number }; // incremental $/mo at steady state
  assumptionsNote: string;
}

export interface GeoOpportunity {
  totalAiVolume: number; // monthly AI-assistant searches across audited set
  aiVolumeShare: number; // AI volume as % of (google + AI) demand
  aiVolumeTrend: TrendPoint[]; // 12-point growth curve
  citationRate: number; // % of tracked buying prompts where brand is cited (from CubeProfile)
  surfaces: { name: string; citationRate: number; promptsTracked: number }[];
  missedPrompts: { prompt: string; surface: string; citedInstead: string[] }[];
  readiness: GeoReadinessCheck[];
  verdict: string;
}

// How this brand makes money — detected from the vertical, and used to
// adjust the citation-side strategy. A gifting e-commerce brand wins AI
// answers differently than a SaaS or a multi-location restaurant.
export interface BusinessModelRead {
  model: string; // "Gifting & events e-commerce"
  revenueMotion: string; // how the money actually moves
  citationStrategy: string; // how to play the AI-citation side FOR THIS MODEL
  keySurfaces: string[]; // the 2-3 surfaces that matter most for this model
}

// The unified "where's the money" list — SEO and citation opportunities in
// one ranking, comparable in $/mo. This is the first thing a prospect reads.
export interface TopOpportunity {
  title: string;
  kind: "seo" | "geo" | "both";
  monthly: number; // incremental $/mo, base case
  detail: string;
  action: string;
}

// Strategist observations from the analyst pass (live audits with an
// Anthropic key only) — the non-obvious reads a senior consultant would
// circle in the real data. Absent in demo mode or without the key.
export interface AnalystObservation {
  title: string;
  detail: string;
  kind: "seo" | "geo" | "competitive" | "technical";
}

export interface OpportunityAudit {
  brand: {
    domain: string;
    name: string;
    category: string;
    descriptor: string;
  };
  businessModel: BusinessModelRead;
  topOpportunities: TopOpportunity[];
  observations?: AnalystObservation[];
  score: {
    overall: number; // 0-100 opportunity-capture score (low = money on the table)
    seo: number;
    geo: number;
    grade: string; // "B-", "D+" ...
    verdict: string; // the one-paragraph read a founder repeats to their cofounder
  };
  headline: {
    keywordsAudited: number;
    clustersFound: number;
    totalVolume: number; // Google searches/mo across audited set
    totalAiVolume: number; // AI-assistant searches/mo across audited set
    topCompetitor: string;
  };
  economics: AuditEconomics;
  clusters: OpportunityCluster[]; // sorted by base revenue desc
  quickWins: QuickWin[];
  serpRealEstate: SerpFeatureStat[];
  geo: GeoOpportunity;
  competitorGaps: CompetitorGapRow[];
  roadmap: RoadmapPhase[];
  meta: {
    mode: "demo" | "live";
    sources: string[];
    methodology: string[]; // every modeled number's assumption, stated plainly
    generatedAt: string; // "July 2026"
  };
}
