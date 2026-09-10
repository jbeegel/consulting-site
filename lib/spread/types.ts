// Spread Hunter — shared types. Mirrors tools/auction-arbitrage/arb (the Python CLI) so the two stay
// interchangeable: the dashboard HTML consumes exactly this shape from either backend.

export interface Lot {
  id: number;
  item_id?: number | null;
  lot_number?: string | null;
  title: string;
  description: string;
  estimate: string;
  quantity: number;
  bid_amount_type?: string | null;
  image?: string | null;
  image_full?: string | null;
  picture_count?: number | null;
  shipping_offered: boolean;
  url: string;
  auction_id?: number | null;
  auction_name?: string | null;
  auction_url?: string | null;
  auctioneer?: string | null;
  auctioneer_id?: number | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  distance_miles?: number | null;
  buyer_premium_rate: number;
  buyer_premium_text?: string | null;
  currency: string;
  bid_close?: string | null;
  bid_type?: string | null;
  high_bid: number;
  min_bid: number | null;
  bid_count: number;
  time_left_seconds: number | null;
  time_left_text?: string | null;
  ends_at: number | null; // unix seconds
  is_closed: boolean;
  is_live: boolean;
  status?: string | null;
  reserve_satisfied?: boolean | null;
  soft_close_minutes?: number | null;
  category_id?: number | null;
  category: string;
  category_path: string;
  fetched_at: number; // unix seconds
  pictures?: string[];
  terms?: string | null;
  shipping_info?: string | null;
  payment_info?: string | null;
  alerted_at?: number | null;
}

export interface Comp {
  title: string;
  price: number;
  source: string;
  url: string;
  date: string;
  note: string;
}

export interface ListingPlan {
  title: string;
  category: string;
  condition: string;
  item_specifics: { name: string; value: string }[];
  description: string;
  format: "fixed_price" | "auction";
  price_quick: number;
  price_market: number;
  price_patient: number;
  best_offer_floor: number;
  auction_start: number;
  shipping_weight_oz: number;
  packaging: string;
  shipping_cost_estimate: number;
  keywords: string[];
  alt_titles?: string[];
  condition_description?: string;
  photo_checklist?: string[];
  seo_notes?: string;
  promoted_rate?: number;
  best_time_to_list?: string;
}

export interface LotItem {
  name: string;
  maker_or_mark: string;
  era: string;
  est_low: number;
  est_high: number;
  confidence: number;
  note: string;
}

export interface GradedComp { grader: string; grade: string; price: number; source: string; url: string; date: string }

export interface GradingAnalysis {
  applicable: boolean;
  card: { year: string; set: string; card_number: string; player_or_subject: string; parallel_or_variation: string; rookie: boolean };
  condition: { centering: string; corners: string; edges: string; surface: string; notes: string; photo_quality: "good" | "limited" | "unusable" };
  grade_probabilities: { psa10: number; psa9: number; psa8: number; psa7_or_below: number };
  predicted_grade: string;
  graded_comps: GradedComp[];
  pop: { psa_total: number; psa_10: number; psa_9: number; note: string };
  raw_value: number;
  recommended_grader: "PSA" | "BGS" | "SGC" | "CGC" | "none";
  grading_notes: string;
}

export interface GradingEconomics {
  probabilities: Record<"10" | "9" | "8" | "7-", number>;
  prices: Record<"10" | "9" | "8" | "7-", number | null>;
  ev_gross: number;
  graded_net: number;
  raw_value: number;
  raw_net: number;
  upside: number;
  graded_net_no10: number;
  upside_no10: number;
  grading_cost: number;
  hurdle: number;
  grading_fee: number;
  grading_ship: number;
  days: number;
  recommendation: string;
  predicted_grade: string | null;
  recommended_grader: string | null;
  photo_quality: string;
  profit_graded_vs_landed: number;
}

export interface PricePoint {
  label: "quick" | "market" | "patient";
  price: number;
  shipping_charged: number;
  fvf: number;
  fvf_rate: number;
  per_order: number;
  promoted: number;
  shipping_cost: number;
  packaging: number;
  net: number;
  /** Days to sell at this price, from the liquidity model rather than a constant. */
  expected_days: number;
  profit: number;
  roi: number | null;
  /** Profit per dollar of capital per 30 days at this price point. */
  monthly_roi?: number | null;
}

export interface ListingEconomics {
  category: string;
  fee_rate: number;
  shipping_cost: number;
  buyer_pays_shipping: boolean;
  format: string;
  best_offer_floor: number | null;
  auction_start: number | null;
  points: PricePoint[];
  recommended: "market";
}

// ----------------------------------------------------------------------------- demand & liquidity
/** What the appraiser found out about how this market actually moves, not what the thing is worth. */
export interface DemandSignals {
  /** Comparable items SOLD on eBay in the last 90 days. */
  sold_90d: number | null;
  /** Comparable items listed for sale right now. */
  active_now: number | null;
  /** sold / (sold + active). Reported because resellers know it; the hazard is what we compute on. */
  sell_through: number | null;
  /** Researched median days a listing takes to sell, when counts are unavailable. */
  median_days_to_sell: number | null;
  /** Typical watchers on an active listing — interest before money. */
  watchers_typical: number | null;
  /** (p75 - p25) / median across sold comps. High means the realized price is a lottery. */
  price_dispersion: number | null;
  trend: "rising" | "flat" | "falling" | "unknown";
  seasonality: string;
  buyer_pool: string;
  note: string;
}

export type LiquidityDepth = "deep" | "moderate" | "thin" | "dead" | "unknown";
/** Where the speed estimate came from, strongest first. */
export type LiquidityBasis = "measured" | "market" | "researched" | "assumed" | "none";

export interface Liquidity {
  score: number; // 0-100
  grade: "A" | "B" | "C" | "D" | "F";
  depth: LiquidityDepth;
  sold_90d: number | null;
  active_now: number | null;
  sell_through: number | null;
  daily_hazard: number; // probability one listing sells on any given day
  days_p50: number;
  days_p80: number;
  sell_probability_30d: number;
  capital_days: number; // days_p50 plus handling: how long the money is actually tied up
  handling_days: number;
  trend: DemandSignals["trend"];
  seasonality: string;
  basis: LiquidityBasis;
  measured_n: number;
  eta: string;
  notes: string[];
}

export type ValuationMethod = "claude+web" | "claude" | "ebay_sold" | "ebay_active" | "hibid_estimate" | "none";

export interface Valuation {
  lot_id: number;
  title_key: string;
  identified_item: string;
  brand: string;
  model: string;
  low: number | null;
  mid: number | null;
  high: number | null;
  currency: string;
  confidence: number;
  confidence_reason: string;
  method: ValuationMethod;
  demand: "high" | "medium" | "low" | "unknown";
  days_to_sell: number | null;
  demand_signals?: DemandSignals | null;
  /** Denormalized from the lot so history can be grouped by category without a join. */
  category?: string;
  best_channel: string;
  condition_assumption: string;
  value_drivers: string[];
  risks: string[];
  rationale: string;
  comps: Comp[];
  search_query: string;
  authenticity_risk: boolean;
  bulk_lot: boolean;
  unit_count: number;
  sources_consulted: string[];
  listing?: ListingPlan | null;
  items?: LotItem[];
  standout_item?: string;
  grading?: GradingAnalysis | null;
  images_used?: number;
  calibration?: { bias: number; confidence_factor: number; basis: string; n: number } | null;
  model_used: string;
  created_at: number;
  error: string;
  cache_hit?: boolean;
}

export interface Score {
  lot_id: number;
  seconds_left: number | null;
  time_bucket: string;
  next_bid: number;
  landed_cost: number;
  price_reliability: number;
  valued: boolean;
  net_resale: number | null;
  net_resale_low?: number | null;
  spread: number | null;
  spread_low?: number | null;
  ratio: number | null;
  confidence: number;
  value_score: number; // disparity at today's price, ignoring the clock
  score: number; // value_score x price_reliability x liquidity_factor
  heat: "hot" | "warm" | "mild" | "cold" | "unvalued";
  sweet_spot?: boolean;
  radar: "strike" | "watch" | "track" | "scan";
  // --- liquidity: how fast the money comes back
  liquidity: Liquidity | null;
  liquidity_factor: number;
  /** Score before liquidity was applied, so the UI can show what liquidity cost this lot. */
  score_before_liquidity: number;
  /** Profit per dollar of capital per 30 days. The ranking metric for a flipper. */
  monthly_roi: number | null;
  /** Spread discounted by the chance it actually sells inside the horizon. */
  expected_profit_60d: number | null;
}

export interface Opportunity {
  lot: Lot;
  valuation: Valuation | null;
  score: Score;
  why: string;
  listing: ListingEconomics | null;
  grading: GradingEconomics | null;
}

/** User-set risk parameters. Sent by the dashboard, applied server-side so alerts honour them too. */
export interface IntelParams {
  /** 0 = rank on raw upside only, 1 = let liquidity fully discount the score. */
  liquidity_weight?: number;
  /** Drop anything graded below this. */
  min_liquidity_grade?: "A" | "B" | "C" | "D" | "F" | null;
  /** Drop anything the model says will take longer than this to sell. */
  max_days_to_sell?: number | null;
  /** Rank by headline score, by profit-per-day-of-capital, or by pure speed. */
  rank_by?: "score" | "velocity" | "liquidity" | "spread";
  /** Days of handling time to add before capital comes back. */
  handling_days?: number;
}

export interface ScanParams {
  status?: string;
  hours?: number | null;
  category?: number | null;
  search_text?: string | null;
  zip?: string | null;
  miles?: number | null;
  max_pages?: number;
  max_value?: number | null;
  value?: boolean;
  trigger?: "manual" | "cron";
}

export interface ScanRecord {
  id: number;
  started_at: number;
  finished_at: number | null;
  status: "running" | "done" | "error";
  params: ScanParams;
  lots_seen: number;
  lots_valued: number;
  message: string;
  trigger: string;
}

export interface CategorySummary {
  category: string;
  lots: number;
  valued: number;
  best_score: number;
  hot: number;
}

// ----------------------------------------------------------------------------- calibration
/** One closed lot, recorded after the fact: what we predicted vs. what actually happened. */
export interface Outcome {
  lot_id: number;
  title: string;
  category: string;
  closed_at: number;
  // what we said before it closed
  predicted_low: number | null;
  predicted_mid: number | null;
  predicted_high: number | null;
  predicted_net: number | null; // mid less selling fees
  confidence: number;
  method: string;
  score: number;
  // what the auction did (free, from HiBid's priceRealized on every closed lot)
  hammer: number | null;
  landed_at_hammer: number | null; // hammer + buyer's premium + tax + pickup
  // ground truth, filled in when you actually sell it
  bought: boolean | null;
  bought_price: number | null;
  sale_price: number | null;
  sale_at: number | null;
  sale_channel: string;
  // --- liquidity ground truth: how long it actually took, and what the listing did
  /** When you put it up for sale. With sale_at this gives the real days-to-sell. */
  listed_at: number | null;
  list_price: number | null;
  /** Still sitting unsold. A right-censored observation: it counts against the 30-day sell rate. */
  still_listed: boolean | null;
  views: number | null;
  watchers: number | null;
  /** What the model predicted before you listed, so the liquidity model can grade itself too. */
  predicted_days: number | null;
  notes: string;
  recorded_at: number;
}

export interface CategoryCalibration {
  category: string;
  n_closed: number;
  n_sold: number;
  /** median (landed cost at hammer) / (predicted net). >= 1 means the deal was never there. */
  median_hammer_ratio: number | null;
  /** share of closed lots where the hammer alone met or beat our predicted net: provably too optimistic. */
  overshoot_rate: number | null;
  /** median (actual sale price) / (predicted mid). 1.0 is perfect. Ground truth. */
  median_sale_ratio: number | null;
  /** median absolute percentage error against real sales. */
  sale_mape: number | null;
  /** multiplier applied to future mid estimates in this category. */
  bias: number;
  /** multiplier applied to future confidence in this category. */
  confidence_factor: number;
  basis: "sales" | "hammer" | "none";
  updated_at: number;
}

export interface CalibrationReport {
  generated_at: number;
  global: CategoryCalibration;
  categories: CategoryCalibration[];
  totals: { closed: number; sold: number; realized_profit: number | null };
  liquidity: LiquidityReport;
}

// ----------------------------------------------------------------------------- liquidity feedback
/** How long things in this category ACTUALLY took to sell, versus how long we said they would. */
export interface CategoryLiquidity {
  category: string;
  /** Listings with a start date: sold plus still-sitting. */
  n_listed: number;
  n_sold: number;
  /** Median observed days from listing to sale. */
  observed_days: number | null;
  /** Median days the model predicted for those same items. */
  predicted_days: number | null;
  /** observed / predicted. >1 means everything takes longer than we say. */
  days_multiplier: number;
  /** Sold within 30 days, over everything that had a fair chance to (censoring handled). */
  sell_rate_30d: number | null;
  /** Listings still unsold after 60 days. The ones that quietly eat your capital. */
  stuck: number;
  basis: "measured" | "none";
  updated_at: number;
}

export interface LiquidityReport {
  global: CategoryLiquidity;
  categories: CategoryLiquidity[];
  /** Median realized monthly ROI across everything you have actually bought and sold. */
  realized_monthly_roi: number | null;
}

// ----------------------------------------------------------------------------- market trends
export interface TrendPoint {
  day: string; // YYYY-MM-DD
  n: number;
  liquidity: number | null;
  days_p50: number | null;
  mid: number | null;
}

export interface CategoryTrend {
  category: string;
  n: number;
  liquidity: number | null;
  days_p50: number | null;
  sell_through: number | null;
  median_mid: number | null;
  /** Change in median liquidity score, recent half of the window versus the earlier half. */
  change: number | null;
  direction: "warming" | "steady" | "cooling" | "new";
  points: TrendPoint[];
}

export interface MarketIntel {
  generated_at: number;
  window_days: number;
  trends: CategoryTrend[];
  warming: CategoryTrend[];
  cooling: CategoryTrend[];
  liquidity: LiquidityReport;
  /** Live board: the open lots with the best profit-per-day-of-capital right now. */
  velocity_leaders: { lot_id: number; title: string; category: string; monthly_roi: number; liquidity_grade: string; eta: string; spread: number; landed_cost: number; ends_at: number | null }[];
  /** Valued high but effectively unsellable — the trap this layer exists to catch. */
  value_traps: { lot_id: number; title: string; category: string; mid: number | null; liquidity_grade: string; eta: string; reason: string }[];
}
