// Runtime settings for Spread Hunter on Vercel. All env-driven; every knob has a safe default.

function num(name: string, d: number): number {
  const v = process.env[name];
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
}
function bool(name: string, d: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return d;
  return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
}
function str(name: string): string | null {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : null;
}

export const config = {
  hibidGraphql: str("SPREAD_HIBID_GRAPHQL") ?? "https://hibid.com/graphql",
  hibidSite: str("SPREAD_HIBID_SITE") ?? "https://hibid.com",
  requestDelayMs: num("SPREAD_REQUEST_DELAY_MS", 400),

  model: str("SPREAD_MODEL") ?? "claude-opus-5",
  valuer: (str("SPREAD_VALUER") ?? "auto") as "auto" | "claude" | "ebay" | "estimate" | "none",
  webSearch: bool("SPREAD_WEB_SEARCH", true),
  ebaySold: bool("SPREAD_EBAY_SOLD", true),
  valuationTtlDays: num("SPREAD_VALUATION_TTL_DAYS", 7),
  valuationWorkers: Math.max(1, Math.floor(num("SPREAD_VALUATION_WORKERS", 4))),
  vision: bool("SPREAD_VISION", true), // send lot photos to the model so it can read marks and split multi-item lots
  maxImages: Math.max(0, Math.floor(num("SPREAD_MAX_IMAGES", 4))),
  valuePerRun: Math.floor(num("SPREAD_VALUE_PER_RUN", 12)),
  dailyValuationCap: Math.floor(num("SPREAD_DAILY_VALUATION_CAP", 150)),
  runBudgetMs: num("SPREAD_RUN_BUDGET_MS", 240_000), // stay under Vercel's maxDuration

  buyerPremium: num("SPREAD_BUYER_PREMIUM", 0.15),
  salesTax: num("SPREAD_SALES_TAX", 0),
  pickupCost: num("SPREAD_PICKUP_COST", 0),
  resaleFee: num("SPREAD_RESALE_FEE", 0.15),
  resaleShipping: num("SPREAD_RESALE_SHIP", 0),
  spreadFull: num("SPREAD_SPREAD_FULL", 150),
  minSpread: num("SPREAD_MIN_SPREAD", 10),
  sweetMaxLanded: num("SPREAD_SWEET_MAX_LANDED", 6),
  sweetMinNet: num("SPREAD_SWEET_MIN_NET", 15),
  ebayFvf: num("SPREAD_EBAY_FVF", 0.136),
  ebayFvfMedia: num("SPREAD_EBAY_FVF_MEDIA", 0.153),
  ebayPerOrder: num("SPREAD_EBAY_PER_ORDER", 0.3),
  ebayPerOrderSmall: num("SPREAD_EBAY_PER_ORDER_SMALL", 0.4),
  ebayPromoted: num("SPREAD_EBAY_PROMOTED", 0),
  packagingCost: num("SPREAD_PACKAGING", 1),

  zip: str("SPREAD_ZIP"),
  miles: str("SPREAD_MILES") ? num("SPREAD_MILES", 0) : null,
  state: str("SPREAD_STATE"),
  country: str("SPREAD_COUNTRY"),
  cronStatus: str("SPREAD_CRON_STATUS") ?? "OPEN",
  cronHours: num("SPREAD_CRON_HOURS", 24),
  cronMaxPages: Math.floor(num("SPREAD_CRON_MAX_PAGES", 5)),
  cronSearch: str("SPREAD_CRON_SEARCH"),
  cronCategory: str("SPREAD_CRON_CATEGORY") ? num("SPREAD_CRON_CATEGORY", 0) : null,

  alertMinScore: num("SPREAD_ALERT_MIN_SCORE", 60),
  alertWindowMin: num("SPREAD_ALERT_WINDOW_MIN", 90),
  alertWebhook: str("SPREAD_ALERT_WEBHOOK"),
  alertEmail: str("SPREAD_ALERT_EMAIL"),
  resendKey: str("RESEND_API_KEY"),
  alertFrom: str("SPREAD_ALERT_FROM") ?? "Spread Hunter <onboarding@resend.dev>",

  password: str("SPREAD_PASSWORD"),
  cronSecret: str("CRON_SECRET"),
  ebayClientId: str("EBAY_CLIENT_ID"),
  ebayClientSecret: str("EBAY_CLIENT_SECRET"),

  get anthropicAvailable(): boolean {
    return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  },
  get claudeEnabled(): boolean {
    return this.anthropicAvailable && (this.valuer === "auto" || this.valuer === "claude");
  },
};
export type Config = typeof config;
