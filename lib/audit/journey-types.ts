// The Journey Map contract — Capture's deep pass.
//
// Where the Opportunity Audit answers "where is the money?", the Journey
// Map answers "who is it, how do they travel, and which page wins each
// step?" It is built from a real crawl of the site (Firecrawl), classified
// and organized by the analyst layer (Claude), with every modeled number —
// the forecast — owned by the deterministic engine, same as the audit.
//
// Division of labor, restated because it is the whole design:
//   - Firecrawl observes: the pages that actually exist and what's on them.
//   - Claude organizes: page classification, personas, journey coverage,
//     and which page should win each keyword and AI prompt.
//   - The engine computes: every dollar in the forecast traces to the
//     audit's printed CTR/conversion model. Claude never invents a number.

export type PageType =
  | "home"
  | "product"
  | "collection"
  | "content"
  | "about"
  | "support"
  | "trust"
  | "legal"
  | "other";

export type JourneyStage = "aware" | "consider" | "decide" | "retain";

export const JOURNEY_STAGES: { key: JourneyStage; label: string; question: string }[] = [
  { key: "aware", label: "Aware", question: "They realize the need — who shows up?" },
  { key: "consider", label: "Consider", question: "They compare options — who's on the list?" },
  { key: "decide", label: "Decide", question: "They pick one — who closes it?" },
  { key: "retain", label: "Retain", question: "They come back (or don't) — who stays top of mind?" },
];

// A page as crawled: what Firecrawl actually saw.
export interface CrawledPage {
  url: string;
  path: string;
  title: string;
  description: string;
  headings: string[];
  wordCount: number;
  snippet: string; // first ~700 chars of main content
}

// A page as classified: what the analyst made of it.
export interface SitePage {
  url: string;
  path: string;
  title: string;
  type: PageType;
  topic: string; // one-line: what this page is about
  quality: number; // 0-100 — content depth & craft
  answerability: number; // 0-100 — how quotable it is for an answer engine
  wordCount: number;
  note: string; // the analyst's one-line read
}

export interface Persona {
  id: string;
  name: string; // "The Event Planner"
  who: string; // who they are, in a sentence
  wants: string; // what they're trying to get done
  fears: string; // what makes them hesitate
  buyingTrigger: string; // the moment that starts their search
  share: number; // % of the audited demand this persona represents
}

export type CellStatus = "covered" | "weak" | "missing";

// One cell of the persona × stage grid.
export interface JourneyCell {
  personaId: string;
  stage: JourneyStage;
  status: CellStatus;
  pagePaths: string[]; // existing pages serving this cell
  terms: string[]; // keywords + prompts assigned to this cell
  note: string; // why this status — grounded in the crawl
}

export type AssignmentAction = "optimize" | "create" | "consolidate";

// The unit of the action plan: one search (keyword or AI prompt) routed to
// the page that should win it.
export interface PageAssignment {
  term: string;
  kind: "keyword" | "prompt";
  volume: number; // Google searches/mo (0 for prompts)
  aiVolume: number; // AI-assistant searches/mo
  personaId: string;
  stage: JourneyStage;
  action: AssignmentAction;
  targetPath: string; // existing path to optimize, or the proposed new path
  targetTitle: string; // the page/H1 that wins this term
  detail: string; // what specifically to do
}

export interface ForecastPoint {
  month: string; // "M1" .. "M12"
  conservative: number; // $/mo run-rate captured by this month
  base: number;
  aggressive: number;
}

export interface JourneyForecast {
  points: ForecastPoint[];
  steadyState: { conservative: number; base: number; aggressive: number }; // $/mo at full capture
  yearOneCumulative: { conservative: number; base: number; aggressive: number }; // total $ collected across M1-M12
  note: string; // analyst's read of the curve (narrative only)
  methodology: string[]; // every assumption behind the curve, stated plainly
}

export interface JourneyInventory {
  pagesCrawled: number;
  byType: { type: PageType; count: number }[];
  avgQuality: number;
  avgAnswerability: number;
  strongestPath: string;
  weakestPath: string;
  read: string; // 2-3 sentence shape-of-the-site summary
}

export interface JourneyMap {
  domain: string;
  summary: string; // the strategist's read of the whole map
  inventory: JourneyInventory;
  pages: SitePage[];
  personas: Persona[];
  grid: JourneyCell[];
  assignments: PageAssignment[];
  forecast: JourneyForecast;
  meta: {
    generatedAt: string; // ISO
    sources: string[];
  };
}

export type JourneyStatus = "queued" | "crawling" | "analyzing" | "ready" | "error";

// The async job wrapper — deep passes outlive a single request, so state
// lives in Supabase (memory fallback for keyless local dev).
export interface JourneyJob {
  id: string;
  domain: string;
  status: JourneyStatus;
  phase: string | null; // human-readable progress line
  error: string | null;
  payload: JourneyMap | null;
  createdAt: string;
  updatedAt: string;
}
