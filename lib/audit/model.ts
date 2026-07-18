// The demand→revenue model behind the Opportunity Audit.
//
// Every dollar figure in the audit traces to this file. The chain is:
//   searches/mo × CTR(position) = visits/mo
//   visits/mo × conversion rate × AOV = revenue/mo
// AI-assistant demand runs the same chain with a citation-capture rate in
// place of the CTR curve. Assumptions are exported so the report can print
// them — a prospect who can audit the math trusts the number.

import type { AuditKeyword, OpportunityCluster } from "./types";

// Organic CTR by position — blended curve consistent with large-scale CTR
// studies (top-heavy, long tail near zero). Position null / >20 → 0.
const CTR_CURVE: Record<number, number> = {
  1: 0.28, 2: 0.15, 3: 0.1, 4: 0.072, 5: 0.053,
  6: 0.04, 7: 0.031, 8: 0.025, 9: 0.021, 10: 0.018,
};

export function ctrAt(position: number | null): number {
  if (position === null || position > 20) return 0;
  if (position <= 10) return CTR_CURVE[position];
  return 0.011; // positions 11-20: page two remnant
}

// AI answers don't have positions — being cited is the unit. A cited brand
// captures a slice of the assistant's referral clicks for that query.
export const AI_CITED_CAPTURE = 0.09; // share of AI query volume that becomes a visit when cited
export const AI_UNCITED_CAPTURE = 0.0;

// Per-vertical commerce assumptions. Deliberately conservative defaults;
// live engagements replace these with the client's real AOV/CVR.
export interface CommerceAssumptions {
  aov: number;
  conversionRate: number;
}

export function keywordTraffic(k: AuditKeyword): number {
  const organic = k.volume * ctrAt(k.position);
  const ai = k.aiVolume * (k.aiCited ? AI_CITED_CAPTURE : AI_UNCITED_CAPTURE);
  return organic + ai;
}

export function keywordTrafficAt(k: AuditKeyword, target: number, aiCited: boolean): number {
  const organic = k.volume * ctrAt(target);
  const ai = k.aiVolume * (aiCited ? AI_CITED_CAPTURE : AI_UNCITED_CAPTURE);
  return organic + ai;
}

// What the current organic clicks would cost as paid clicks — the classic
// "traffic value" anchor. Uses each keyword's live CPC.
export function trafficValue(keywords: AuditKeyword[]): number {
  return Math.round(keywords.reduce((sum, k) => sum + k.volume * ctrAt(k.position) * k.cpc, 0));
}

export interface ClusterEconomics {
  currentTraffic: number;
  potentialTraffic: number;
  monthlyRevenue: { conservative: number; base: number; aggressive: number };
}

// Scenario ladder:
//   conservative — reach halfway between today and target; citations unchanged
//   base         — reach target positions; citations unchanged
//   aggressive   — reach target positions AND win AI citations across the cluster
export function clusterEconomics(
  keywords: AuditKeyword[],
  targetPosition: number,
  assumptions: CommerceAssumptions
): ClusterEconomics {
  const current = keywords.reduce((s, k) => s + keywordTraffic(k), 0);

  const midpoint = (k: AuditKeyword) => {
    const from = k.position === null || k.position > 20 ? 20 : k.position;
    return Math.max(targetPosition, Math.round((from + targetPosition) / 2));
  };

  const conservativeT = keywords.reduce(
    (s, k) => s + keywordTrafficAt(k, midpoint(k), k.aiCited), 0);
  const baseT = keywords.reduce(
    (s, k) => s + keywordTrafficAt(k, targetPosition, k.aiCited), 0);
  const aggressiveT = keywords.reduce(
    (s, k) => s + keywordTrafficAt(k, targetPosition, true), 0);

  const toRevenue = (t: number) =>
    Math.max(0, Math.round((t - current) * assumptions.conversionRate * assumptions.aov));

  return {
    currentTraffic: Math.round(current),
    potentialTraffic: Math.round(baseT),
    monthlyRevenue: {
      conservative: toRevenue(conservativeT),
      base: toRevenue(baseT),
      aggressive: toRevenue(aggressiveT),
    },
  };
}

export function sumOpportunity(clusters: OpportunityCluster[]) {
  return clusters.reduce(
    (acc, c) => ({
      conservative: acc.conservative + c.monthlyRevenue.conservative,
      base: acc.base + c.monthlyRevenue.base,
      aggressive: acc.aggressive + c.monthlyRevenue.aggressive,
    }),
    { conservative: 0, base: 0, aggressive: 0 }
  );
}

// Opportunity-capture score: how much of the modeled demand the brand
// already captures. Low score = big audit story.
export function captureScore(currentTraffic: number, potentialTraffic: number): number {
  if (potentialTraffic <= 0) return 50;
  return Math.max(2, Math.min(98, Math.round((currentTraffic / potentialTraffic) * 100)));
}

export function gradeFor(score: number): string {
  if (score >= 85) return "A";
  if (score >= 75) return "B+";
  if (score >= 65) return "B";
  if (score >= 55) return "B-";
  if (score >= 45) return "C+";
  if (score >= 35) return "C";
  if (score >= 25) return "D+";
  if (score >= 15) return "D";
  return "F";
}

export function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `$${Math.round(n / 1000)}K`;
  if (n >= 1_000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

export function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}K`;
  return Math.round(n).toLocaleString();
}

export function methodology(a: CommerceAssumptions): string[] {
  return [
    `Visits model: monthly searches × CTR-by-position (28% at #1 → 1.8% at #10 → ~1% page two). Keywords outside the top 20 contribute zero current traffic.`,
    `AI-answer model: AI-assistant query volume × ${Math.round(AI_CITED_CAPTURE * 100)}% referral capture when the brand is cited, 0% when it isn't. AI volumes come from DataForSEO's AI keyword dataset (200M+ queries observed across AI surfaces).`,
    `Revenue model: incremental visits × ${(a.conversionRate * 100).toFixed(1)}% conversion × $${a.aov} AOV. Both assumptions are category defaults — we replace them with your real funnel numbers in a working session, which usually moves the estimate up.`,
    `Traffic value: current organic clicks priced at each keyword's live CPC — what this traffic would cost to buy as ads.`,
    `Scenarios: conservative reaches halfway to target positions; base hits target positions with citations unchanged; aggressive hits targets AND wins AI citations across the audited set — the GEO upside is priced only in the aggressive case.`,
  ];
}
