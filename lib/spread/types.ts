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
  expected_days: number;
  profit: number;
  roi: number | null;
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
  images_used?: number;
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
  score: number; // value_score x price_reliability
  heat: "hot" | "warm" | "mild" | "cold" | "unvalued";
  sweet_spot?: boolean;
  radar: "strike" | "watch" | "track" | "scan";
}

export interface Opportunity {
  lot: Lot;
  valuation: Valuation | null;
  score: Score;
  why: string;
  listing: ListingEconomics | null;
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
