// Topic clustering over real keyword data — the live audit's "lay of the
// land". Instead of overlaying real positions onto vertical playbook
// templates, this builds the clusters FROM the domain's actual ranked
// keywords plus the category's unclaimed demand (keyword ideas):
//
//   - anchor-token grouping: the category's ubiquitous token ("popcorn")
//     is treated as generic; terms group on their most-shared distinctive
//     token ("fundraiser", "gift", "bulk", "near me"...)
//   - each cluster gets a real stage from its real positions: defend
//     (ranking top-4), grow (striking distance), capture (absent)
//   - branded demand is split into its own defend cluster
//
// Deterministic, no model calls — the analyst pass rewrites narrative later.

import type { AuditKeyword, Intent, OpportunityCluster } from "./types";

export interface LiveTerm {
  term: string;
  volume: number;
  cpc: number;
  position: number | null; // null = the domain doesn't rank (keyword idea)
  difficulty: number | null;
  aiVolume: number | null;
}

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "for", "to", "in", "on", "at", "with",
  "is", "are", "was", "do", "does", "you", "your", "my", "me", "we", "our",
  "it", "its", "this", "that", "from", "by", "as", "be", "can", "i",
]);

const MIN_CLUSTER_KWS = 3;
const MAX_CLUSTERS = 7; // + branded + long tail
const MAX_KWS_PER_CLUSTER = 12;

export function classifyIntent(term: string): Intent {
  const t = ` ${term.toLowerCase()} `;
  if (/near me|nearby| local |in my area|open now/.test(t)) return "local";
  if (/\bbuy\b|price|cost|order|cheap|bulk|wholesale|for sale|delivery|shipping|coupon|discount|subscription/.test(t))
    return "transactional";
  if (/\bbest\b|\btop\b| vs |review|compare|alternative|brands?\b/.test(t)) return "commercial";
  if (/\bhow\b|\bwhat\b|\bwhy\b|\bwhen\b|\bwhere\b|guide|ideas?\b|recipe|diy|calories|meaning|history/.test(t))
    return "informational";
  return "commercial";
}

function tokensOf(term: string): string[] {
  return term
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

function compact(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Deterministic difficulty fallback when the bulk endpoint misses a term:
// bigger demand is harder, bounded to a sane band.
export function difficultyFallback(volume: number): number {
  return Math.min(72, 18 + Math.round(Math.log10(Math.max(10, volume)) * 14));
}

// The keyword-ideas endpoint returns the whole adjacent category — a popcorn
// shop's seeds pull in candy, cereal, even vapes. Only ideas sharing one of
// the domain's own core topic tokens (from what it actually ranks for) are
// on-category enough to put in front of a client.
export function coreTopicTokens(rankedTerms: string[], max = 4): Set<string> {
  const freq = new Map<string, number>();
  for (const term of rankedTerms) {
    for (const tok of new Set(tokensOf(term))) freq.set(tok, (freq.get(tok) ?? 0) + 1);
  }
  return new Set(
    [...freq.entries()]
      .filter(([, n]) => n >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, max)
      .map(([tok]) => tok)
  );
}

export function ideaIsRelevant(term: string, core: Set<string>): boolean {
  if (core.size === 0) return true; // no signal to filter on — keep everything
  return tokensOf(term).some((tok) => core.has(tok));
}

function toAuditKeyword(t: LiveTerm): AuditKeyword {
  return {
    term: t.term,
    intent: classifyIntent(t.term),
    volume: t.volume,
    aiVolume: t.aiVolume ?? Math.round(t.volume * 0.08),
    cpc: Number((t.cpc ?? 0).toFixed(2)),
    difficulty: t.difficulty ?? difficultyFallback(t.volume),
    position: t.position,
    serpFeatures: [],
    aiOverviewPresent: false,
    aiCited: false,
  };
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface StageCall {
  stage: OpportunityCluster["stage"];
  target: number;
  why: string;
  play: string;
}

function stageFor(kws: AuditKeyword[], topic: string): StageCall {
  const positions = kws.map((k) => k.position).filter((p): p is number => p !== null);
  const best = positions.length ? Math.min(...positions) : null;
  const rankedShare = positions.length / kws.length;
  const vol = kws.reduce((s, k) => s + k.volume, 0).toLocaleString();
  if (best !== null && best <= 4 && rankedShare >= 0.4) {
    return {
      stage: "defend",
      target: 2,
      why: `The domain already ranks top-4 on part of the "${topic}" demand (${vol} searches/mo audited). This is earned ground — cheap to consolidate, expensive to lose.`,
      play: `Refresh the ranking pages, close the gaps on the cluster's unranked terms, and interlink — consolidation, not construction.`,
    };
  }
  if (best !== null && best <= 20) {
    return {
      stage: "grow",
      target: 3,
      why: `Striking distance: the domain is on page one or two for "${topic}" (best position #${best}) across ${vol} searches/mo. One CTR class up changes the math.`,
      play: `On-page sharpening + internal links from the strongest pages; add the missing sibling terms to the same page cluster.`,
    };
  }
  return {
    stage: "capture",
    target: 5,
    why: `Real demand with no presence: ${vol} searches/mo around "${topic}" where the domain doesn't rank in the top 100. Someone else is answering all of it today.`,
    play: `Build the page this cluster deserves (one hub, supporting variants), structured to be quotable by AI answers as well as rankable.`,
  };
}

export interface TopicClusterResult {
  clusters: OpportunityCluster[];
  rankedUsed: number;
  ideasUsed: number;
}

// terms: ranked keywords (position set) + keyword ideas (position null),
// already deduped by caller. Returns real topic clusters, highest-value
// demand first, or null when there isn't enough signal to beat the playbook.
export function buildTopicClusters(domain: string, terms: LiveTerm[]): TopicClusterResult | null {
  const stem = compact(domain.split(".")[0]);
  const clean = terms.filter((t) => t.term.length >= 3 && t.volume >= 20);
  if (clean.length < 12) return null;

  // Branded demand separates first — it's a different game (defend, cheap).
  const branded = clean.filter((t) => compact(t.term).includes(stem) && stem.length >= 5);
  const generic = clean.filter((t) => !branded.includes(t));

  // Category tokens: present in a large share of terms → generic, not anchors.
  const freq = new Map<string, number>();
  for (const t of generic) {
    for (const tok of new Set(tokensOf(t.term))) freq.set(tok, (freq.get(tok) ?? 0) + 1);
  }
  const categoryTokens = new Set(
    [...freq.entries()].filter(([, n]) => n >= generic.length * 0.4).map(([tok]) => tok)
  );

  // Anchor = the term's most globally-shared non-category token.
  const groups = new Map<string, LiveTerm[]>();
  for (const t of generic) {
    const toks = tokensOf(t.term).filter((tok) => !categoryTokens.has(tok));
    const anchor =
      toks.sort((a, b) => (freq.get(b) ?? 0) - (freq.get(a) ?? 0))[0] ??
      [...categoryTokens][0] ??
      "general";
    const g = groups.get(anchor) ?? [];
    g.push(t);
    groups.set(anchor, g);
  }

  // Small groups pool into the long tail.
  const longTail: LiveTerm[] = [];
  const sized = [...groups.entries()].filter(([, g]) => {
    if (g.length >= MIN_CLUSTER_KWS) return true;
    longTail.push(...g);
    return false;
  });
  sized.sort(
    (a, b) => b[1].reduce((s, t) => s + t.volume, 0) - a[1].reduce((s, t) => s + t.volume, 0)
  );
  for (const [, g] of sized.slice(MAX_CLUSTERS)) longTail.push(...g);
  const kept = sized.slice(0, MAX_CLUSTERS);
  if (kept.length < 3) return null; // not enough topical structure — playbook wins

  const clusters: OpportunityCluster[] = [];
  const push = (id: string, name: string, topic: string, kws: AuditKeyword[]) => {
    if (kws.length === 0) return;
    const call = stageFor(kws, topic);
    clusters.push({
      id,
      name,
      stage: call.stage,
      keywords: kws,
      totalVolume: 0, // derived in assembleAudit
      totalAiVolume: 0,
      avgDifficulty: 0,
      bestPosition: null,
      targetPosition: call.target,
      currentTraffic: 0,
      potentialTraffic: 0,
      monthlyRevenue: { conservative: 0, base: 0, aggressive: 0 },
      competitorOwning: null,
      why: call.why,
      play: call.play,
    });
  };

  kept.forEach(([anchor, g], i) => {
    const kws = g
      .sort((a, b) => b.volume - a.volume)
      .slice(0, MAX_KWS_PER_CLUSTER)
      .map(toAuditKeyword);
    // Name from the cluster's biggest real phrase — human, not mechanical.
    const name = titleCase(g[0].term);
    push(`cluster-topic-${i}-${anchor}`, name, anchor, kws);
  });

  if (branded.length >= 2) {
    push(
      "cluster-branded",
      "Branded demand",
      "the brand itself",
      branded.sort((a, b) => b.volume - a.volume).slice(0, MAX_KWS_PER_CLUSTER).map(toAuditKeyword)
    );
  }

  if (longTail.length >= MIN_CLUSTER_KWS) {
    push(
      "cluster-long-tail",
      "Long-tail portfolio",
      "the long tail",
      longTail.sort((a, b) => b.volume - a.volume).slice(0, MAX_KWS_PER_CLUSTER).map(toAuditKeyword)
    );
  }

  return {
    clusters,
    rankedUsed: clean.filter((t) => t.position !== null).length,
    ideasUsed: clean.filter((t) => t.position === null).length,
  };
}
