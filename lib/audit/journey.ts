// The Journey Map pipeline — Capture's deep pass, run as an async job.
//
//   1. OBSERVE   Firecrawl maps the site and reads ~25 pages as markdown.
//   2. ORGANIZE  Claude pass 1: classify every page, read the site's shape,
//                and draw the 2-4 buyer personas the demand data implies.
//   3. MAP       Claude pass 2: place every audited keyword and AI prompt
//                on the persona × journey-stage grid, judge each cell
//                covered/weak/missing against the real crawl, and route
//                every term to the page that should win it.
//   4. COMPUTE   The engine forecasts the capture curve month by month —
//                a deterministic ramp of the audit's own revenue model.
//                Claude narrates the curve; it never invents a number.
//
// Requires FIRECRAWL_API_KEY + ANTHROPIC_API_KEY; the audit itself keeps
// working without them — the Journey panel simply explains what's missing.

import Anthropic from "@anthropic-ai/sdk";
import { normalizeDomain } from "@/lib/core/market";
import { anthropicConfigured } from "./analyst";
import { crawlSite, firecrawlConfigured } from "./crawl";
import { buildAuditMaybeLive } from "./live";
import { dataforseoConfigured } from "./providers";
import { updateJourneyJob } from "./journey-store";
import {
  JOURNEY_STAGES,
  type CrawledPage,
  type ForecastPoint,
  type JourneyCell,
  type JourneyForecast,
  type JourneyMap,
  type JourneyStage,
  type PageAssignment,
  type Persona,
  type SitePage,
} from "./journey-types";
import type { OpportunityAudit } from "./types";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
const PASS_TIMEOUT_MS = 110_000; // two passes inside a 300s background budget
const MAX_KEYWORDS = 40; // top terms by volume sent to the mapping pass

// ---------------------------------------------------------------------------
// Pass 1 — site intelligence: classify pages, read the shape, draw personas
// ---------------------------------------------------------------------------

interface IntelOverlay {
  pages: {
    path: string;
    type: SitePage["type"];
    topic: string;
    quality: number;
    answerability: number;
    note: string;
  }[];
  site_read: string;
  strongest_path: string;
  weakest_path: string;
  personas: {
    id: string;
    name: string;
    who: string;
    wants: string;
    fears: string;
    buying_trigger: string;
    share_pct: number;
  }[];
}

const INTEL_SCHEMA = {
  type: "object",
  properties: {
    pages: {
      type: "array",
      description: "One entry per crawled page, matched by path.",
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          type: {
            type: "string",
            enum: ["home", "product", "collection", "content", "about", "support", "trust", "legal", "other"],
          },
          topic: { type: "string", description: "One line: what this page is about." },
          quality: { type: "integer", minimum: 0, maximum: 100, description: "Content depth & craft, 0-100." },
          answerability: {
            type: "integer",
            minimum: 0,
            maximum: 100,
            description:
              "How quotable this page is for an answer engine: specific facts, structured claims, proof an AI can cite. 0-100.",
          },
          note: { type: "string", description: "The strategist's one-line read of this page." },
        },
        required: ["path", "type", "topic", "quality", "answerability", "note"],
        additionalProperties: false,
      },
    },
    site_read: {
      type: "string",
      description: "2-3 sentences on the site's shape: what it over-serves, what's thin, what's absent.",
    },
    strongest_path: { type: "string", description: "Path of the single strongest page." },
    weakest_path: { type: "string", description: "Path of the weakest page that matters (skip legal boilerplate)." },
    personas: {
      type: "array",
      description:
        "2-4 buyer personas this business actually serves, inferred from the site + the demand data. Shares should sum to ~100.",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "kebab-case id, e.g. 'event-planner'" },
          name: { type: "string", description: "e.g. 'The Event Planner'" },
          who: { type: "string" },
          wants: { type: "string" },
          fears: { type: "string" },
          buying_trigger: { type: "string", description: "The moment that starts their search." },
          share_pct: { type: "integer", minimum: 5, maximum: 90 },
        },
        required: ["id", "name", "who", "wants", "fears", "buying_trigger", "share_pct"],
        additionalProperties: false,
      },
    },
  },
  required: ["pages", "site_read", "strongest_path", "weakest_path", "personas"],
  additionalProperties: false,
} as const;

const INTEL_SYSTEM = `You are a senior SEO & GEO strategist doing the site-intelligence pass of a paid content audit. You receive a real crawl of the client's site (page titles, headings, word counts, content snippets) plus their market audit data (business model, demand clusters, keyword volumes).

Rules:
- Classify what you actually see in the crawl. Never invent pages, products, or claims that are not in the input.
- Quality scores reward depth, specificity, and craft; punish thin templated copy.
- Answerability scores what an answer engine could quote: concrete facts, numbers, structured claims, proof. A beautiful page with no citable substance scores low.
- Personas must be grounded in BOTH the site and the demand data — name the segments whose searches appear in the keyword volumes. Estimate each persona's share of the audited demand.
- Voice: concise, concrete, written for a founder. Every note should be worth reading aloud in a client meeting.`;

// ---------------------------------------------------------------------------
// Pass 2 — the journey grid + keyword→page assignments
// ---------------------------------------------------------------------------

interface MapOverlay {
  summary: string;
  grid: {
    persona_id: string;
    stage: JourneyStage;
    status: "covered" | "weak" | "missing";
    page_paths: string[];
    note: string;
  }[];
  assignments: {
    term: string;
    kind: "keyword" | "prompt";
    persona_id: string;
    stage: JourneyStage;
    action: "optimize" | "create" | "consolidate";
    target_path: string;
    target_title: string;
    detail: string;
  }[];
  forecast_note: string;
}

const MAP_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description:
        "The strategist's read of the whole journey map, 3-5 sentences: where the journeys break, the single biggest structural gap, and the sequencing logic. Grounded in the supplied data.",
    },
    grid: {
      type: "array",
      description:
        "One entry per persona × stage combination (aware, consider, decide, retain for every persona). Status is judged against the real crawled pages.",
      items: {
        type: "object",
        properties: {
          persona_id: { type: "string" },
          stage: { type: "string", enum: ["aware", "consider", "decide", "retain"] },
          status: { type: "string", enum: ["covered", "weak", "missing"] },
          page_paths: { type: "array", items: { type: "string" }, description: "Existing paths serving this cell." },
          note: { type: "string", description: "One line: why this status, citing pages or their absence." },
        },
        required: ["persona_id", "stage", "status", "page_paths", "note"],
        additionalProperties: false,
      },
    },
    assignments: {
      type: "array",
      description:
        "EVERY input keyword and prompt routed to the page that should win it. action=optimize (existing page, improve it), create (no page can win this — propose path + title), consolidate (competing pages split the signal — merge into target).",
      items: {
        type: "object",
        properties: {
          term: { type: "string", description: "Exactly as given in the input." },
          kind: { type: "string", enum: ["keyword", "prompt"] },
          persona_id: { type: "string" },
          stage: { type: "string", enum: ["aware", "consider", "decide", "retain"] },
          action: { type: "string", enum: ["optimize", "create", "consolidate"] },
          target_path: { type: "string", description: "Existing path, or the proposed new path for action=create." },
          target_title: { type: "string", description: "The page title / H1 that wins this term." },
          detail: { type: "string", description: "What specifically to do — one concrete sentence." },
        },
        required: ["term", "kind", "persona_id", "stage", "action", "target_path", "target_title", "detail"],
        additionalProperties: false,
      },
    },
    forecast_note: {
      type: "string",
      description:
        "2-3 sentences narrating the supplied forecast curve — which assignments drive the early months vs. the back half. Quote the supplied dollar figures exactly; do not compute new ones.",
    },
  },
  required: ["summary", "grid", "assignments", "forecast_note"],
  additionalProperties: false,
} as const;

const MAP_SYSTEM = `You are a senior SEO & GEO strategist building the journey map of a paid content audit. You receive: the client's classified site pages (from a real crawl), their buyer personas, their audited keywords with real volumes and current rankings, the AI-assistant prompts where competitors get cited instead of them, and a deterministic revenue forecast computed by the audit engine.

Rules:
- Place every keyword and every prompt on the persona × stage grid, and route each to a target page. Do not drop terms; do not invent terms.
- Judge grid cells against the pages that actually exist in the crawl. 'covered' needs a genuinely strong page, not just any page.
- action=create only when no existing page could credibly win the term; propose realistic paths that fit the site's existing URL structure.
- Prompts are won by citable pages: for prompt assignments, the detail should say what quotable substance the target page needs.
- Never compute dollar figures — quote the supplied forecast numbers exactly where needed.
- Voice: concrete, direct, client-meeting quality. Every detail line is an instruction someone could execute this week.`;

// ---------------------------------------------------------------------------
// The deterministic forecast — the engine's numbers, never Claude's
// ---------------------------------------------------------------------------

// Cumulative capture share by month m (1-12): a logistic ramp, normalized to
// land at 100% of the scenario's steady state in month 12. Scenario curves
// differ in midpoint/steepness: aggressive execution front-loads capture.
function rampShare(m: number, mid: number, w: number): number {
  const f = (x: number) => 1 / (1 + Math.exp(-(x - mid) / w));
  return (f(m) - f(0)) / (f(12) - f(0));
}

export function buildForecast(audit: OpportunityAudit): JourneyForecast {
  const ss = audit.economics.opportunity;
  const curves = {
    conservative: { mid: 8, w: 2.2 },
    base: { mid: 6.5, w: 2.0 },
    aggressive: { mid: 5.5, w: 1.8 },
  };
  const points: ForecastPoint[] = [];
  for (let m = 1; m <= 12; m++) {
    points.push({
      month: `M${m}`,
      conservative: Math.round(ss.conservative * rampShare(m, curves.conservative.mid, curves.conservative.w)),
      base: Math.round(ss.base * rampShare(m, curves.base.mid, curves.base.w)),
      aggressive: Math.round(ss.aggressive * rampShare(m, curves.aggressive.mid, curves.aggressive.w)),
    });
  }
  const cum = (k: "conservative" | "base" | "aggressive") => points.reduce((s, p) => s + p[k], 0);
  return {
    points,
    steadyState: { ...ss },
    yearOneCumulative: { conservative: cum("conservative"), base: cum("base"), aggressive: cum("aggressive") },
    note: "", // filled by the mapping pass (narrative only)
    methodology: [
      "Steady-state $/mo per scenario comes straight from the audit's revenue model (CTR curve × conversion × AOV; assumptions printed in the audit) — the forecast adds timing, not new dollars.",
      "Monthly capture follows a logistic ramp reaching 100% of steady state at month 12: SEO changes take effect over weeks (crawl, re-rank, CTR shift) and citations compound behind them.",
      "Scenario curves differ in ramp speed — conservative assumes slower content velocity and re-rank lag (midpoint month 8), base month 6.5, aggressive month 5.5 with full citation capture.",
      "Year-one cumulative is the sum of the twelve monthly run-rates — the total incremental revenue collected during the ramp, not a projection beyond it.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

class JourneyError extends Error {}

async function callClaude<T>(
  system: string,
  schema: Record<string, unknown>,
  payload: unknown,
  maxTokens: number
): Promise<T> {
  const client = new Anthropic({ timeout: PASS_TIMEOUT_MS, maxRetries: 1 });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema },
    },
    system,
    messages: [{ role: "user", content: JSON.stringify(payload) }],
  });
  if (response.stop_reason === "refusal") throw new JourneyError("The analyst pass declined this site.");
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new JourneyError("The analyst pass returned no output.");
  return JSON.parse(text) as T;
}

function auditBrief(audit: OpportunityAudit) {
  return {
    brand: audit.brand,
    businessModel: audit.businessModel,
    score: { overall: audit.score.overall, grade: audit.score.grade },
    clusters: audit.clusters.map((c) => ({
      name: c.name,
      stage: c.stage,
      totalVolume: c.totalVolume,
      totalAiVolume: c.totalAiVolume,
    })),
  };
}

function pageBrief(pages: CrawledPage[]) {
  return pages.map((p) => ({
    path: p.path,
    title: p.title,
    description: p.description,
    headings: p.headings,
    wordCount: p.wordCount,
    snippet: p.snippet,
  }));
}

export async function buildJourneyMap(
  rawDomain: string,
  onPhase: (phase: string) => Promise<void>
): Promise<JourneyMap> {
  const domain = normalizeDomain(rawDomain) || "example.com";
  if (!firecrawlConfigured()) {
    throw new JourneyError("Add FIRECRAWL_API_KEY to enable the site crawl behind the Journey Map.");
  }
  if (!anthropicConfigured()) {
    throw new JourneyError("Add ANTHROPIC_API_KEY to enable the analyst layer behind the Journey Map.");
  }

  // The audit is the demand backbone — cached, so usually instant here.
  await onPhase("Loading the opportunity audit…");
  const audit = await buildAuditMaybeLive(domain, dataforseoConfigured());

  await onPhase("Crawling the site…");
  const crawled = await crawlSite(domain, (done, total) => onPhase(`Reading pages… ${done}/${total}`));
  if (!crawled) {
    throw new JourneyError(`Couldn't crawl ${domain} — the site may be blocking crawlers or unreachable.`);
  }

  await onPhase(`Classifying ${crawled.length} pages & drawing personas…`);
  const intel = await callClaude<IntelOverlay>(
    INTEL_SYSTEM,
    INTEL_SCHEMA,
    { audit: auditBrief(audit), crawl: pageBrief(crawled) },
    8192
  );

  // Merge classification onto the crawl — the crawl is the source of truth
  // for which pages exist.
  const intelByPath = new Map(intel.pages.map((p) => [p.path, p]));
  const pages: SitePage[] = crawled.map((c) => {
    const cls = intelByPath.get(c.path);
    return {
      url: c.url,
      path: c.path,
      title: c.title || cls?.topic || c.path,
      type: cls?.type ?? "other",
      topic: cls?.topic ?? "",
      quality: clamp100(cls?.quality ?? 40),
      answerability: clamp100(cls?.answerability ?? 30),
      wordCount: c.wordCount,
      note: cls?.note ?? "",
    };
  });

  const personas: Persona[] = normalizeShares(
    intel.personas.slice(0, 4).map((p) => ({
      id: p.id,
      name: p.name,
      who: p.who,
      wants: p.wants,
      fears: p.fears,
      buyingTrigger: p.buying_trigger,
      share: p.share_pct,
    }))
  );

  // Demand terms: top keywords by volume + every tracked AI prompt.
  const kwPool = audit.clusters
    .flatMap((c) => c.keywords.map((k) => ({ ...k, cluster: c.name })))
    .sort((a, b) => b.volume - a.volume)
    .slice(0, MAX_KEYWORDS);
  const prompts = audit.geo.missedPrompts.map((m) => ({
    prompt: m.prompt,
    surface: m.surface,
    citedInstead: m.citedInstead,
  }));

  const forecast = buildForecast(audit);

  await onPhase("Mapping journeys & assigning every term to a page…");
  const overlay = await callClaude<MapOverlay>(
    MAP_SYSTEM,
    MAP_SCHEMA,
    {
      brand: audit.brand,
      businessModel: audit.businessModel,
      personas,
      pages: pages.map((p) => ({
        path: p.path,
        type: p.type,
        topic: p.topic,
        quality: p.quality,
        answerability: p.answerability,
      })),
      keywords: kwPool.map((k) => ({
        term: k.term,
        cluster: k.cluster,
        intent: k.intent,
        volume: k.volume,
        aiVolume: k.aiVolume,
        position: k.position,
      })),
      prompts,
      quickWins: audit.quickWins.map((w) => ({ term: w.term, position: w.position })),
      forecast: {
        steadyState: forecast.steadyState,
        yearOneCumulative: forecast.yearOneCumulative,
        m3: forecast.points[2],
        m6: forecast.points[5],
        m12: forecast.points[11],
      },
    },
    16384
  );

  // Re-attach engine-owned volumes to assignments by term — Claude routes,
  // the data stays ours.
  const volByTerm = new Map(kwPool.map((k) => [k.term.toLowerCase(), { volume: k.volume, aiVolume: k.aiVolume }]));
  const personaIds = new Set(personas.map((p) => p.id));
  const fallbackPersona = personas[0]?.id ?? "buyer";
  const assignments: PageAssignment[] = overlay.assignments.map((a) => {
    const vols = volByTerm.get(a.term.toLowerCase());
    return {
      term: a.term,
      kind: a.kind,
      volume: vols?.volume ?? 0,
      aiVolume: vols?.aiVolume ?? 0,
      personaId: personaIds.has(a.persona_id) ? a.persona_id : fallbackPersona,
      stage: a.stage,
      action: a.action,
      targetPath: a.target_path,
      targetTitle: a.target_title,
      detail: a.detail,
    };
  });
  assignments.sort((a, b) => b.volume + b.aiVolume - (a.volume + a.aiVolume));

  // The grid: every persona × stage cell exists, enriched with its terms.
  const cellKey = (p: string, s: string) => `${p}::${s}`;
  const overlayCells = new Map(overlay.grid.map((g) => [cellKey(g.persona_id, g.stage), g]));
  const grid: JourneyCell[] = [];
  for (const p of personas) {
    for (const s of JOURNEY_STAGES) {
      const oc = overlayCells.get(cellKey(p.id, s.key));
      const terms = assignments
        .filter((a) => a.personaId === p.id && a.stage === s.key)
        .map((a) => a.term);
      grid.push({
        personaId: p.id,
        stage: s.key,
        status: oc?.status ?? (terms.length > 0 ? "missing" : "weak"),
        pagePaths: oc?.page_paths ?? [],
        terms,
        note: oc?.note ?? "No coverage identified in the crawl for this step.",
      });
    }
  }

  forecast.note = overlay.forecast_note;

  const byType = new Map<SitePage["type"], number>();
  for (const p of pages) byType.set(p.type, (byType.get(p.type) ?? 0) + 1);

  return {
    domain,
    summary: overlay.summary,
    inventory: {
      pagesCrawled: pages.length,
      byType: [...byType.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
      avgQuality: Math.round(pages.reduce((s, p) => s + p.quality, 0) / Math.max(pages.length, 1)),
      avgAnswerability: Math.round(pages.reduce((s, p) => s + p.answerability, 0) / Math.max(pages.length, 1)),
      strongestPath: intel.strongest_path,
      weakestPath: intel.weakest_path,
      read: intel.site_read,
    },
    pages: [...pages].sort((a, b) => b.quality - a.quality),
    personas,
    grid,
    assignments,
    forecast,
    meta: {
      generatedAt: new Date().toISOString(),
      sources: [
        `LIVE · Site crawl — ${pages.length} pages read as markdown (Firecrawl)`,
        "LIVE · Page classification, personas & journey mapping (Claude)",
        `Demand backbone: the ${audit.meta.mode.toUpperCase()} opportunity audit for ${domain}`,
        "Forecast: deterministic ramp of the audit's revenue model — the analyst narrates it, the engine computes it",
      ],
    },
  };
}

function clamp100(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizeShares(personas: Persona[]): Persona[] {
  const total = personas.reduce((s, p) => s + p.share, 0) || 1;
  const scaled = personas.map((p) => ({ ...p, share: Math.round((p.share / total) * 100) }));
  const drift = 100 - scaled.reduce((s, p) => s + p.share, 0);
  if (scaled[0]) scaled[0].share += drift;
  return scaled;
}

// The job wrapper the API route hands to after(): phase updates flow to the
// store so the UI's progress line is honest, and any failure lands as a
// clean error status instead of an eternal spinner.
export async function runJourneyJob(jobId: string, domain: string): Promise<void> {
  try {
    await updateJourneyJob(jobId, { status: "crawling", phase: "Starting…" });
    const map = await buildJourneyMap(domain, async (phase) => {
      const status = /crawl|read|audit/i.test(phase) ? "crawling" : "analyzing";
      await updateJourneyJob(jobId, { status, phase });
    });
    await updateJourneyJob(jobId, { status: "ready", phase: "Ready", payload: map });
  } catch (e) {
    const msg =
      e instanceof JourneyError
        ? e.message
        : "The journey run hit an unexpected error. Rebuild to try again.";
    await updateJourneyJob(jobId, { status: "error", error: msg });
  }
}
