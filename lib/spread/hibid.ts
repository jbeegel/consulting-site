// HiBid data client. HiBid has no public API; hibid.com is an Angular app that talks to an Apollo
// GraphQL endpoint (POST https://hibid.com/graphql, no auth for reads). These documents mirror the
// operations the site bundle (PWA 1.22.0) sends, trimmed to the fields we use. One request at a
// time, throttled, with a real user agent.

import type { Lot } from "./types";

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 spread-hunter/0.1 (personal research tool)";

const FRAGMENT_LOT_STATE = `
fragment lotState on LotState {
  bidCount biddingExtended bidMax buyNow choiceType highBid isArchived isClosed isHidden
  isLive isNotYetLive isOnLiveCatalog isPosted minBid priceRealized priceRealizedMessage
  productStatus quantitySold reserveSatisfied sealed showReserveStatus softCloseMinutes
  softCloseSeconds status timeLeft timeLeftLead timeLeftSeconds timeLeftTitle
  timeLeftWithLimboSeconds
}`;
const FRAGMENT_AUCTION_MIN = `
fragment auctionMinimum on Auction {
  id eventName eventAddress eventCity eventState eventZip eventDateBegin eventDateEnd
  eventDateInfo bidOpenDateTime bidCloseDateTime bidType buyerPremium buyerPremiumRate
  showBuyerPremium currencyAbbreviation lotCount hidden sourceType distanceMiles bidAmountType
  auctioneer { id name city state phone email internetAddress }
  auctionOptions { bidding catalog liveCatalog shippingType preview webcast useLotNumber }
  auctionState { auctionStatus openLotCount timeToOpen }
  bidIncrements { minBidIncrement upToAmount }
}`;
const LOT_FIELDS = `
  id itemId lotNumber lead description estimate bidAmount bidQuantity quantity ringNumber
  shippingOffered pictureCount
  featuredPicture { description fullSizeLocation hdThumbnailLocation thumbnailLocation }
  category { id baseCategoryId parentCategoryId categoryName fullCategory uRLPath }
  lotState { ...lotState }`;

export const QUERY_LOT_SEARCH = `
query LotSearch($auctionId: Int = null, $pageNumber: Int!, $pageLength: Int!, $category: CategoryId = null,
  $searchText: String = null, $zip: String = null, $miles: Int = null, $shippingOffered: Boolean = false,
  $countryName: String = null, $state: String = null, $status: AuctionLotStatus = null,
  $sortOrder: EventItemSortOrder = null, $filter: AuctionLotFilter = null, $isArchive: Boolean = false,
  $dateStart: DateTime, $dateEnd: DateTime, $countAsView: Boolean = false, $hideGoogle: Boolean = false,
  $eventItemIds: [Int!] = null, $sortDirection: SortDirection = DESC) {
  lotSearch(
    input: {auctionId: $auctionId, category: $category, searchText: $searchText, zip: $zip, miles: $miles,
      shippingOffered: $shippingOffered, countryName: $countryName, state: $state, status: $status,
      sortOrder: $sortOrder, filter: $filter, isArchive: $isArchive, dateStart: $dateStart, dateEnd: $dateEnd,
      countAsView: $countAsView, hideGoogle: $hideGoogle, eventItemIds: $eventItemIds}
    pageNumber: $pageNumber
    pageLength: $pageLength
    sortDirection: $sortDirection
  ) {
    pagedResults {
      pageLength pageNumber totalCount filteredCount
      results { ${LOT_FIELDS} auction { ...auctionMinimum } }
    }
  }
}${FRAGMENT_LOT_STATE}${FRAGMENT_AUCTION_MIN}`;

export const QUERY_LOT_STATE = `
query GetLotStateQuery($lotId: ID!) { lotState(input: $lotId) { ...lotState } }${FRAGMENT_LOT_STATE}`;

export const QUERY_LOT_DETAILS = `
query GetLotDetails($lotId: ID!, $countAsView: Boolean = false) {
  lot(input: $lotId, countAsView: $countAsView) {
    accessability
    lot { ${LOT_FIELDS} saleOrder
      pictures { description fullSizeLocation hdThumbnailLocation thumbnailLocation }
      auction { ...auctionMinimum termsAndConditions shippingAndPickupInfo paymentInfo } }
  }
}${FRAGMENT_LOT_STATE}${FRAGMENT_AUCTION_MIN}`;

export const QUERY_CATEGORY_TREE = `
query CategoryTree($category: CategoryId = null) {
  categoryTree(input: {category: $category}) {
    id parentCategoryId baseCategoryId categoryName fullCategory hasChildren uRLPath
    children { id parentCategoryId categoryName fullCategory hasChildren uRLPath }
  }
}`;

export class HiBidError extends Error {}

export interface SearchOptions {
  page?: number;
  pageLength?: number;
  status?: string;
  sort?: string;
  sortDirection?: "ASC" | "DESC";
  category?: number | null;
  searchText?: string | null;
  zip?: string | null;
  miles?: number | null;
  country?: string | null;
  state?: string | null;
  shippingOffered?: boolean;
  auctionId?: number | null;
  lotFilter?: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;

export interface Page {
  results: Raw[];
  pageNumber: number;
  pageLength: number;
  totalCount: number;
  filteredCount: number;
  hasMore: boolean;
}

let queue: Promise<unknown> = Promise.resolve();
let lastRequest = 0;

export class HiBidClient {
  constructor(
    private url: string,
    private site: string,
    private delayMs = 400,
    private retries = 3
  ) {
    this.site = site.replace(/\/$/, "");
  }

  private throttle<T>(fn: () => Promise<T>): Promise<T> {
    const run = async () => {
      const wait = this.delayMs - (Date.now() - lastRequest);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastRequest = Date.now();
      return fn();
    };
    const p = queue.then(run, run);
    queue = p.catch(() => undefined);
    return p;
  }

  async execute<T = Raw>(operationName: string, query: string, variables: Raw): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < this.retries; attempt++) {
      try {
        return await this.throttle(async () => {
          const res = await fetch(this.url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              accept: "*/*",
              "user-agent": USER_AGENT,
              origin: this.site,
              referer: this.site + "/lots",
              "apollographql-client-name": "hibid-pwa",
            },
            body: JSON.stringify({ operationName, variables, query }),
            cache: "no-store",
          });
          if ([429, 502, 503, 504].includes(res.status)) throw new HiBidError(`HTTP ${res.status} from HiBid`);
          if (!res.ok) {
            const text = (await res.text()).slice(0, 200);
            throw new HiBidError(`HTTP ${res.status} from HiBid: ${text}`);
          }
          const payload = (await res.json()) as { data?: T; errors?: { message: string }[] };
          if (payload.errors?.length && !payload.data)
            throw new HiBidError(`${operationName}: ${payload.errors[0].message}`);
          return (payload.data ?? {}) as T;
        });
      } catch (e) {
        lastErr = e;
        if (e instanceof HiBidError && /HTTP 4(0[0-9]|1[0-9]|2[0-8])/.test(e.message)) throw e; // don't retry hard 4xx
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
    throw new HiBidError(`${operationName} failed after ${this.retries} attempts: ${String(lastErr)}`);
  }

  async searchLots(o: SearchOptions = {}): Promise<Page> {
    const page = o.page ?? 1;
    const pageLength = o.pageLength ?? 100;
    const data = await this.execute("LotSearch", QUERY_LOT_SEARCH, {
      pageNumber: page,
      pageLength,
      status: o.status ?? "OPEN",
      sortOrder: o.sort ?? "TIME_LEFT",
      sortDirection: o.sortDirection ?? "DESC",
      category: o.category ?? null,
      searchText: o.searchText || null,
      zip: o.zip || null,
      miles: o.zip ? o.miles ?? null : null,
      countryName: o.country || null,
      state: o.state || null,
      shippingOffered: !!o.shippingOffered,
      auctionId: o.auctionId ?? null,
      filter: o.lotFilter ?? null,
      countAsView: false,
      hideGoogle: false,
      isArchive: false,
    });
    const paged = data?.lotSearch?.pagedResults ?? {};
    const results: Raw[] = paged.results ?? [];
    const filteredCount = paged.filteredCount ?? 0;
    return {
      results,
      pageNumber: paged.pageNumber ?? page,
      pageLength: paged.pageLength ?? pageLength,
      totalCount: paged.totalCount ?? 0,
      filteredCount,
      hasMore: (paged.pageNumber ?? page) * (paged.pageLength ?? pageLength) < filteredCount && results.length > 0,
    };
  }

  async *iterLots(o: SearchOptions & { maxPages?: number } = {}): AsyncGenerator<Raw> {
    const maxPages = o.maxPages ?? 10;
    for (let page = 1; page <= maxPages; page++) {
      const p = await this.searchLots({ ...o, page });
      for (const r of p.results) yield r;
      if (!p.hasMore) break;
    }
  }

  async lotState(lotId: number): Promise<Raw> {
    const d = await this.execute("GetLotStateQuery", QUERY_LOT_STATE, { lotId: String(lotId) });
    return d?.lotState ?? {};
  }

  async lotDetails(lotId: number): Promise<Raw> {
    const d = await this.execute("GetLotDetails", QUERY_LOT_DETAILS, { lotId: String(lotId), countAsView: false });
    return d?.lot?.lot ?? {};
  }

  async categoryTree(category: number | null = null): Promise<Raw[]> {
    const d = await this.execute("CategoryTree", QUERY_CATEGORY_TREE, { category });
    return d?.categoryTree ?? [];
  }
}

// ----------------------------------------------------------------------------- normalisation

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function premiumRate(auction: Raw, fallback: number): number {
  let rate = num(auction?.buyerPremiumRate);
  if (rate === null) {
    const m = /(\d+(?:\.\d+)?)\s*%/.exec(String(auction?.buyerPremium ?? ""));
    rate = m ? Number(m[1]) : null;
  }
  if (rate === null) return fallback;
  return rate > 1 ? rate / 100 : rate;
}

export function slugify(text: string): string {
  const s = (text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return s.slice(0, 80) || "lot";
}

export function normalizeLot(raw: Raw, fetchedAt: number, site: string, defaultPremium: number): Lot {
  const st = raw.lotState ?? {};
  const au = raw.auction ?? {};
  const cat = raw.category ?? {};
  const pic = raw.featuredPicture ?? {};
  const auctioneer = au.auctioneer ?? {};
  const timeLeft = num(st.timeLeftSeconds);
  const id = Number(raw.id);
  const title = String(raw.lead ?? "").trim();
  const fullCat: string = cat.fullCategory || cat.categoryName || "Uncategorized";
  const topCat = fullCat.split(" > ")[0].split("/")[0].trim() || "Uncategorized";
  return {
    id,
    item_id: raw.itemId ?? null,
    lot_number: raw.lotNumber ?? null,
    title,
    description: String(raw.description ?? "").trim(),
    estimate: raw.estimate ?? "",
    quantity: num(raw.quantity) ?? 1,
    bid_amount_type: au.bidAmountType ?? null,
    image: pic.hdThumbnailLocation || pic.thumbnailLocation || pic.fullSizeLocation || null,
    image_full: pic.fullSizeLocation ?? null,
    picture_count: raw.pictureCount ?? null,
    shipping_offered: !!raw.shippingOffered,
    url: `${site}/lot/${id}/${slugify(title)}`,
    auction_id: au.id ?? null,
    auction_name: au.eventName ?? null,
    auction_url: au.id ? `${site}/catalog/${au.id}/${slugify(au.eventName ?? "")}` : null,
    auctioneer: auctioneer.name ?? null,
    auctioneer_id: auctioneer.id ?? null,
    city: au.eventCity ?? null,
    state: au.eventState ?? null,
    zip: au.eventZip ?? null,
    distance_miles: num(au.distanceMiles),
    buyer_premium_rate: premiumRate(au, defaultPremium),
    buyer_premium_text: au.buyerPremium ?? null,
    currency: au.currencyAbbreviation || "USD",
    bid_close: au.bidCloseDateTime ?? null,
    bid_type: au.bidType ?? null,
    high_bid: num(st.highBid) ?? 0,
    min_bid: num(st.minBid),
    bid_count: Math.trunc(num(st.bidCount) ?? 0),
    time_left_seconds: timeLeft,
    time_left_text: st.timeLeft ?? null,
    ends_at: timeLeft === null ? null : fetchedAt + timeLeft,
    is_closed: !!st.isClosed,
    is_live: !!st.isLive,
    status: st.status ?? null,
    reserve_satisfied: st.reserveSatisfied ?? null,
    soft_close_minutes: st.softCloseMinutes ?? null,
    category_id: cat.id ?? null,
    category: topCat,
    category_path: fullCat,
    fetched_at: fetchedAt,
  };
}

export function applyState(lot: Lot, state: Raw, fetchedAt: number): Lot {
  const timeLeft = num(state.timeLeftSeconds);
  return {
    ...lot,
    high_bid: num(state.highBid) ?? 0,
    min_bid: num(state.minBid),
    bid_count: Math.trunc(num(state.bidCount) ?? 0),
    time_left_seconds: timeLeft,
    time_left_text: state.timeLeft ?? null,
    ends_at: timeLeft === null ? lot.ends_at : fetchedAt + timeLeft,
    is_closed: !!state.isClosed,
    is_live: !!state.isLive,
    status: state.status ?? null,
    reserve_satisfied: state.reserveSatisfied ?? null,
    fetched_at: fetchedAt,
  };
}
