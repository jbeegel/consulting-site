// Deterministic market-profile engine.
//
// Gives the audit a coherent picture of a brand's market — vertical,
// competitors, AI-answer visibility, reputation — seeded by domain so the
// same input always produces the same profile, with zero external calls.
// Live mode overlays real provider data on top (see lib/audit/live.ts);
// this baseline guarantees the tool always works keyless.

// ---------- seeded RNG ----------
function xmur3(str: string) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}
function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;
export function seededRng(seed: string): Rng {
  return mulberry32(xmur3(seed)());
}
export const ri = (rng: Rng, min: number, max: number) =>
  Math.floor(rng() * (max - min + 1)) + min;
export const rf = (rng: Rng, min: number, max: number, dp = 2) =>
  Number((rng() * (max - min) + min).toFixed(dp));

export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .replace(/[^a-z0-9.-]/g, "");
}

function brandNameFrom(domain: string): string {
  const stem = domain.split(".")[0];
  return stem
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ---------- verticals ----------

export type AiSurfaceName =
  | "ChatGPT"
  | "Google AI Overviews"
  | "Perplexity"
  | "Gemini";

interface Vertical {
  category: string;
  descriptor: string;
  prompts: string[]; // buyer-intent prompts people ask AI assistants
}

const VERTICALS: Record<string, Vertical> = {
  popcorn: {
    category: "Gourmet Popcorn / Gifting & Events",
    descriptor: "gourmet popcorn & events brand",
    prompts: [
      "What's the best gourmet popcorn for gifts?",
      "Where can I order bulk popcorn for a wedding?",
      "Best popcorn gift baskets to send in 2026?",
      "Best corporate holiday gifts under $50?",
      "Where should I buy popcorn favors for a party?",
    ],
  },
  dtc: {
    category: "DTC / E-commerce",
    descriptor: "direct-to-consumer brand",
    prompts: [
      "What are the best sustainable sneaker brands?",
      "Most comfortable shoes for standing all day?",
      "Best direct-to-consumer shoe brands in 2026?",
      "Are wool sneakers worth it?",
      "Best gifts for someone who walks a lot?",
    ],
  },
  saas: {
    category: "B2B SaaS",
    descriptor: "software platform",
    prompts: [
      "What's the best all-in-one workspace for a startup?",
      "Best Notion alternatives for engineering teams?",
      "What tools should a 50-person company use for internal docs?",
      "Best AI-powered productivity software in 2026?",
      "Cheapest way to replace Confluence?",
    ],
  },
  restaurant: {
    category: "Multi-location / Hospitality",
    descriptor: "multi-location brand",
    prompts: [
      "Where should I get a healthy lunch near me?",
      "Best fast-casual healthy chains?",
      "Healthiest fast food options in 2026?",
      "Best office catering for a team lunch?",
      "Is fast-casual salad actually healthy?",
    ],
  },
  generic: {
    category: "Consumer brand",
    descriptor: "consumer brand",
    prompts: [
      "What are the best brands for {cat}?",
      "Is {brand} worth it?",
      "What are good alternatives to {brand}?",
      "Best {cat} options in 2026?",
      "What do reviews say about {brand}?",
    ],
  },
};

// Vertical detection by domain token — a prospect's domain lands in the
// right playbook with the right real competitors, no configuration.
const TOKEN_VERTICALS: {
  token: string;
  vertical: keyof typeof VERTICALS;
  rivals: [string, string][];
}[] = [
  {
    token: "popcorn",
    vertical: "popcorn",
    rivals: [
      ["Garrett Popcorn", "garrettpopcorn.com"],
      ["The Popcorn Factory", "thepopcornfactory.com"],
      ["Popcornopolis", "popcornopolis.com"],
      ["Poppy Handcrafted Popcorn", "poppyhandcraftedpopcorn.com"],
    ],
  },
];

const CURATED: Record<
  string,
  { vertical: keyof typeof VERTICALS; rivals: [string, string][] }
> = {
  "allbirds.com": {
    vertical: "dtc",
    rivals: [
      ["Rothy's", "rothys.com"],
      ["Vessi", "vessi.com"],
      ["Atoms", "atoms.com"],
      ["On Running", "on.com"],
    ],
  },
  "notion.so": {
    vertical: "saas",
    rivals: [
      ["Coda", "coda.io"],
      ["Airtable", "airtable.com"],
      ["ClickUp", "clickup.com"],
      ["Slite", "slite.com"],
    ],
  },
  "sweetgreen.com": {
    vertical: "restaurant",
    rivals: [
      ["CAVA", "cava.com"],
      ["Chopt", "choptsalad.com"],
      ["Just Salad", "justsalad.com"],
      ["Dig", "diginn.com"],
    ],
  },
};

const GENERIC_RIVALS = [
  "Northwind", "Brightpath", "Fernwell", "Coastal & Co",
  "Marlowe", "Halesite", "Verra", "Outfield",
];

export function verticalKeyFor(rawDomain: string): string {
  const domain = normalizeDomain(rawDomain) || "example.com";
  const curated = CURATED[domain];
  if (curated) return curated.vertical;
  const token = TOKEN_VERTICALS.find((t) => domain.includes(t.token));
  if (token) return token.vertical;
  const rng = seededRng(domain);
  return (["dtc", "saas", "restaurant", "generic"] as const)[ri(rng, 0, 3)];
}

// ---------- profile ----------

export interface MarketCompetitor {
  name: string;
  domain: string;
  estMonthlyVisits: number;
  aiCitationRate: number;
  note: string;
}

export interface MarketPrompt {
  prompt: string;
  surface: AiSurfaceName;
  cited: boolean;
  competitorsCited: string[];
}

export interface MarketProfile {
  brand: { domain: string; name: string; category: string; descriptor: string };
  competitors: MarketCompetitor[];
  ai: {
    overall: number; // blended citation rate across surfaces
    surfaces: { name: AiSurfaceName; citationRate: number; promptsTracked: number }[];
    prompts: MarketPrompt[];
    share: { name: string; share: number; self: boolean }[];
  };
  reputation: { avgRating: number; totalReviews: number };
}

export function buildMarketProfile(rawDomain: string): MarketProfile {
  const domain = normalizeDomain(rawDomain) || "example.com";
  const rng = seededRng(`${domain}|market`);
  const name = brandNameFrom(domain);

  const key = verticalKeyFor(domain);
  const vert = VERTICALS[key];
  const cat = vert.category.split("/")[0].trim().toLowerCase();
  const fill = (s: string) => s.replace(/\{brand\}/g, name).replace(/\{cat\}/g, cat);

  const curated = CURATED[domain];
  const token = TOKEN_VERTICALS.find((t) => domain.includes(t.token));
  const rivalPairs: [string, string][] = curated
    ? curated.rivals
    : token
      ? token.rivals.filter(([, rd]) => rd !== domain)
      : Array.from({ length: 4 }, (_, i) => {
          const n = GENERIC_RIVALS[(ri(rng, 0, 7) + i * 2) % GENERIC_RIVALS.length];
          return [n, n.toLowerCase().replace(/[^a-z]/g, "") + ".com"] as [string, string];
        });

  const overall = ri(rng, 18, 46);
  const surfaceNames: AiSurfaceName[] = ["ChatGPT", "Google AI Overviews", "Perplexity", "Gemini"];
  const surfaces = surfaceNames.map((s) => ({
    name: s,
    citationRate: Math.max(4, Math.min(70, overall + ri(rng, -14, 14))),
    promptsTracked: ri(rng, 40, 120),
  }));

  const prompts: MarketPrompt[] = vert.prompts.map((p) => {
    const cited = rng() > 0.42;
    const comps = rivalPairs
      .filter(() => rng() > 0.45)
      .map(([rn]) => rn)
      .slice(0, 3);
    return {
      prompt: fill(p),
      surface: surfaceNames[ri(rng, 0, surfaceNames.length - 1)],
      cited,
      competitorsCited: comps.length ? comps : [rivalPairs[0][0]],
    };
  });

  const shareOthers = rivalPairs.map(() => ri(rng, 10, 28));
  const scale = (100 - overall) / shareOthers.reduce((a, b) => a + b, 0);
  const share = [
    { name, share: overall, self: true },
    ...rivalPairs.map(([rn], i) => ({
      name: rn,
      share: Math.round(shareOthers[i] * scale),
      self: false,
    })),
  ].sort((a, b) => b.share - a.share);

  const competitors: MarketCompetitor[] = rivalPairs.map(([rn, rd]) => ({
    name: rn,
    domain: rd,
    estMonthlyVisits: ri(rng, 120, 2800) * 1000,
    aiCitationRate: share.find((s) => s.name === rn)?.share ?? ri(rng, 8, 40),
    note: `Cited in ${ri(rng, 2, 4)} of the tracked buying prompts; strongest on "${fill(vert.prompts[ri(rng, 0, vert.prompts.length - 1)])}".`,
  }));

  return {
    brand: { domain, name, category: vert.category, descriptor: vert.descriptor },
    competitors,
    ai: { overall, surfaces, prompts, share },
    reputation: { avgRating: rf(rng, 3.6, 4.6, 1), totalReviews: ri(rng, 1800, 24000) },
  };
}
