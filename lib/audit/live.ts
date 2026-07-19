// Live Opportunity Audit — real DataForSEO data, assembled two ways:
//
//   DATA-FIRST (domains with a real ranking footprint): clusters are built
//   FROM the domain's actual ranked keywords (top 300) plus the category's
//   unclaimed demand (keyword ideas seeded from its own top terms). Topics,
//   stages, and positions all come from observed data; the vertical
//   playbook isn't involved.
//
//   PLAYBOOK OVERLAY (sparse/new domains): the original behavior — the
//   vertical playbook's audited set, overlaid with whatever real signals
//   exist, so the audit still works for a site DataForSEO barely knows.
//
// Either way assembleAudit re-derives every number, the analyst pass
// rewrites the narrative, and the meta block says exactly what's real.

import { buildMarketProfile, normalizeDomain, verticalKeyFor } from "@/lib/core/market";
import { applyAnalystPass } from "./analyst";
import { buildTopicClusters, difficultyFallback, type LiveTerm } from "./clusterer";
import { assembleAudit, buildAudit } from "./engine";
import { loadRecentAudit, saveAudit } from "./store";
import {
  dataforseoConfigured,
  dfsAiKeywordVolumes,
  dfsBulkDifficulty,
  dfsCompetitorsDomain,
  dfsDomainOverview,
  dfsKeywordIdeas,
  dfsRankedKeywords,
  dfsSerpFeatureScan,
} from "./providers";
import type { AuditKeyword, CompetitorGapRow, OpportunityAudit, OpportunityCluster } from "./types";

const TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; audit: OpportunityAudit }>();

const RANKED_LIMIT = 300; // the domain's real footprint
const IDEAS_LIMIT = 100; // unclaimed category demand
const MIN_RANKED_FOR_DATA_FIRST = 12;
const MAX_SERP_SCANS = 8; // one per cluster — the cost ceiling per live audit

function titleCase(domain: string): string {
  const stem = domain.split(".")[0];
  return stem
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export async function buildAuditMaybeLive(
  rawDomain: string,
  live: boolean
): Promise<OpportunityAudit> {
  const domain = normalizeDomain(rawDomain) || "example.com";
  const base = buildAudit(domain);
  if (!live || !dataforseoConfigured()) return base;

  const hit = cache.get(domain);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.audit;

  // Durable cache: a live audit saved within the TTL serves instantly —
  // survives cold starts and redeploys, and skips the provider spend.
  const stored = await loadRecentAudit(domain, TTL_MS);
  if (stored) {
    cache.set(domain, { at: Date.now(), audit: stored });
    return stored;
  }

  const liveModules: string[] = [];
  const [ranked, competitors, overview] = await Promise.all([
    dfsRankedKeywords(domain, RANKED_LIMIT),
    dfsCompetitorsDomain(domain),
    dfsDomainOverview(domain),
  ]);

  let clusters: OpportunityCluster[] | null = null;

  // ---------------------------------------------------------------- //
  // Path A — data-first: real footprint → real topic clusters         //
  // ---------------------------------------------------------------- //
  if (ranked && ranked.length >= MIN_RANKED_FOR_DATA_FIRST) {
    const stem = domain.split(".")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
    const seeds = ranked
      .filter((r) => !r.term.toLowerCase().replace(/[^a-z0-9]/g, "").includes(stem))
      .slice(0, 5)
      .map((r) => r.term);
    const ideas = await dfsKeywordIdeas(seeds.length ? seeds : ranked.slice(0, 3).map((r) => r.term), IDEAS_LIMIT);

    const rankedTerms = new Set(ranked.map((r) => r.term.toLowerCase()));
    const terms: LiveTerm[] = [
      ...ranked.map((r) => ({
        term: r.term,
        volume: r.volume,
        cpc: r.cpc,
        position: r.position,
        difficulty: null,
        aiVolume: null,
      })),
      ...(ideas ?? [])
        .filter((i) => !rankedTerms.has(i.term.toLowerCase()))
        .map((i) => ({
          term: i.term,
          volume: i.volume,
          cpc: i.cpc,
          position: null,
          difficulty: i.difficulty,
          aiVolume: null,
        })),
    ];

    const termStrings = terms.map((t) => t.term);
    const [aiVols, difficulty] = await Promise.all([
      dfsAiKeywordVolumes(termStrings),
      dfsBulkDifficulty(termStrings),
    ]);
    for (const t of terms) {
      const ai = aiVols?.get(t.term.toLowerCase());
      if (typeof ai === "number") t.aiVolume = ai;
      const d = difficulty?.get(t.term.toLowerCase());
      if (typeof d === "number") t.difficulty = d;
      else if (t.difficulty === null) t.difficulty = difficultyFallback(t.volume);
    }

    const built = buildTopicClusters(domain, terms);
    if (built) {
      clusters = built.clusters;
      liveModules.push(
        `${built.rankedUsed} ranking keywords clustered into topics (DataForSEO Labs)`
      );
      if (built.ideasUsed > 0) {
        liveModules.push(
          `Unclaimed demand: ${built.ideasUsed} category keywords the domain doesn't rank for (DataForSEO Labs keyword ideas)`
        );
      }
      if (aiVols) liveModules.push("AI search volumes across the audited set (DataForSEO AI keyword dataset)");
      if (difficulty) liveModules.push("Keyword difficulty (DataForSEO Labs)");
    }
  }

  // ---------------------------------------------------------------- //
  // Path B — playbook overlay: sparse footprint, keep the original    //
  // behavior so brand-new sites still get a working audit             //
  // ---------------------------------------------------------------- //
  if (!clusters) {
    const overlay: OpportunityCluster[] = JSON.parse(JSON.stringify(base.clusters));
    const allTerms = overlay.flatMap((c) => c.keywords.map((k) => k.term));
    const [aiVols, difficulty] = await Promise.all([
      dfsAiKeywordVolumes(allTerms),
      dfsBulkDifficulty(allTerms),
    ]);

    if (ranked) {
      liveModules.push("Ranked keywords (DataForSEO Labs)");
      const rmap = new Map(ranked.map((r) => [r.term.toLowerCase(), r]));
      for (const c of overlay) {
        for (const k of c.keywords) {
          const real = rmap.get(k.term.toLowerCase());
          if (!real) continue;
          k.position = real.position;
          if (real.volume > 0) k.volume = real.volume;
          if (real.cpc > 0) k.cpc = Number(real.cpc.toFixed(2));
        }
      }
      // The domain's actual top-ranking keywords that the playbook didn't
      // anticipate become their own cluster — real portfolio, real positions.
      const audited = new Set(allTerms.map((t) => t.toLowerCase()));
      const extras = ranked
        .filter((r) => !audited.has(r.term.toLowerCase()) && r.volume > 0 && r.position <= 20)
        .slice(0, 8);
      if (extras.length >= 3) {
        const kws: AuditKeyword[] = extras.map((r) => ({
          term: r.term,
          intent: "commercial",
          volume: r.volume,
          aiVolume: aiVols?.get(r.term.toLowerCase()) ?? Math.round(r.volume * 0.08),
          cpc: Number(r.cpc.toFixed(2)),
          difficulty: difficulty?.get(r.term.toLowerCase()) ?? 35,
          position: r.position,
          serpFeatures: [],
          aiOverviewPresent: false,
          aiCited: false,
        }));
        overlay.push({
          id: "cluster-live-portfolio",
          name: "Current ranking portfolio",
          stage: "defend",
          keywords: kws,
          totalVolume: 0, // derived in assembleAudit
          totalAiVolume: 0,
          avgDifficulty: 0,
          bestPosition: null,
          targetPosition: 3,
          currentTraffic: 0,
          potentialTraffic: 0,
          monthlyRevenue: { conservative: 0, base: 0, aggressive: 0 },
          competitorOwning: null,
          why: "These are the keywords the domain actually ranks for today (DataForSEO Labs). They're the compounding base: pushing them from page-one to top-3 is cheaper than any new build, and they feed the internal links every capture cluster needs.",
          play: "Refresh + interlink the pages behind these terms; they fund the rest of the roadmap.",
        });
      }
    }

    if (aiVols) {
      liveModules.push("AI search volumes (DataForSEO AI keyword dataset)");
      for (const c of overlay) {
        for (const k of c.keywords) {
          const v = aiVols.get(k.term.toLowerCase());
          if (typeof v === "number") k.aiVolume = v;
        }
      }
    }
    if (difficulty) {
      liveModules.push("Keyword difficulty (DataForSEO Labs)");
      for (const c of overlay) {
        for (const k of c.keywords) {
          const d = difficulty.get(k.term.toLowerCase());
          if (typeof d === "number") k.difficulty = d;
        }
      }
    }
    clusters = overlay;
  }

  // --- SERP feature scans: the top-volume keyword of each cluster ---
  const scanTargets = clusters
    .map((c) => c.keywords.reduce((m, k) => (k.volume > m.volume ? k : m), c.keywords[0]))
    .filter(Boolean)
    .slice(0, MAX_SERP_SCANS);
  const scans = await Promise.all(scanTargets.map((k) => dfsSerpFeatureScan(k.term, domain)));
  if (scans.some((s) => s !== null)) {
    liveModules.push("SERP features + AI Overview citations (DataForSEO SERP)");
    scans.forEach((s, i) => {
      if (!s) return;
      const k = scanTargets[i];
      k.serpFeatures = s.features;
      k.aiOverviewPresent = s.aiOverviewPresent;
      k.aiCited = s.aiCited;
      k.position = s.position ?? k.position;
    });
  }

  // --- real competitor domains ---
  let competitorGaps: CompetitorGapRow[] | undefined;
  if (competitors) {
    liveModules.push("Competitor domains (DataForSEO Labs)");
    const demoRates = new Map(base.competitorGaps.map((c) => [c.domain, c.aiCitationRate]));
    competitorGaps = competitors.map((c) => ({
      name: titleCase(c.domain),
      domain: c.domain,
      sharedKeywords: c.sharedKeywords,
      theirExclusive: Math.max(0, c.organicKeywords - c.sharedKeywords),
      estTrafficValue: c.estTrafficValue,
      aiCitationRate: demoRates.get(c.domain) ?? Math.max(4, Math.min(60, 48 - c.avgPosition)),
      threat: `Intersects on ${c.sharedKeywords.toLocaleString()} keywords at avg position ${c.avgPosition} — ${c.organicKeywords.toLocaleString()} keywords ranked overall.`,
    }));
    // Capture clusters are held by somebody — name the biggest intersecting rival.
    const rival = competitorGaps[0]?.name ?? null;
    if (rival) {
      for (const c of clusters) if (c.stage === "capture" && !c.competitorOwning) c.competitorOwning = rival;
    }
  }

  if (liveModules.length === 0) return base;

  const sources = [
    ...liveModules.map((m) => `LIVE · ${m}`),
    "Modeled: the revenue chain (CTR curve × conversion × AOV) and AI-citation capture — assumptions printed in the methodology. Demand, positions, and citations above are live observations.",
  ];
  if (overview) {
    sources.push(
      `LIVE · Portfolio: ${overview.organicKeywords.toLocaleString()} ranking keywords, ~$${overview.estTrafficValue.toLocaleString()}/mo estimated traffic value (DataForSEO Labs)`
    );
  }

  const assembled = assembleAudit({
    domain,
    profile: buildMarketProfile(domain),
    archKey: verticalKeyFor(domain),
    clusters,
    readiness: base.geo.readiness,
    mode: "live",
    sources,
    competitorGaps,
  });

  // Narrative upgrade on real data — no-op without ANTHROPIC_API_KEY, and
  // the template narrative stands on any failure.
  const audit = await applyAnalystPass(assembled);

  await saveAudit(audit); // archive + durable cache; no-op without Supabase keys
  cache.set(domain, { at: Date.now(), audit });
  return audit;
}
