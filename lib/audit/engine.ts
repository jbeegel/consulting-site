// Deterministic Opportunity Audit engine.
//
// Seeded by domain: keyless demo mode always works, and every number is
// internally consistent — cluster totals sum to headline totals, and the
// score is computed from the same traffic model the revenue figures use.
// Brand and competitor names come from the shared MarketProfile.
//
// Each vertical gets a hand-written playbook: named opportunity clusters
// with real keyword shapes, an intent mix, and the analyst narrative. The
// playbook is what makes the audit read like a strategist wrote it.

import {
  buildMarketProfile,
  normalizeDomain,
  seededRng,
  verticalKeyFor,
  type MarketProfile,
} from "@/lib/core/market";
import type { TrendPoint } from "./types";
import {
  AI_CITED_CAPTURE,
  clusterEconomics,
  captureScore,
  fmtNum,
  fmtUsd,
  gradeFor,
  keywordTraffic,
  ctrAt,
  methodology,
  sumOpportunity,
  trafficValue,
  type CommerceAssumptions,
} from "./model";
import type {
  AuditKeyword,
  ClusterStage,
  CompetitorGapRow,
  GeoReadinessCheck,
  Intent,
  OpportunityAudit,
  OpportunityCluster,
  QuickWin,
  SerpFeatureStat,
} from "./types";

type Rng = () => number;
const ri = (rng: Rng, min: number, max: number) => Math.floor(rng() * (max - min + 1)) + min;
const rf = (rng: Rng, min: number, max: number, dp = 2) =>
  Number((rng() * (max - min) + min).toFixed(dp));

function growthTrend(rng: Rng, points: number, end: number, growth: number): TrendPoint[] {
  // rising series that lands on `end`; growth = total multiple over the window
  const out: TrendPoint[] = [];
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    const base = end / (1 + growth * (1 - t));
    const v = i === points - 1 ? end : base * (1 + (rng() - 0.5) * 0.14);
    out.push({ label: i === points - 1 ? "Now" : `M-${points - 1 - i}`, value: Math.round(v) });
  }
  return out;
}

// ---------- vertical playbooks ----------

interface KeywordSeed {
  term: string;
  vol: [number, number];
  cpc: [number, number];
  intent: Intent;
  ai: number; // multiplier on the baseline AI-volume share (gift/`best of` queries skew AI-heavy)
}

interface ClusterTemplate {
  name: string;
  stage: ClusterStage;
  target: number;
  why: string; // {brand} / {competitor} placeholders
  play: string;
  keywords: KeywordSeed[];
}

interface Playbook {
  assumptions: CommerceAssumptions;
  businessModel: {
    model: string;
    revenueMotion: string;
    citationStrategy: string;
    keySurfaces: string[];
  };
  clusters: ClusterTemplate[];
}

const PLAYBOOKS: Record<string, Playbook> = {
  popcorn: {
    assumptions: { aov: 68, conversionRate: 0.024 },
    businessModel: {
      model: "Gifting & events e-commerce",
      revenueMotion:
        "Mid-AOV consumer checkout with two B2B multipliers on top: bulk event orders and corporate gifting, both seasonal (Q4, wedding season) and repeat-heavy.",
      citationStrategy:
        "Gift and event queries are answered by AI assistants more than almost any other commerce intent — buyers describe an occasion and ask what to buy. The citation play is quotability: gift guides with concrete prices and ship times, event pages with bulk pricing in crawlable text, and presence in the third-party 'best gourmet popcorn' round-ups assistants compose from.",
      keySurfaces: ["ChatGPT gift recommendations", "Google AI Overviews", "Shopping pack"],
    },
    clusters: [
      {
        name: "Corporate & holiday gifting",
        stage: "capture",
        target: 3,
        why: "Gifting is the highest-AOV demand in the category and it spikes every Q4 — {competitor} owns these SERPs today while {brand} is effectively absent. Gift queries are also the most AI-assistant-heavy popcorn queries in the dataset: people ask ChatGPT for gift ideas before they ever reach Google.",
        play: "Build a /corporate-gifts hub with a bulk-quote form, three gift-guide pages against the money terms, and pricing-tier schema so AI answers can quote {brand} directly.",
        keywords: [
          { term: "popcorn gift baskets", vol: [5400, 8100], cpc: [1.2, 2.1], intent: "transactional", ai: 1.6 },
          { term: "corporate popcorn gifts", vol: [1300, 2400], cpc: [2.2, 3.8], intent: "transactional", ai: 1.8 },
          { term: "gourmet popcorn tins", vol: [2900, 5400], cpc: [1.0, 1.9], intent: "transactional", ai: 1.2 },
          { term: "client holiday gifts under $50", vol: [1900, 3600], cpc: [2.5, 4.5], intent: "commercial", ai: 2.2 },
          { term: "popcorn christmas gifts", vol: [2400, 4400], cpc: [1.1, 2.0], intent: "transactional", ai: 1.4 },
        ],
      },
      {
        name: "Events, weddings & bulk orders",
        stage: "grow",
        target: 2,
        why: "This is {brand}'s core business and the intent is pure purchase — yet the rankings sit in striking distance instead of the top 3. Event planners and couples order in bulk, order months ahead, and reorder for the next event.",
        play: "Consolidate event content onto one authoritative /events hub, add FAQ and Product schema, take the People-Also-Ask boxes, and land two wedding-press features for authority.",
        keywords: [
          { term: "wedding popcorn favors", vol: [2400, 4400], cpc: [1.4, 2.6], intent: "transactional", ai: 1.7 },
          { term: "bulk popcorn for events", vol: [1600, 2900], cpc: [1.8, 3.2], intent: "transactional", ai: 1.5 },
          { term: "popcorn bar for party", vol: [1900, 3600], cpc: [0.9, 1.8], intent: "commercial", ai: 1.9 },
          { term: "popcorn party favors", vol: [1300, 2400], cpc: [1.2, 2.2], intent: "transactional", ai: 1.4 },
          { term: "popcorn favors in bulk", vol: [880, 1600], cpc: [1.6, 2.8], intent: "transactional", ai: 1.3 },
        ],
      },
      {
        name: "Flavor-led discovery",
        stage: "capture",
        target: 4,
        why: "Flavor queries are how buyers find a popcorn brand they've never heard of, and every flavor page is a durable landing page that compounds. 'Best' flavor queries trigger AI Overviews almost every time — whoever is quotable wins the answer.",
        play: "One rich page per hero flavor with review schema and an origin story, plus a flavors comparison page structured to be quoted by AI Overviews.",
        keywords: [
          { term: "chicago mix popcorn", vol: [4400, 8100], cpc: [0.7, 1.4], intent: "commercial", ai: 1.1 },
          { term: "best gourmet caramel corn", vol: [1000, 1900], cpc: [0.9, 1.7], intent: "commercial", ai: 2.0 },
          { term: "caramel popcorn delivery", vol: [880, 1600], cpc: [1.3, 2.4], intent: "transactional", ai: 1.3 },
          { term: "cheddar popcorn online", vol: [590, 1000], cpc: [1.1, 2.0], intent: "transactional", ai: 1.2 },
        ],
      },
      {
        name: "Fundraising & wholesale",
        stage: "capture",
        target: 5,
        why: "Fundraising is the largest raw search volume in the category and a repeat B2B channel — schools and teams reorder every season. Thin competition outside {competitor}, and one program page can hold the whole cluster.",
        play: "A /fundraising program page with a margin calculator and wholesale inquiry flow, plus one case study per segment: schools, teams, nonprofits.",
        keywords: [
          { term: "popcorn fundraiser", vol: [6600, 12100], cpc: [1.5, 2.7], intent: "commercial", ai: 1.4 },
          { term: "popcorn fundraiser for schools", vol: [1000, 1900], cpc: [1.3, 2.4], intent: "commercial", ai: 1.6 },
          { term: "wholesale gourmet popcorn", vol: [720, 1300], cpc: [1.9, 3.4], intent: "transactional", ai: 1.2 },
        ],
      },
      {
        name: "Brand & comparison defense",
        stage: "defend",
        target: 1,
        why: "'Best gourmet popcorn' listicles and comparison queries are where buyers make the final call — and the exact pages AI assistants compose their recommendations from. {brand} has to hold #1 on its own name and appear in every credible best-of.",
        play: "Refresh the reviews/press page, secure inclusion in two third-party 'best gourmet popcorn' round-ups, and publish honest comparison pages against the two biggest rivals.",
        keywords: [
          { term: "best gourmet popcorn", vol: [3600, 6600], cpc: [0.8, 1.6], intent: "commercial", ai: 2.4 },
          { term: "gourmet popcorn brands", vol: [1300, 2400], cpc: [0.7, 1.4], intent: "commercial", ai: 2.1 },
          { term: "{brand} reviews", vol: [320, 720], cpc: [0.3, 0.8], intent: "commercial", ai: 1.5 },
        ],
      },
    ],
  },
  dtc: {
    assumptions: { aov: 96, conversionRate: 0.021 },
    businessModel: {
      model: "Direct-to-consumer e-commerce",
      revenueMotion:
        "Single-checkout consumer purchases where paid acquisition is expensive — organic and AI-answer capture directly displace ad spend.",
      citationStrategy:
        "DTC citations are won through comparison and use-case content: assistants recommend brands they can compare on concrete attributes. Publish honest vs/alternatives pages, put review counts and differentiators in crawlable text, and get included in the category round-ups assistants cite.",
      keySurfaces: ["Google AI Overviews", "ChatGPT product recommendations", "Shopping pack"],
    },
    clusters: [
      {
        name: "Category money terms",
        stage: "grow",
        target: 3,
        why: "The head terms of the category sit in striking distance — one CTR class away from a different business. {competitor} holds the top spots with content {brand} can beat on depth and proof.",
        play: "Upgrade the category landing pages with comparison tables, review schema, and expert quotes; consolidate cannibalizing pages.",
        keywords: [
          { term: "best walking shoes", vol: [22200, 40500], cpc: [1.1, 2.2], intent: "commercial", ai: 1.8 },
          { term: "sustainable sneakers", vol: [4400, 8100], cpc: [1.0, 1.9], intent: "commercial", ai: 1.6 },
          { term: "comfortable everyday shoes", vol: [2900, 5400], cpc: [1.2, 2.3], intent: "commercial", ai: 1.5 },
          { term: "machine washable shoes", vol: [1900, 3600], cpc: [0.9, 1.7], intent: "transactional", ai: 1.2 },
        ],
      },
      {
        name: "Use-case & occasion demand",
        stage: "capture",
        target: 3,
        why: "Occasion queries convert like brand terms but nobody in the category serves them properly — the SERPs are held by thin listicles. Also the fastest-growing slice of AI-assistant demand: people describe their situation and ask what to buy.",
        play: "A use-case content hub (travel, standing all day, gifts) with a picker quiz, each page structured for AI quotability.",
        keywords: [
          { term: "best travel shoes", vol: [5400, 9900], cpc: [1.0, 2.0], intent: "commercial", ai: 2.0 },
          { term: "shoes for standing all day", vol: [8100, 14800], cpc: [1.2, 2.4], intent: "commercial", ai: 2.2 },
          { term: "gifts for someone who walks a lot", vol: [720, 1300], cpc: [1.4, 2.6], intent: "commercial", ai: 2.4 },
        ],
      },
      {
        name: "Comparison & alternatives",
        stage: "capture",
        target: 2,
        why: "Buyers at the final decision search '{competitor} alternatives' and 'X vs Y' — the highest-converting non-brand intent that exists. AI assistants answer these constantly, from whoever published the comparison.",
        play: "Honest comparison pages against each major rival, one 'alternatives' page optimized for AI citation, review-count proof above the fold.",
        keywords: [
          { term: "{competitor} alternatives", vol: [1900, 3600], cpc: [1.3, 2.5], intent: "commercial", ai: 2.3 },
          { term: "wool runners vs regular sneakers", vol: [590, 1300], cpc: [0.8, 1.5], intent: "commercial", ai: 1.9 },
          { term: "{brand} vs {competitor}", vol: [880, 1900], cpc: [0.9, 1.8], intent: "commercial", ai: 2.1 },
        ],
      },
      {
        name: "Brand defense",
        stage: "defend",
        target: 1,
        why: "Brand + reviews queries are conversion's last mile; slipping here leaks the demand every other channel paid to create.",
        play: "Own the brand SERP: reviews page with schema, FAQ coverage, and press placements that AI assistants cite.",
        keywords: [
          { term: "{brand} reviews", vol: [2900, 5400], cpc: [0.4, 0.9], intent: "commercial", ai: 1.7 },
          { term: "is {brand} worth it", vol: [880, 1900], cpc: [0.5, 1.0], intent: "commercial", ai: 2.0 },
          { term: "{brand} discount code", vol: [1900, 4400], cpc: [0.6, 1.2], intent: "transactional", ai: 1.1 },
        ],
      },
    ],
  },
  saas: {
    assumptions: { aov: 1140, conversionRate: 0.009 },
    businessModel: {
      model: "B2B SaaS subscription",
      revenueMotion:
        "Low conversion rate, high contract value — a single captured evaluation query is worth hundreds of consumer clicks, and buying committees now start with an AI assistant shortlist.",
      citationStrategy:
        "SaaS citations run through review aggregators and alternatives content: assistants lean on G2/Capterra-style consensus plus published feature matrices. The play is review velocity, an alternatives hub assistants can quote, and quotable proof stats (deployment time, retention) on the site itself.",
      keySurfaces: ["ChatGPT tool shortlists", "Perplexity comparisons", "Google AI Overviews"],
    },
    clusters: [
      {
        name: "Category head terms",
        stage: "grow",
        target: 3,
        why: "The 'best {cat} software' SERPs decide the shortlist. {brand} sits below the fold on terms that feed every deal — and these queries now trigger AI Overviews on nearly every search.",
        play: "Rebuild the category pages as genuinely best-in-SERP resources with comparison tables and third-party proof; win the snippet.",
        keywords: [
          { term: "best project management software", vol: [27100, 49500], cpc: [8, 18], intent: "commercial", ai: 2.2 },
          { term: "team wiki software", vol: [2400, 4400], cpc: [6, 12], intent: "commercial", ai: 1.8 },
          { term: "knowledge base software", vol: [4400, 8100], cpc: [7, 14], intent: "commercial", ai: 1.9 },
        ],
      },
      {
        name: "Alternatives & switching",
        stage: "capture",
        target: 2,
        why: "'{competitor} alternatives' is bottom-funnel demand from buyers already unhappy with the incumbent — the cheapest pipeline that exists, and the query AI assistants answer most confidently.",
        play: "An alternatives hub with migration guides and honest feature matrices; each page structured so AI answers quote {brand}'s positioning verbatim.",
        keywords: [
          { term: "{competitor} alternatives", vol: [6600, 12100], cpc: [9, 20], intent: "commercial", ai: 2.4 },
          { term: "cheapest way to replace confluence", vol: [590, 1300], cpc: [7, 15], intent: "commercial", ai: 2.2 },
          { term: "{brand} vs {competitor}", vol: [1900, 3600], cpc: [5, 11], intent: "commercial", ai: 2.0 },
        ],
      },
      {
        name: "Jobs-to-be-done content",
        stage: "capture",
        target: 4,
        why: "Workflow queries ('meeting notes ai', 'docs and tasks in one tool') are how teams discover tools mid-problem. Volume is fragmented but intent is sharp and competition thin.",
        play: "A template/workflow library where every template page targets one job-to-be-done and links into product signup.",
        keywords: [
          { term: "meeting notes ai", vol: [8100, 14800], cpc: [4, 9], intent: "commercial", ai: 2.3 },
          { term: "docs and tasks in one tool", vol: [720, 1300], cpc: [5, 10], intent: "commercial", ai: 1.8 },
          { term: "ai workspace", vol: [2900, 5400], cpc: [6, 12], intent: "commercial", ai: 2.1 },
        ],
      },
      {
        name: "Brand & review defense",
        stage: "defend",
        target: 1,
        why: "G2/Capterra-style queries close deals that marketing already created; AI assistants lean heavily on review aggregators when recommending software.",
        play: "Review-velocity program plus a customer-proof page with quotable stats (retention, deployment time) for AI answers.",
        keywords: [
          { term: "{brand} reviews", vol: [1900, 4400], cpc: [2, 5], intent: "commercial", ai: 1.9 },
          { term: "{brand} pricing", vol: [2900, 6600], cpc: [3, 7], intent: "transactional", ai: 1.6 },
        ],
      },
    ],
  },
  restaurant: {
    assumptions: { aov: 34, conversionRate: 0.032 },
    businessModel: {
      model: "Multi-location hospitality",
      revenueMotion:
        "High-frequency, low-ticket visits decided in the moment, plus a high-ticket catering channel — demand resolves through local surfaces more than classic blue links.",
      citationStrategy:
        "Local AI answers pull from the map pack, review corpus, and structured location data — citations here are per-location, not per-domain. The play is location-page schema, review velocity per store, and menu/nutrition data assistants can quote when someone asks 'healthy lunch near me'.",
      keySurfaces: ["Local pack / Maps", "Google AI Overviews (local)", "ChatGPT near-me answers"],
    },
    clusters: [
      {
        name: "Near-me & local intent",
        stage: "grow",
        target: 2,
        why: "'Near me' queries are the walk-in pipeline and they resolve through the local pack plus, increasingly, AI answers with location context. {brand} ranks but doesn't own the pack across metros.",
        play: "Location-page rebuild with menus, real photos, and LocalBusiness schema; review-velocity program per store.",
        keywords: [
          { term: "healthy fast food near me", vol: [33100, 60500], cpc: [1.5, 3.0], intent: "local", ai: 1.7 },
          { term: "best salad near me", vol: [14800, 27100], cpc: [1.2, 2.4], intent: "local", ai: 1.6 },
          { term: "healthy lunch downtown", vol: [1900, 3600], cpc: [1.0, 2.0], intent: "local", ai: 1.5 },
        ],
      },
      {
        name: "Catering & office orders",
        stage: "capture",
        target: 3,
        why: "Catering is the highest-ticket order type with weekday-repeat behavior, and the SERPs are winnable — aggregators hold them with generic pages.",
        play: "A /catering hub with instant quotes, per-metro catering pages, and case studies with real office clients.",
        keywords: [
          { term: "catering healthy office lunch", vol: [1300, 2400], cpc: [3.0, 6.0], intent: "transactional", ai: 1.8 },
          { term: "office salad catering", vol: [720, 1300], cpc: [2.5, 5.0], intent: "transactional", ai: 1.5 },
          { term: "team lunch delivery", vol: [1900, 3600], cpc: [2.0, 4.0], intent: "transactional", ai: 1.7 },
        ],
      },
      {
        name: "Menu & diet demand",
        stage: "capture",
        target: 4,
        why: "Diet-specific queries (gluten free, high protein) are decided before the customer picks a restaurant — the brand that answers them gets the visit, and AI assistants answer them constantly.",
        play: "Diet landing pages backed by structured nutrition data AI models can quote.",
        keywords: [
          { term: "gluten free fast casual", vol: [1900, 3600], cpc: [1.0, 2.0], intent: "commercial", ai: 2.0 },
          { term: "high protein fast food", vol: [8100, 14800], cpc: [0.8, 1.6], intent: "commercial", ai: 2.2 },
          { term: "warm grain bowls", vol: [1300, 2400], cpc: [0.7, 1.4], intent: "commercial", ai: 1.4 },
        ],
      },
      {
        name: "Brand defense",
        stage: "defend",
        target: 1,
        why: "Brand + menu + hours queries are pure retention traffic; losing any of it to aggregators pays their toll on your own customers.",
        play: "Own every brand SERP feature: sitelinks, menu schema, and the AI answer for '{brand} menu'.",
        keywords: [
          { term: "{brand} menu", vol: [8100, 14800], cpc: [0.3, 0.8], intent: "transactional", ai: 1.3 },
          { term: "{brand} near me", vol: [5400, 9900], cpc: [0.4, 1.0], intent: "local", ai: 1.4 },
        ],
      },
    ],
  },
  generic: {
    assumptions: { aov: 80, conversionRate: 0.02 },
    businessModel: {
      model: "Consumer brand",
      revenueMotion:
        "Direct consumer purchases where brand trust decides the final click — comparison and review queries carry outsized revenue weight.",
      citationStrategy:
        "Citations follow third-party consensus: assistants recommend brands that round-ups and review platforms endorse. Win inclusion in the category's most-cited lists, publish comparison pages, and keep concrete proof (ratings, counts, guarantees) in crawlable text.",
      keySurfaces: ["Google AI Overviews", "ChatGPT recommendations", "Review platforms"],
    },
    clusters: [
      {
        name: "Category money terms",
        stage: "grow",
        target: 3,
        why: "The category head terms drive the largest share of commercial demand and {brand} sits in striking distance — one push from a different CTR class. {competitor} holds the top today.",
        play: "Upgrade the two strongest commercial pages with comparison content, proof, and schema; consolidate overlapping pages.",
        keywords: [
          { term: "best {cat} brand", vol: [4400, 9900], cpc: [1.2, 2.6], intent: "commercial", ai: 1.9 },
          { term: "best {cat} 2026", vol: [2900, 5400], cpc: [1.0, 2.0], intent: "commercial", ai: 2.1 },
          { term: "{cat} online", vol: [1900, 3600], cpc: [1.1, 2.2], intent: "transactional", ai: 1.3 },
        ],
      },
      {
        name: "Comparison & alternatives",
        stage: "capture",
        target: 2,
        why: "Final-decision queries — 'alternatives' and 'vs' — convert at brand-term rates, and they're the queries AI assistants answer most often. Whoever publishes the comparison controls it.",
        play: "Honest comparison pages against the two biggest rivals plus one alternatives page built for AI citation.",
        keywords: [
          { term: "{competitor} alternatives", vol: [1300, 2900], cpc: [1.4, 2.8], intent: "commercial", ai: 2.2 },
          { term: "{brand} vs {competitor}", vol: [720, 1600], cpc: [0.9, 1.8], intent: "commercial", ai: 2.0 },
        ],
      },
      {
        name: "Brand defense",
        stage: "defend",
        target: 1,
        why: "Brand-plus-modifier queries are conversion's last mile; every position lost leaks demand other channels already paid for.",
        play: "Own the brand SERP end to end — reviews with schema, FAQ coverage, press that AI models cite.",
        keywords: [
          { term: "{brand} reviews", vol: [1300, 2900], cpc: [0.4, 0.9], intent: "commercial", ai: 1.8 },
          { term: "is {brand} legit", vol: [590, 1300], cpc: [0.5, 1.0], intent: "commercial", ai: 2.0 },
          { term: "{brand} pricing", vol: [880, 1900], cpc: [0.6, 1.2], intent: "transactional", ai: 1.4 },
        ],
      },
    ],
  },
};

// ---------- keyword synthesis ----------

const FEATURES_BY_INTENT: Record<Intent, string[][]> = {
  transactional: [
    ["shopping", "images", "people_also_ask"],
    ["shopping", "people_also_ask"],
    ["shopping", "images", "reviews"],
  ],
  commercial: [
    ["people_also_ask", "featured_snippet", "video"],
    ["people_also_ask", "video"],
    ["featured_snippet", "people_also_ask", "images"],
  ],
  informational: [
    ["featured_snippet", "people_also_ask"],
    ["people_also_ask", "video"],
  ],
  local: [
    ["local_pack", "people_also_ask"],
    ["local_pack", "images", "people_also_ask"],
  ],
};

const AIO_CHANCE: Record<Intent, number> = {
  commercial: 0.85,
  informational: 0.75,
  transactional: 0.4,
  local: 0.3,
};

function synthKeyword(
  rng: Rng,
  seed: KeywordSeed,
  stage: ClusterStage,
  aiShareBase: number,
  fill: (s: string) => string
): AuditKeyword {
  const volume = Math.round(ri(rng, seed.vol[0], seed.vol[1]) / 10) * 10;
  const aiVolume = Math.round((volume * aiShareBase * seed.ai) / 10) * 10;
  const position =
    stage === "defend"
      ? ri(rng, 1, 3)
      : stage === "grow"
        ? ri(rng, 4, 15)
        : rng() > 0.35
          ? null
          : ri(rng, 21, 48);
  const aiOverviewPresent = rng() < AIO_CHANCE[seed.intent];
  const aiCited =
    aiOverviewPresent &&
    (stage === "defend" ? rng() > 0.4 : stage === "grow" ? rng() > 0.78 : rng() > 0.93);
  const difficulty =
    stage === "defend" ? ri(rng, 12, 38) : stage === "grow" ? ri(rng, 24, 52) : ri(rng, 34, 68);
  const features = [...FEATURES_BY_INTENT[seed.intent][ri(rng, 0, FEATURES_BY_INTENT[seed.intent].length - 1)]];
  if (aiOverviewPresent) features.unshift("ai_overview");
  return {
    term: fill(seed.term),
    intent: seed.intent,
    volume,
    aiVolume,
    cpc: rf(rng, seed.cpc[0], seed.cpc[1]),
    difficulty,
    position,
    serpFeatures: features,
    aiOverviewPresent,
    aiCited,
  };
}

// ---------- section builders ----------

export const FEATURE_LABELS: Record<string, string> = {
  ai_overview: "AI Overviews",
  shopping: "Shopping pack",
  people_also_ask: "People Also Ask",
  featured_snippet: "Featured snippet",
  video: "Video carousel",
  local_pack: "Local pack",
  images: "Image pack",
  reviews: "Review stars",
};

export function buildSerpRealEstate(keywords: AuditKeyword[]): SerpFeatureStat[] {
  const total = keywords.length || 1;
  const counts = new Map<string, { present: number; owned: number }>();
  for (const k of keywords) {
    for (const f of k.serpFeatures) {
      const c = counts.get(f) ?? { present: 0, owned: 0 };
      c.present += 1;
      const owns = f === "ai_overview" ? k.aiCited : k.position !== null && k.position <= 3;
      if (owns) c.owned += 1;
      counts.set(f, c);
    }
  }
  const notes: Record<string, string> = {
    ai_overview: "The new position zero — present on most commercial queries; being cited is the only way to appear.",
    shopping: "Paid-adjacent real estate; product feed quality decides who shows.",
    people_also_ask: "Each box is a stealable ranking — answer the question verbatim on-page.",
    featured_snippet: "Winner-take-most: the snippet absorbs a third of clicks on its queries.",
    video: "Underpriced attention — one short per money query changes the SERP mix.",
    local_pack: "Map-pack presence decides near-me revenue before the organic list is seen.",
    images: "Visual queries route through here; alt text and product imagery win it.",
    reviews: "Star ratings in the SERP lift CTR on every listing that has them.",
  };
  return Array.from(counts.entries())
    .map(([feature, c]) => ({
      feature,
      label: FEATURE_LABELS[feature] ?? feature,
      presence: Math.round((c.present / total) * 100),
      owned: c.present ? Math.round((c.owned / c.present) * 100) : 0,
      note: notes[feature] ?? "",
    }))
    .sort((a, b) => b.presence - a.presence);
}

export function buildQuickWins(
  clusters: OpportunityCluster[],
  assumptions: CommerceAssumptions
): QuickWin[] {
  const wins: QuickWin[] = [];
  for (const c of clusters) {
    for (const k of c.keywords) {
      if (k.position === null || k.position < 4 || k.position > 15) continue;
      const target = Math.min(c.targetPosition, 3);
      const upside = Math.round(
        k.volume * (ctrAt(target) - ctrAt(k.position)) * assumptions.conversionRate * assumptions.aov
      );
      if (upside <= 0) continue;
      wins.push({
        term: k.term,
        position: k.position,
        volume: k.volume,
        aiVolume: k.aiVolume,
        targetPosition: target,
        monthlyUpside: upside,
        note:
          k.position <= 6
            ? "One CTR class away — on-page refresh + internal links usually closes this."
            : k.aiOverviewPresent
              ? "Page-one push, and the AI Overview on this query is unclaimed by the brand."
              : "Page-one push: content depth + a handful of internal links.",
      });
    }
  }
  return wins.sort((a, b) => b.monthlyUpside - a.monthlyUpside).slice(0, 6);
}

function buildReadiness(rng: Rng, p: MarketProfile): GeoReadinessCheck[] {
  const goodReviews = p.reputation.avgRating >= 4.0;
  return [
    {
      check: "Structured product data (schema.org)",
      status: rng() > 0.5 ? "partial" : "fail",
      detail: "Product, Offer, and FAQ schema are how AI answers quote price, availability, and specifics without guessing.",
      fix: "Ship Product + FAQ + Review schema on every money page.",
    },
    {
      check: "AI crawler access & llms.txt",
      status: "fail",
      detail: "No llms.txt found and no explicit AI crawler policy — assistants are sampling the site blind.",
      fix: "Publish llms.txt with canonical brand facts; verify GPTBot/ClaudeBot/PerplexityBot access in robots.txt.",
    },
    {
      check: "Entity consistency",
      status: rng() > 0.4 ? "partial" : "pass",
      detail: "Name, category, and location facts must match across site, GBP, and directories — AI models cross-check before citing.",
      fix: "One canonical about/facts page; reconcile listings.",
    },
    {
      check: "Citable proof on-page",
      status: rng() > 0.6 ? "partial" : "fail",
      detail: "AI answers prefer sources with concrete numbers — review counts, awards, 'ships in 2 days' — stated in crawlable text.",
      fix: "Add a quotable proof block (stats, counts, guarantees) to the top pages.",
    },
    {
      check: "Comparison & best-of presence",
      status: p.ai.overall > 35 ? "partial" : "fail",
      detail: `Assistants compose recommendations from third-party round-ups; ${p.brand.name} appears in ${p.ai.overall}% of tracked answers.`,
      fix: "Pitch the two most-cited round-ups; publish honest comparison pages.",
    },
    {
      check: "Review corpus depth",
      status: goodReviews ? "pass" : "partial",
      detail: `${p.reputation.totalReviews.toLocaleString()} reviews at ${p.reputation.avgRating.toFixed(1)} average — ${goodReviews ? "a citable trust asset" : "thin for AI trust signals"}.`,
      fix: goodReviews ? "Keep velocity up — recency is weighted." : "Post-purchase review flow to build the corpus.",
    },
  ];
}

// ---------- assembly ----------

// Everything derived — cluster economics, totals, scores, quick wins, SERP
// real estate, the unified opportunity list, and the narrative — is computed
// here from the cluster keyword sets. Demo synthesis and the live DataForSEO
// overlay both funnel through this, so a live audit re-derives every number
// AND every sentence from the real data instead of patching demo copy.
export interface AssembleInputs {
  domain: string;
  profile: MarketProfile;
  archKey: string;
  clusters: OpportunityCluster[]; // keyword sets in; derived numbers recomputed here
  readiness: GeoReadinessCheck[];
  mode: "demo" | "live";
  sources: string[];
  competitorGaps?: CompetitorGapRow[]; // live override; synthesized when absent
}

export function assembleAudit(inp: AssembleInputs): OpportunityAudit {
  const { domain, profile: p, archKey, mode, sources } = inp;
  const playbook = PLAYBOOKS[archKey] ?? PLAYBOOKS.generic;
  const { assumptions } = playbook;
  const rng = seededRng(`${domain}|audit|derived`);

  const topCompetitor = p.competitors[0]?.name ?? "the category leader";
  const cat = p.brand.category.split("/")[0].trim().toLowerCase();
  const fill = (s: string) =>
    s
      .replace(/\{brand\}/g, p.brand.name)
      .replace(/\{competitor\}/g, topCompetitor)
      .replace(/\{cat\}/g, cat);

  const clusters: OpportunityCluster[] = inp.clusters
    .map((c) => {
      const eco = clusterEconomics(c.keywords, c.targetPosition, assumptions);
      const positions = c.keywords.map((k) => k.position).filter((x): x is number => x !== null);
      return {
        ...c,
        totalVolume: c.keywords.reduce((s, k) => s + k.volume, 0),
        totalAiVolume: c.keywords.reduce((s, k) => s + k.aiVolume, 0),
        avgDifficulty: Math.round(
          c.keywords.reduce((s, k) => s + k.difficulty, 0) / Math.max(1, c.keywords.length)
        ),
        bestPosition: positions.length ? Math.min(...positions) : null,
        currentTraffic: eco.currentTraffic,
        potentialTraffic: eco.potentialTraffic,
        monthlyRevenue: eco.monthlyRevenue,
      };
    })
    .sort((a, b) => b.monthlyRevenue.base - a.monthlyRevenue.base);

  const allKeywords = clusters.flatMap((c) => c.keywords);
  const totalVolume = allKeywords.reduce((s, k) => s + k.volume, 0);
  const totalAiVolume = allKeywords.reduce((s, k) => s + k.aiVolume, 0);
  const currentTraffic = Math.round(allKeywords.reduce((s, k) => s + keywordTraffic(k), 0));
  const potentialTraffic = clusters.reduce((s, c) => s + c.potentialTraffic, 0);
  const opportunity = sumOpportunity(clusters);

  const seoScore = captureScore(currentTraffic, potentialTraffic);
  const readiness = inp.readiness;
  const readyPts = readiness.reduce(
    (s, r) => s + (r.status === "pass" ? 100 : r.status === "partial" ? 50 : 0),
    0
  );
  const geoScore = Math.round(0.55 * p.ai.overall + 0.45 * (readyPts / readiness.length));
  const overall = Math.round(0.55 * seoScore + 0.45 * geoScore);

  const quickWins = buildQuickWins(clusters, assumptions);
  const top = clusters[0];

  const geoVerdict =
    `${fmtNum(totalAiVolume)} of the ${fmtNum(totalVolume + totalAiVolume)} monthly searches in this audit now happen inside AI assistants — ` +
    `${Math.round((totalAiVolume / Math.max(1, totalVolume + totalAiVolume)) * 100)}% of the demand, and it's the growing share. ` +
    `${p.brand.name} is cited in ${p.ai.overall}% of tracked buying answers` +
    (p.ai.share[0]?.self
      ? ` — the category leader, with the job now being defense.`
      : ` while ${p.ai.share[0]?.name ?? topCompetitor} leads at ${p.ai.share[0]?.share ?? "—"}%. Every uncited answer routes buyers elsewhere before your site ever loads.`);

  const missed = p.ai.prompts
    .filter((pr) => !pr.cited)
    .map((m) => ({ prompt: m.prompt, surface: m.surface, citedInstead: m.competitorsCited }));

  const competitorGaps =
    inp.competitorGaps ??
    p.competitors.map((c) => {
      const sizeRatio = Math.max(0.3, Math.min(3, c.estMonthlyVisits / 900_000));
      return {
        name: c.name,
        domain: c.domain,
        sharedKeywords: ri(rng, 40, 220),
        theirExclusive: Math.round(ri(rng, 260, 700) * sizeRatio),
        estTrafficValue: Math.round((ri(rng, 18, 60) * 1000 * sizeRatio) / 100) * 100,
        aiCitationRate: c.aiCitationRate,
        threat: c.note,
      };
    });

  // The unified "top opportunities across both" list — SEO plays and
  // citation plays ranked together in comparable $/mo.
  const missedShare = missed.length / Math.max(1, p.ai.prompts.length);
  const citationOpportunity = Math.round(
    totalAiVolume * missedShare * AI_CITED_CAPTURE * assumptions.conversionRate * assumptions.aov
  );
  const quickWinTotal = quickWins.reduce((s, w) => s + w.monthlyUpside, 0);
  const topOpportunities = [
    ...clusters.map((c) => ({
      title: c.name,
      kind: (c.totalAiVolume / Math.max(1, c.totalVolume + c.totalAiVolume) > 0.2
        ? "both"
        : "seo") as "both" | "seo",
      monthly: c.monthlyRevenue.base,
      detail: `${fmtNum(c.totalVolume)} Google + ${fmtNum(c.totalAiVolume)} AI searches/mo · ${
        c.bestPosition ? `best position #${c.bestPosition}` : "not ranking"
      } · ${c.competitorOwning ? `${c.competitorOwning} holds it today` : "yours to defend"}`,
      action: c.play,
    })),
    {
      title: "AI citation coverage on missed buying prompts",
      kind: "geo" as const,
      monthly: citationOpportunity,
      detail: `${missed.length} tracked buying prompts name competitors and skip ${p.brand.name} — ${Math.round(missedShare * 100)}% of the AI demand routing elsewhere.`,
      action: playbook.businessModel.citationStrategy.split(". ").slice(-1)[0] ??
        "Win quotability on the money pages.",
    },
    {
      title: "Striking-distance keyword pushes",
      kind: "seo" as const,
      monthly: quickWinTotal,
      detail: `${quickWins.length} keywords at positions 4–15 — one CTR class from materially different traffic.`,
      action: "On-page refresh + internal links on each; fastest payback in the plan.",
    },
  ]
    .filter((o) => o.monthly > 0)
    .sort((a, b) => b.monthly - a.monthly)
    .slice(0, 6);

  const verdict = fill(
    `${p.brand.name} is capturing roughly ${seoScore}% of the demand this audit maps — the rest is being answered by ${topCompetitor} and the round-ups AI assistants quote. ` +
      `The largest single prize is "${top.name.toLowerCase()}" (${fmtNum(top.totalVolume + top.totalAiVolume)} searches/mo, ${fmtUsd(top.monthlyRevenue.base)}/mo at target), ` +
      `and ${quickWins.length} striking-distance keywords are one push from a different CTR class. ` +
      `Across scenarios this is ${fmtUsd(opportunity.conservative)}–${fmtUsd(opportunity.aggressive)}/mo of incremental revenue, ${fmtUsd(opportunity.base)}/mo in the base case — before the AI-answer share, which is still cheap to claim, prices like the early SERPs did.`
  );

  const roadmap = [
    {
      phase: "Days 0–30",
      focus: "Quick wins & foundations",
      moves: [
        quickWins[0]
          ? `Push the striking-distance set — starting with "${quickWins[0].term}" (#${quickWins[0].position} → top 3).`
          : "Push the striking-distance keyword set into the top 3.",
        "Ship Product/FAQ/Review schema on every money page (the GEO readiness fixes).",
        "Publish llms.txt + verify AI crawler access; add the quotable proof block.",
      ],
      kpi: "Striking-distance keywords in top 3",
      expectedLift: `${fmtUsd(Math.round(opportunity.conservative * 0.4))}/mo`,
    },
    {
      phase: "Days 31–60",
      focus: `Capture: ${top.name}`,
      moves: [
        fill(top.play),
        clusters[1] ? `Begin "${clusters[1].name}" — ${clusters[1].keywords.length} keywords, ${fmtNum(clusters[1].totalVolume)}/mo.` : "Begin the second cluster build.",
        "Two authority placements (press or category round-ups) supporting both clusters.",
      ],
      kpi: "Top-5 positions across the lead cluster",
      expectedLift: `${fmtUsd(Math.round(opportunity.conservative * 0.8))}/mo`,
    },
    {
      phase: "Days 61–90",
      focus: "AI answer share & compounding",
      moves: [
        missed.length === 1
          ? `Win the citation on the 1 tracked buying prompt where competitors are named and ${p.brand.name} isn't.`
          : `Win citations on the ${missed.length} tracked buying prompts where competitors are named and ${p.brand.name} isn't.`,
        "Comparison + alternatives pages live and indexed; pitch the two most-AI-cited round-ups for inclusion.",
        "Monthly snapshot cadence on: positions, AI citation rate, and revenue capture vs this baseline.",
      ],
      kpi: `AI citation rate ${p.ai.overall}% → ${Math.min(75, p.ai.overall + 18)}%`,
      expectedLift: `${fmtUsd(opportunity.base)}/mo run-rate`,
    },
  ];

  return {
    brand: p.brand,
    businessModel: { ...playbook.businessModel },
    topOpportunities,
    score: { overall, seo: seoScore, geo: geoScore, grade: gradeFor(overall), verdict },
    headline: {
      keywordsAudited: allKeywords.length,
      clustersFound: clusters.length,
      totalVolume,
      totalAiVolume,
      topCompetitor,
    },
    economics: {
      aov: assumptions.aov,
      conversionRate: assumptions.conversionRate,
      trafficValueNow: trafficValue(allKeywords),
      currentMonthlyTraffic: currentTraffic,
      potentialMonthlyTraffic: potentialTraffic,
      opportunity,
      assumptionsNote: `Modeled at $${assumptions.aov} AOV × ${(assumptions.conversionRate * 100).toFixed(1)}% conversion — category defaults we replace with your real funnel numbers.`,
    },
    clusters,
    quickWins,
    serpRealEstate: buildSerpRealEstate(allKeywords),
    geo: {
      totalAiVolume,
      aiVolumeShare: Math.round((totalAiVolume / Math.max(1, totalVolume + totalAiVolume)) * 100),
      aiVolumeTrend: growthTrend(rng, 12, totalAiVolume, rf(rng, 1.6, 2.6)),
      citationRate: p.ai.overall,
      surfaces: p.ai.surfaces.map((s) => ({
        name: s.name,
        citationRate: s.citationRate,
        promptsTracked: s.promptsTracked,
      })),
      missedPrompts: missed,
      readiness,
      verdict: geoVerdict,
    },
    competitorGaps,
    roadmap,
    meta: {
      mode,
      sources,
      methodology: methodology(assumptions),
      generatedAt: new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    },
  };
}

// ---------- demo synthesis ----------

export function buildAudit(rawDomain: string): OpportunityAudit {
  const domain = normalizeDomain(rawDomain) || "example.com";
  const p = buildMarketProfile(domain);
  const rng = seededRng(`${domain}|audit`);

  const archKey = verticalKeyFor(domain);
  const playbook = PLAYBOOKS[archKey] ?? PLAYBOOKS.generic;

  const topCompetitor = p.competitors[0]?.name ?? "the category leader";
  const cat = p.brand.category.split("/")[0].trim().toLowerCase();
  const fill = (s: string) =>
    s
      .replace(/\{brand\}/g, p.brand.name)
      .replace(/\{competitor\}/g, topCompetitor)
      .replace(/\{cat\}/g, cat);

  // AI share of demand: what % of a query's Google volume also shows up as
  // AI-assistant volume. Baseline is seeded per domain; per-keyword `ai`
  // factors skew gift/best-of queries heavier, matching the dataset's shape.
  const aiShareBase = rf(rng, 0.09, 0.16);

  const clusters: OpportunityCluster[] = playbook.clusters.map((t, idx) => ({
    id: `cluster-${idx}`,
    name: t.name,
    stage: t.stage,
    keywords: t.keywords.map((seed) => synthKeyword(rng, seed, t.stage, aiShareBase, fill)),
    totalVolume: 0, // derived in assembleAudit
    totalAiVolume: 0,
    avgDifficulty: 0,
    bestPosition: null,
    targetPosition: t.target,
    currentTraffic: 0,
    potentialTraffic: 0,
    monthlyRevenue: { conservative: 0, base: 0, aggressive: 0 },
    competitorOwning:
      t.stage === "defend" ? null : p.competitors[idx % p.competitors.length]?.name ?? topCompetitor,
    why: fill(t.why),
    play: fill(t.play),
  }));

  return assembleAudit({
    domain,
    profile: p,
    archKey,
    clusters,
    readiness: buildReadiness(rng, p),
    mode: "demo",
    sources: [
      "Demo mode: deterministic simulated demand, seeded by domain",
      "Live mode fulfills from DataForSEO: Labs ranked keywords + competitor domains, SERP feature scans, and the AI keyword dataset (AI-assistant search volumes, 200M+ queries)",
    ],
  });
}
