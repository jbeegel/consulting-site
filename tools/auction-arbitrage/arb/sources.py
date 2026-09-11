"""Buying without an auction: local, in-person sources scored against the same playbook.

An auction has a clock and a public price. A local listing has neither -- it sits at a fixed asking
price until someone drives over. That changes the arithmetic (no buyer's premium, no bidding war, but
you spend fuel and an hour) and the urgency model (no close time, only "before someone else messages
them"). What does NOT change is the thesis: an advertising letter opener at $5 on Craigslist is the same
trade as one at $5 on HiBid.

WHAT IS AND IS NOT POSSIBLE HERE, plainly:

    Craigslist  -- publishes RSS for any search. Fetched here, politely and unauthenticated.
    OfferUp     -- no public API. Their terms forbid scraping and the site is bot-protected, so this
                   module does not scrape it. What it does instead: ``parse_pasted_listing`` takes a URL
                   or a pasted block of text from OfferUp, Facebook Marketplace or anywhere else and
                   runs it through the same matching and scoring. Paste a link, get the verdict.
                   Automating it properly needs OfferUp's partner API or a licensed data provider.
    Facebook    -- same position as OfferUp.

So the honest version of "surface local opportunities" is: Craigslist automatically, everything else one
paste at a time, with the door open for a real API when there is one.

Mirrors lib/spread/sources.ts.
"""
from __future__ import annotations

import logging
import math
import re
from typing import Any, Iterable
from urllib.parse import urlparse

import httpx

from .config import Settings
from .playbook import match_theses

log = logging.getLogger(__name__)

_MILES_PER_DEG_LAT = 69.0


def miles_between(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Rough great-circle distance, good to a mile or two at these ranges."""
    d_lat = (b[0] - a[0]) * _MILES_PER_DEG_LAT
    d_lon = (b[1] - a[1]) * _MILES_PER_DEG_LAT * math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot(d_lat, d_lon)


_ENTITIES = {"&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'"}


def _decode(s: str) -> str:
    for k, v in _ENTITIES.items():
        s = s.replace(k, v)
    s = re.sub(r"&#(\d+);", lambda m: chr(int(m.group(1))), s)
    s = re.sub(r"&#x([0-9a-fA-F]+);", lambda m: chr(int(m.group(1), 16)), s)
    return s.replace("&amp;", "&")


def _tag(xml: str, name: str) -> str:
    m = re.search(rf"<{name}[^>]*>(.*?)</{name}>", xml, re.S | re.I)
    if not m:
        return ""
    inner = re.sub(r"<!\[CDATA\[(.*?)\]\]>", r"\1", m.group(1), flags=re.S)
    return _decode(inner).strip()


def parse_price(s: str) -> float | None:
    """First dollar amount in a string, if any."""
    m = re.search(r"\$\s?([\d,]+(?:\.\d{1,2})?)", s or "")
    if not m:
        return None
    try:
        n = float(m.group(1).replace(",", ""))
    except ValueError:
        return None
    return n if n >= 0 else None


def parse_craigslist_rss(xml: str, now: float | None = None) -> list[dict[str, Any]]:
    """Parse a Craigslist search RSS feed. Pure, so it is testable without the network."""
    import time as _t

    now = now or _t.time()
    out: list[dict[str, Any]] = []
    for chunk in re.split(r"<item[\s>]", xml, flags=re.I)[1:]:
        end = chunk.lower().find("</item>")
        body = chunk[:end] if end >= 0 else chunk
        title = _tag(body, "title")
        link = _tag(body, "link")
        if not link:
            m = re.search(r'<link[^>]*rdf:resource="([^"]+)"', body, re.I)
            link = m.group(1) if m else ""
        if not title or not link:
            continue
        desc = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", _tag(body, "description"))).strip()
        date_str = _tag(body, "dc:date") or _tag(body, "pubDate")
        posted = None
        if date_str:
            try:
                from email.utils import parsedate_to_datetime
                posted = parsedate_to_datetime(date_str).timestamp()
            except Exception:
                try:
                    from datetime import datetime
                    posted = datetime.fromisoformat(date_str.replace("Z", "+00:00")).timestamp()
                except Exception:
                    posted = None
        m = re.search(r"/(\d+)\.html", link)
        out.append({
            "source": "craigslist", "external_id": m.group(1) if m else link,
            "title": title, "description": desc,
            "price": parse_price(title) or parse_price(desc),
            "url": link, "image": None, "city": "", "state": "",
            "distance_miles": None, "posted_at": posted, "fetched_at": now,
        })
    return out


def search_craigslist(site: str, query: str, *, max_price: float | None = None,
                      timeout: float = 15.0) -> list[dict[str, Any]]:
    """Search one Craigslist site. Returns [] rather than raising: a quiet local source must never
    take a scan down with it."""
    if not site:
        return []
    params = {"query": query, "format": "rss", "sort": "date"}
    if max_price:
        params["max_price"] = str(int(max_price))
    try:
        r = httpx.get(f"https://{site}.craigslist.org/search/sss", params=params, timeout=timeout,
                      headers={"user-agent": "spread-hunter/0.1 (personal resale research)",
                               "accept": "application/rss+xml, application/xml"})
        if r.status_code != 200:
            log.info("craigslist %s %r -> %s", site, query, r.status_code)
            return []
        return parse_craigslist_rss(r.text)
    except Exception as e:
        log.info("craigslist fetch failed %s %r: %s", site, query, e)
        return []


def parse_pasted_listing(*, url: str = "", text: str = "", price: float | None = None,
                         title: str = "", now: float | None = None) -> dict[str, Any] | None:
    """Turn a pasted listing -- a URL, or title/price/description copied out of an app -- into
    something we can score. This is the supported path for OfferUp and Facebook Marketplace."""
    import time as _t

    now = now or _t.time()
    text = (text or "").strip()
    url = (url or "").strip()
    if not text and not url:
        return None

    source = "pasted"
    if url:
        host = (urlparse(url).hostname or "").replace("www.", "")
        for key in ("offerup", "facebook", "craigslist", "mercari", "ebay"):
            if key in host:
                source = key
                break
        else:
            source = host or "pasted"

    lines = [l.strip() for l in text.split("\n") if l.strip()]
    head = (title or (lines[0] if lines else ""))[:300]
    if not head and not url:
        return None
    return {
        "source": source, "external_id": url or head[:80],
        "title": head or url, "description": " ".join(lines[1:])[:4000],
        "price": price if price is not None else parse_price(text),
        "url": url, "image": None, "city": "", "state": "",
        "distance_miles": None, "posted_at": None, "fetched_at": now,
    }


def score_local(listing: dict[str, Any], theses: list[dict[str, Any]], s: Settings) -> dict[str, Any]:
    """Score a local listing against the playbook.

    No buyer's premium here -- the asking price plus the cost of going to get it IS the landed cost --
    but the trip is real money, so a $3 win 30 miles away is not a win at all.
    """
    matches = match_theses({"title": listing.get("title", ""), "description": listing.get("description", ""),
                            "category_path": ""}, theses)
    # Compare like with like: `max_bid` strips out an auction's buyer's premium, but a local purchase
    # has none -- the asking price plus the trip IS the landed cost -- so judge against `max_landed`.
    ceilings = [m["max_landed"] for m in matches if m.get("max_landed") is not None]
    max_bid = min(ceilings) if ceilings else None
    trip = s.local_trip_cost + (listing.get("distance_miles") or 0) * s.local_cost_per_mile
    price = listing.get("price")
    landed = None if price is None else round(price + trip, 2)

    verdict, note = "unknown", ""
    if not matches:
        note = "Nothing in the playbook matches this."
    elif max_bid is None:
        note = (f"Matches {matches[0]['name']}, but that niche has no researched price yet, "
                "so there is no ceiling to judge against.")
    elif landed is None:
        note = f"Matches {matches[0]['name']} (pay up to about ${round(max_bid)} all-in). No asking price given."
    elif landed <= max_bid:
        verdict = "buy"
        note = (f"{matches[0]['name']}: ${price} plus about ${round(trip)} to collect is inside the "
                f"${round(max_bid)} ceiling.")
    elif landed <= max_bid * 1.6:
        verdict = "negotiate"
        note = (f"{matches[0]['name']}: asking ${price} lands at ${round(landed)}, over the "
                f"${round(max_bid)} ceiling. Offer about ${max(1, int(max_bid - trip))}.")
    else:
        verdict = "pass"
        note = (f"{matches[0]['name']}: ${round(landed)} all-in against a ${round(max_bid)} ceiling. "
                "Not at this price.")
    return {"listing": listing, "theses": matches, "max_landed": max_bid, "landed_cost": landed,
            "verdict": verdict, "note": note}


def hunt_local(theses: Iterable[dict[str, Any]], s: Settings, *, limit_per_query: int = 20) -> list[dict[str, Any]]:
    """Run the playbook's queries against the configured local sources."""
    if not s.local or not s.craigslist_site:
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for t in theses:
        for q in (t.get("queries") or [])[:2]:
            cap = math.ceil(t["max_bid"] * 3) if t.get("max_bid") else None
            for r in search_craigslist(s.craigslist_site, q, max_price=cap)[:limit_per_query]:
                key = f"{r['source']}:{r['external_id']}"
                if key in seen:
                    continue
                seen.add(key)
                out.append(r)
    return out
