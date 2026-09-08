"""HiBid data client.

HiBid has no public/documented API, but the site itself is an Angular app that talks to an
Apollo GraphQL endpoint at https://hibid.com/graphql (POST, JSON, no auth needed for reads).
The queries below are the ones the site's own bundle sends (operation names LotSearch,
GetLotDetails, GetLotStateQuery, CategoryTree), trimmed to the fields we use.

Be a polite guest: one request at a time, a short delay between pages, and a real user agent.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from typing import Any, Iterator

import httpx

log = logging.getLogger(__name__)

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/128.0 Safari/537.36 auction-arbitrage/0.1 (personal research tool)"
)

# ---------------------------------------------------------------------------
# GraphQL documents (mirrors hibid.com PWA 1.22.0)
# ---------------------------------------------------------------------------

FRAGMENT_LOT_STATE = """
fragment lotState on LotState {
  bidCount biddingExtended bidMax buyNow choiceType highBid isArchived isClosed isHidden
  isLive isNotYetLive isOnLiveCatalog isPosted minBid priceRealized priceRealizedMessage
  productStatus quantitySold reserveSatisfied sealed showReserveStatus softCloseMinutes
  softCloseSeconds status timeLeft timeLeftLead timeLeftSeconds timeLeftTitle
  timeLeftWithLimboSeconds
}
"""

FRAGMENT_AUCTION_MIN = """
fragment auctionMinimum on Auction {
  id eventName eventAddress eventCity eventState eventZip eventDateBegin eventDateEnd
  eventDateInfo bidOpenDateTime bidCloseDateTime bidType buyerPremium buyerPremiumRate
  showBuyerPremium currencyAbbreviation lotCount hidden sourceType distanceMiles
  bidAmountType
  auctioneer { id name city state phone email internetAddress }
  auctionOptions { bidding catalog liveCatalog shippingType preview webcast useLotNumber }
  auctionState { auctionStatus openLotCount timeToOpen }
  bidIncrements { minBidIncrement upToAmount }
}
"""

QUERY_LOT_SEARCH = """
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
      results {
        id itemId lotNumber lead description estimate bidAmount bidQuantity quantity ringNumber
        shippingOffered pictureCount
        featuredPicture { description fullSizeLocation hdThumbnailLocation thumbnailLocation }
        category { id baseCategoryId parentCategoryId categoryName fullCategory uRLPath }
        lotState { ...lotState }
        auction { ...auctionMinimum }
      }
    }
  }
}
""" + FRAGMENT_LOT_STATE + FRAGMENT_AUCTION_MIN

QUERY_LOT_STATE = """
query GetLotStateQuery($lotId: ID!) {
  lotState(input: $lotId) { ...lotState }
}
""" + FRAGMENT_LOT_STATE

QUERY_LOT_DETAILS = """
query GetLotDetails($lotId: ID!, $countAsView: Boolean = false) {
  lot(input: $lotId, countAsView: $countAsView) {
    accessability
    lot {
      id itemId lotNumber lead description estimate bidAmount bidQuantity quantity ringNumber
      shippingOffered pictureCount saleOrder
      featuredPicture { description fullSizeLocation hdThumbnailLocation thumbnailLocation }
      pictures { description fullSizeLocation hdThumbnailLocation thumbnailLocation }
      category { id baseCategoryId parentCategoryId categoryName fullCategory uRLPath }
      lotState { ...lotState }
      auction { ...auctionMinimum termsAndConditions shippingAndPickupInfo paymentInfo }
    }
  }
}
""" + FRAGMENT_LOT_STATE + FRAGMENT_AUCTION_MIN

QUERY_CATEGORY_TREE = """
query CategoryTree($category: CategoryId = null) {
  categoryTree(input: {category: $category}) {
    id parentCategoryId baseCategoryId categoryName fullCategory hasChildren uRLPath
    children { id parentCategoryId categoryName fullCategory hasChildren uRLPath }
  }
}
"""

# Enum values observed in the site bundle
LOT_STATUSES = ("ALL", "UPCOMING", "OPEN", "CLOSING_TODAY", "LIVE", "HOT", "CLOSED")
SORT_ORDERS = (
    "TIME_LEFT", "HOT_RANK", "BID_AMOUNT_HIGH_TO_LOW", "BID_AMOUNT_LOW_TO_HIGH",
    "BID_COUNT_HIGH_TO_LOW", "BID_COUNT_LOW_TO_HIGH", "DISTANCE_NEAREST", "LAST_BID",
    "LOT_NUMBER", "NEWLY_ADDED", "NO_ORDER", "PENDING_BIDS", "SALE_ORDER",
    "VIEW_COUNT_HIGH_TO_LOW", "WATCH_COUNT_HIGH_TO_LOW",
)
LOT_FILTERS = ("ALL", "ABSENTEE", "BIDDABLE", "LISTING", "ONLINE", "WEBCAST")


class HiBidError(RuntimeError):
    pass


@dataclass
class Page:
    results: list[dict[str, Any]]
    page_number: int
    page_length: int
    total_count: int
    filtered_count: int

    @property
    def has_more(self) -> bool:
        return self.page_number * self.page_length < self.filtered_count and bool(self.results)


class HiBidClient:
    def __init__(self, graphql_url: str = "https://hibid.com/graphql", *, site_url: str = "https://hibid.com",
                 delay: float = 0.6, timeout: float = 40.0, max_retries: int = 3):
        self.url = graphql_url
        self.site_url = site_url.rstrip("/")
        self.delay = delay
        self.max_retries = max_retries
        self._last_request = 0.0
        self._http = httpx.Client(
            timeout=timeout,
            headers={
                "content-type": "application/json",
                "accept": "*/*",
                "user-agent": USER_AGENT,
                "origin": self.site_url,
                "referer": self.site_url + "/lots",
                "apollographql-client-name": "hibid-pwa",
            },
            follow_redirects=True,
        )

    # ------------------------------------------------------------------ core
    def _throttle(self) -> None:
        wait = self.delay - (time.monotonic() - self._last_request)
        if wait > 0:
            time.sleep(wait)
        self._last_request = time.monotonic()

    def execute(self, operation: str, query: str, variables: dict[str, Any]) -> dict[str, Any]:
        body = {"operationName": operation, "variables": variables, "query": query}
        err: Exception | None = None
        for attempt in range(self.max_retries):
            self._throttle()
            try:
                r = self._http.post(self.url, content=json.dumps(body))
                if r.status_code in (429, 502, 503, 504):
                    raise HiBidError(f"HTTP {r.status_code} from HiBid")
                r.raise_for_status()
                payload = r.json()
            except (httpx.HTTPError, HiBidError, ValueError) as e:  # network / rate limit / bad JSON
                err = e
                sleep = 2 ** attempt
                log.warning("hibid %s attempt %d failed: %s (retry in %ss)", operation, attempt + 1, e, sleep)
                time.sleep(sleep)
                continue
            if payload.get("errors") and not payload.get("data"):
                raise HiBidError(f"{operation}: {payload['errors'][0].get('message', payload['errors'])}")
            if payload.get("errors"):
                log.warning("hibid %s partial errors: %s", operation, payload["errors"][:2])
            return payload.get("data") or {}
        raise HiBidError(f"{operation} failed after {self.max_retries} attempts: {err}")

    # --------------------------------------------------------------- queries
    def search_lots(self, *, page: int = 1, page_length: int = 100, status: str = "OPEN",
                    sort: str = "TIME_LEFT", sort_direction: str = "DESC", category: int | None = None,
                    search_text: str | None = None, zip: str | None = None, miles: int | None = None,
                    country: str | None = None, state: str | None = None, shipping_offered: bool = False,
                    auction_id: int | None = None, lot_filter: str | None = None) -> Page:
        variables = {
            "pageNumber": page, "pageLength": page_length, "status": status, "sortOrder": sort,
            "sortDirection": sort_direction, "category": category, "searchText": search_text or None,
            "zip": zip or None, "miles": miles if zip else None, "countryName": country or None,
            "state": state or None, "shippingOffered": bool(shipping_offered), "auctionId": auction_id,
            "filter": lot_filter, "countAsView": False, "hideGoogle": False, "isArchive": False,
        }
        data = self.execute("LotSearch", QUERY_LOT_SEARCH, variables)
        paged = (data.get("lotSearch") or {}).get("pagedResults") or {}
        return Page(
            results=paged.get("results") or [],
            page_number=paged.get("pageNumber") or page,
            page_length=paged.get("pageLength") or page_length,
            total_count=paged.get("totalCount") or 0,
            filtered_count=paged.get("filteredCount") or 0,
        )

    def iter_lots(self, *, max_pages: int = 20, page_length: int = 100, **kwargs) -> Iterator[dict[str, Any]]:
        """Yield raw lot dicts across pages."""
        for page in range(1, max_pages + 1):
            p = self.search_lots(page=page, page_length=page_length, **kwargs)
            log.info("lotSearch page %d/%s -> %d lots (filtered=%d)", page,
                     max(1, -(-p.filtered_count // page_length)) if p.filtered_count else "?",
                     len(p.results), p.filtered_count)
            yield from p.results
            if not p.has_more:
                break

    def lot_state(self, lot_id: int) -> dict[str, Any]:
        data = self.execute("GetLotStateQuery", QUERY_LOT_STATE, {"lotId": str(lot_id)})
        return data.get("lotState") or {}

    def lot_details(self, lot_id: int) -> dict[str, Any]:
        data = self.execute("GetLotDetails", QUERY_LOT_DETAILS, {"lotId": str(lot_id), "countAsView": False})
        return ((data.get("lot") or {}).get("lot")) or {}

    def category_tree(self, category: int | None = None) -> list[dict[str, Any]]:
        data = self.execute("CategoryTree", QUERY_CATEGORY_TREE, {"category": category})
        return data.get("categoryTree") or []

    def close(self) -> None:
        self._http.close()


# ---------------------------------------------------------------------------
# Normalisation: raw GraphQL lot -> flat dict the rest of the tool uses
# ---------------------------------------------------------------------------

def _num(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _premium_rate(auction: dict[str, Any], default: float) -> float:
    rate = _num(auction.get("buyerPremiumRate"))
    if rate is None:
        # buyerPremium is free text, e.g. "15%" or "15% Buyer's Premium"
        import re
        m = re.search(r"(\d+(?:\.\d+)?)\s*%", str(auction.get("buyerPremium") or ""))
        rate = float(m.group(1)) if m else None
    if rate is None:
        return default
    return rate / 100.0 if rate > 1.0 else rate


def slugify(text: str) -> str:
    import re
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return s[:80] or "lot"


def normalize_lot(raw: dict[str, Any], *, fetched_at: float, site_url: str = "https://hibid.com",
                  default_premium: float = 0.15) -> dict[str, Any]:
    st = raw.get("lotState") or {}
    au = raw.get("auction") or {}
    cat = raw.get("category") or {}
    pic = raw.get("featuredPicture") or {}
    auctioneer = au.get("auctioneer") or {}
    time_left = _num(st.get("timeLeftSeconds"))
    lot_id = int(raw["id"])
    title = (raw.get("lead") or "").strip()
    high_bid = _num(st.get("highBid")) or 0.0
    min_bid = _num(st.get("minBid"))
    bid_count = int(_num(st.get("bidCount")) or 0)
    full_cat = cat.get("fullCategory") or cat.get("categoryName") or "Uncategorized"
    top_cat = full_cat.split(" > ")[0].split("/")[0].strip() if full_cat else "Uncategorized"
    return {
        "id": lot_id,
        "item_id": raw.get("itemId"),
        "lot_number": raw.get("lotNumber"),
        "title": title,
        "description": (raw.get("description") or "").strip(),
        "estimate": raw.get("estimate") or "",
        "quantity": _num(raw.get("quantity")) or 1,
        "bid_amount_type": au.get("bidAmountType"),
        "image": pic.get("hdThumbnailLocation") or pic.get("thumbnailLocation") or pic.get("fullSizeLocation"),
        "image_full": pic.get("fullSizeLocation"),
        "picture_count": raw.get("pictureCount"),
        "shipping_offered": bool(raw.get("shippingOffered")),
        "url": f"{site_url}/lot/{lot_id}/{slugify(title)}",
        # auction
        "auction_id": au.get("id"),
        "auction_name": au.get("eventName"),
        "auction_url": f"{site_url}/catalog/{au.get('id')}/{slugify(au.get('eventName') or '')}" if au.get("id") else None,
        "auctioneer": auctioneer.get("name"),
        "auctioneer_id": auctioneer.get("id"),
        "city": au.get("eventCity"),
        "state": au.get("eventState"),
        "zip": au.get("eventZip"),
        "distance_miles": _num(au.get("distanceMiles")),
        "buyer_premium_rate": _premium_rate(au, default_premium),
        "buyer_premium_text": au.get("buyerPremium"),
        "currency": au.get("currencyAbbreviation") or "USD",
        "bid_close": au.get("bidCloseDateTime"),
        "bid_type": au.get("bidType"),
        # live state
        "high_bid": high_bid,
        "min_bid": min_bid,
        "bid_count": bid_count,
        "time_left_seconds": time_left,
        "time_left_text": st.get("timeLeft"),
        "ends_at": (fetched_at + time_left) if time_left is not None else None,
        "is_closed": bool(st.get("isClosed")),
        "is_live": bool(st.get("isLive")),
        "status": st.get("status"),
        "reserve_satisfied": st.get("reserveSatisfied"),
        "soft_close_minutes": st.get("softCloseMinutes"),
        # category
        "category_id": cat.get("id"),
        "category": top_cat,
        "category_path": full_cat,
        "fetched_at": fetched_at,
    }


def apply_state(lot: dict[str, Any], state: dict[str, Any], fetched_at: float) -> dict[str, Any]:
    """Merge a fresh GetLotStateQuery result into a normalized lot."""
    time_left = _num(state.get("timeLeftSeconds"))
    lot = dict(lot)
    lot.update({
        "high_bid": _num(state.get("highBid")) or 0.0,
        "min_bid": _num(state.get("minBid")),
        "bid_count": int(_num(state.get("bidCount")) or 0),
        "time_left_seconds": time_left,
        "time_left_text": state.get("timeLeft"),
        "ends_at": (fetched_at + time_left) if time_left is not None else lot.get("ends_at"),
        "is_closed": bool(state.get("isClosed")),
        "is_live": bool(state.get("isLive")),
        "status": state.get("status"),
        "reserve_satisfied": state.get("reserveSatisfied"),
        "fetched_at": fetched_at,
    })
    return lot
