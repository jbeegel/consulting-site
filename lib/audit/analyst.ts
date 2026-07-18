// The analyst pass — an optional Claude overlay that upgrades the audit's
// narrative from vertical-playbook templates to bespoke strategist prose.
//
// Strict division of labor: the engine owns every NUMBER (the revenue model
// stays deterministic and traceable to the printed assumptions); Claude owns
// only NARRATIVE fields — the verdict, per-cluster why/play, the citation
// strategy, and a new "observations" section of things a strategist would
// circle in the real data. Runs only on live audits (real DataForSEO data —
// there's nothing honest to observe about synthesized demo demand), only
// when ANTHROPIC_API_KEY is set, and degrades to the template narrative on
// any failure. One call per audit, cached with the audit's 6h cache.

import Anthropic from "@anthropic-ai/sdk";
import type { OpportunityAudit } from "./types";

export function anthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
const TIMEOUT_MS = 45_000; // stay inside the route's 60s budget; fall back past this

interface AnalystOverlay {
  verdict: string;
  citation_strategy: string;
  observations: {
    title: string;
    detail: string;
    kind: "seo" | "geo" | "competitive" | "technical";
  }[];
  clusters: { id: string; why: string; play: string }[];
}

const OVERLAY_SCHEMA = {
  type: "object",
  properties: {
    verdict: {
      type: "string",
      description:
        "The audit's headline read, 3-5 sentences, grounded in the supplied numbers. The paragraph a founder repeats to their cofounder.",
    },
    citation_strategy: {
      type: "string",
      description:
        "How THIS business wins AI-assistant citations, adjusted to its business model and what the data shows. 2-4 sentences.",
    },
    observations: {
      type: "array",
      description:
        "3-5 things a senior strategist would circle in this specific data — anomalies, mismatches, unclaimed openings. Each must reference concrete data points from the input.",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          detail: { type: "string" },
          kind: { type: "string", enum: ["seo", "geo", "competitive", "technical"] },
        },
        required: ["title", "detail", "kind"],
        additionalProperties: false,
      },
    },
    clusters: {
      type: "array",
      description:
        "One entry per input cluster (matched by id): a rewritten 'why' (why this cluster, why now — grounded in its numbers) and 'play' (the concrete move).",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          why: { type: "string" },
          play: { type: "string" },
        },
        required: ["id", "why", "play"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdict", "citation_strategy", "observations", "clusters"],
  additionalProperties: false,
} as const;

const SYSTEM = `You are a senior SEO & GEO (generative engine optimization) strategist writing the narrative layer of a paid-quality opportunity audit for a prospective client. You receive the audit's full data as JSON: real keyword rankings, volumes, CPCs, AI-assistant search volumes, SERP features, AI citation results, and competitor intersections from DataForSEO, plus a deterministic revenue model whose assumptions are printed in the report.

Rules:
- Ground every sentence in the supplied data. Reference specific keywords, positions, volumes, and dollar figures from the input. Never invent facts, numbers, competitors, or details about the company that are not in the data.
- Do not recompute or contradict the model's dollar figures — quote them as given.
- Observations are where you earn the fee: find the non-obvious — a high-volume keyword served by the wrong kind of page, a competitor weak where the data shows an opening, AI demand concentrated where the brand has no citations, a striking-distance term the roadmap should jump on first.
- Voice: confident, concrete, direct. Write for a founder, not an SEO. No hedging, no filler, no "leverage synergies" language.
- The citation strategy must fit the stated business model — an e-commerce gifting brand, a SaaS, and a restaurant win AI answers in different ways.`;

// Trim the audit to what the analyst needs — keeps input tokens bounded.
function analystPayload(a: OpportunityAudit) {
  return {
    brand: a.brand,
    businessModel: a.businessModel,
    score: { overall: a.score.overall, seo: a.score.seo, geo: a.score.geo, grade: a.score.grade },
    headline: a.headline,
    economics: a.economics,
    clusters: a.clusters.map((c) => ({
      id: c.id,
      name: c.name,
      stage: c.stage,
      targetPosition: c.targetPosition,
      currentTraffic: c.currentTraffic,
      potentialTraffic: c.potentialTraffic,
      monthlyRevenue: c.monthlyRevenue,
      competitorOwning: c.competitorOwning,
      keywords: c.keywords,
    })),
    quickWins: a.quickWins,
    serpRealEstate: a.serpRealEstate,
    geo: {
      totalAiVolume: a.geo.totalAiVolume,
      aiVolumeShare: a.geo.aiVolumeShare,
      citationRate: a.geo.citationRate,
      surfaces: a.geo.surfaces,
      missedPrompts: a.geo.missedPrompts,
      readiness: a.geo.readiness.map((r) => ({ check: r.check, status: r.status })),
    },
    competitorGaps: a.competitorGaps,
    liveSources: a.meta.sources.filter((s) => s.startsWith("LIVE")),
  };
}

// Returns the audit with Claude's narrative overlay applied, or the audit
// unchanged on any failure — the numbers never depend on this call.
export async function applyAnalystPass(audit: OpportunityAudit): Promise<OpportunityAudit> {
  if (!anthropicConfigured()) return audit;
  try {
    const client = new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 1 });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: OVERLAY_SCHEMA },
      },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Write the narrative overlay for this audit:\n\n${JSON.stringify(analystPayload(audit))}`,
        },
      ],
    });
    if (response.stop_reason === "refusal") return audit;
    const text = response.content.find((b) => b.type === "text")?.text;
    if (!text) return audit;
    const overlay = JSON.parse(text) as AnalystOverlay;

    const patched: OpportunityAudit = JSON.parse(JSON.stringify(audit));
    if (overlay.verdict) patched.score.verdict = overlay.verdict;
    if (overlay.citation_strategy) {
      patched.businessModel.citationStrategy = overlay.citation_strategy;
    }
    if (Array.isArray(overlay.observations) && overlay.observations.length > 0) {
      patched.observations = overlay.observations.slice(0, 5);
    }
    for (const oc of overlay.clusters ?? []) {
      const target = patched.clusters.find((c) => c.id === oc.id);
      if (!target) continue;
      if (oc.why) target.why = oc.why;
      if (oc.play) target.play = oc.play;
    }
    patched.meta.sources.push("LIVE · Analyst narrative (Claude)");
    return patched;
  } catch {
    return audit; // template narrative is always a complete fallback
  }
}
