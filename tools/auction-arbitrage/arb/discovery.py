"""Thesis discovery -- mining recent eBay sold data for niches worth hunting.

The rest of the system reacts to lots. This is the part that goes looking. One Claude call with web
search returns a batch of theses, each backed by an actual sold-listings search rather than a hunch,
and the same call is reused to REFRESH an existing thesis whose numbers have gone stale.

What makes a niche good is a conjunction, and all five parts matter:

    1. It sells for real money            median $20-$120, because under $20 fees and the hour eat it
    2. It sells FAST                      high sell-through, days-to-sell under a month
    3. It is worthless to the auctioneer  it goes in a $1 box lot, unlisted and undescribed
    4. It is cheap and safe to ship       flat, light, hard to break
    5. It is identifiable from a photo    a mark, an imprint, a shape you can name

The fifth is the one people forget. A niche the appraiser cannot recognise in a blurry auction
thumbnail is a niche this tool cannot hunt, however good the economics look on paper.

Mirrors lib/spread/discovery.ts.
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any

from .config import Settings

log = logging.getLogger(__name__)

SYSTEM = """You are a resale market analyst who finds repeatable arbitrage niches for a flipper who buys
from small-town estate and consignment auctions (HiBid) and resells on eBay.

You are looking for NICHES, not individual items: a describable class of object that recurs, that has a
steady collector market, and that auctioneers routinely undervalue. For each one you must ground the
numbers in actual eBay searches, not memory. Search eBay sold/completed listings, read the result counts,
and report what you actually saw.

A good niche satisfies ALL of these:
1. SELLS FOR REAL MONEY. Median sold price roughly $20-$150. Below $20 the eBay fees and the handling
   hour eat the trade; far above it the auction crowd has usually already noticed.
2. SELLS FAST. High sell-through (sold vs. active), median days-to-sell under about 30. A niche that
   pays $200 in nine months is worse than one that pays $30 in a week.
3. IS CHEAP AT AUCTION. It goes into a box lot, a smalls tray or a "misc" lot, typically $1-$10, because
   the auctioneer has no reason to catalogue it individually.
4. SHIPS CHEAPLY AND SAFELY. Flat, light, robust. Anything fragile, bulky or freight-only is out.
5. IS IDENTIFIABLE FROM A PHOTO. A named imprint, a maker's mark, a distinctive silhouette. If you could
   not recognise it in a mediocre auction thumbnail, it does not qualify however good the economics are.

Strongly favour: small printed-and-stamped advertising (letter openers, blotters, pocket mirrors,
thermometers, rulers, paperweights, pinbacks); bank, insurance and financial memorabilia (still banks,
obsolete notes and scrip, stock and bond certificates, passbooks, bank giveaways); town-specific and
trade-specific ephemera; fraternal and society material; railroadiana and other industrial smalls.
These have the right profile: invisible to the auctioneer, specific to a collector, cheap to post.

Avoid: mainstream electronics, current-production goods, clothing, furniture, anything needing testing or
authentication to sell, and anything where reproductions dominate the market so heavily that a photo
cannot settle it.

For every niche report the real numbers you found:
- sold_90d: how many comparable items SOLD in the last 90 days (read the sold result count)
- active_now: how many are listed right now (read the active result count)
- price_p25 / price_median / price_p75 across the sold results
- median_days_to_sell where the data supports it
- ship_cost: realistic domestic cost to post one
Use -1 for anything you genuinely could not determine. Never invent a count.

Also give the hunting instructions: search queries an auction site would match, "must_any" keyword phrases
to detect the thing in a lot title, "negative" phrases that mean it is the wrong thing (reproduction,
modern, a homonym), and "tells" -- what to look for in the photo to separate the $60 example from the $6
one. Be concrete and specific; "look for quality" is useless."""

_THESIS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "name": {"type": "string", "description": "short niche name, e.g. 'Advertising letter openers'"},
        "family": {"type": "string", "description": "grouping, e.g. 'Advertising ephemera'"},
        "queries": {"type": "array", "items": {"type": "string"}, "description": "2-4 search strings for an auction site"},
        "must_any": {"type": "array", "items": {"type": "string"}, "description": "phrases that identify it in a lot title"},
        "negative": {"type": "array", "items": {"type": "string"}, "description": "phrases meaning the wrong thing"},
        "must_all": {"type": "array", "items": {"type": "string"}, "description": "phrases that must all appear; usually empty"},
        "sold_90d": {"type": "integer", "description": "comparable items SOLD on eBay in the last 90 days; -1 if unknown"},
        "active_now": {"type": "integer", "description": "comparable items listed right now; -1 if unknown"},
        "price_p25": {"type": "number", "description": "-1 if unknown"},
        "price_median": {"type": "number", "description": "-1 if unknown"},
        "price_p75": {"type": "number", "description": "-1 if unknown"},
        "median_days_to_sell": {"type": "number", "description": "-1 if unknown"},
        "ship_cost": {"type": "number", "description": "realistic domestic postage plus packaging, USD"},
        "ebay_category": {"type": "string"},
        "trend": {"type": "string", "enum": ["rising", "flat", "falling", "unknown"]},
        "seasonality": {"type": "string"},
        "typical_auction_price": {"type": "number", "description": "what one usually costs in a box lot, USD"},
        "rationale": {"type": "string", "description": "why this is mispriced at auction and who buys it"},
        "tells": {"type": "array", "items": {"type": "string"}, "description": "what to look for in a photo"},
        "risks": {"type": "array", "items": {"type": "string"}},
        "sources": {"type": "array", "items": {"type": "string"}, "description": "the searches/URLs behind the numbers"},
        "confidence": {"type": "number", "description": "0-1 that the numbers above are right"},
    },
    "required": ["name", "family", "queries", "must_any", "negative", "must_all", "sold_90d", "active_now",
                 "price_p25", "price_median", "price_p75", "median_days_to_sell", "ship_cost", "ebay_category",
                 "trend", "seasonality", "typical_auction_price", "rationale", "tells", "risks", "sources",
                 "confidence"],
    "additionalProperties": False,
}

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"theses": {"type": "array", "items": _THESIS_SCHEMA}},
    "required": ["theses"],
    "additionalProperties": False,
}


def _num(v: Any) -> float | None:
    """-1 and friends mean 'did not determine'. They must stay None, never become 0."""
    if v is None or v == "":
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f >= 0 else None


def _to_raw(d: dict[str, Any], now: float) -> dict[str, Any] | None:
    name = str(d.get("name") or "").strip()
    if not name:
        return None
    arr = lambda k: [str(x) for x in d.get(k, [])] if isinstance(d.get(k), list) else []  # noqa: E731
    trend = d.get("trend")
    return {
        "name": name, "family": str(d.get("family") or "Other"),
        "queries": arr("queries"), "must_any": arr("must_any"), "negative": arr("negative"),
        "must_all": arr("must_all"),
        "sold_90d": _num(d.get("sold_90d")), "active_now": _num(d.get("active_now")),
        "price_p25": _num(d.get("price_p25")), "price_median": _num(d.get("price_median")),
        "price_p75": _num(d.get("price_p75")),
        "median_days_to_sell": _num(d.get("median_days_to_sell")),
        "ship_cost": _num(d.get("ship_cost")) if _num(d.get("ship_cost")) is not None else 5.0,
        "ebay_category": str(d.get("ebay_category") or ""),
        "trend": trend if trend in ("rising", "flat", "falling") else "unknown",
        "seasonality": str(d.get("seasonality") or ""),
        "typical_auction_price": _num(d.get("typical_auction_price")),
        "rationale": str(d.get("rationale") or ""),
        "tells": arr("tells"), "risks": arr("risks"), "sources": arr("sources"),
        "confidence": max(0.0, min(1.0, float(d.get("confidence") or 0.4))),
        "origin": "discovered", "researched_at": now,
    }


class ThesisResearcher:
    def __init__(self, model: str = "claude-opus-5", *, web_search: bool = True, max_searches: int = 12):
        import anthropic  # lazily, so the tool runs without the SDK when Claude is disabled

        self.client = anthropic.Anthropic()
        self.model = model
        self.web_search = web_search
        self.max_searches = max_searches

    def _ask(self, prompt: str, max_searches: int) -> dict[str, Any]:
        messages: list[dict[str, Any]] = [{"role": "user", "content": prompt}]

        def call():
            kwargs: dict[str, Any] = dict(
                model=self.model, max_tokens=16000,
                system=[{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
                messages=messages,
                output_config={"effort": "high", "format": {"type": "json_schema", "schema": SCHEMA}},
            )
            if self.web_search:
                kwargs["tools"] = [{"type": "web_search_20260209", "name": "web_search", "max_uses": max_searches}]
            return self.client.messages.create(**kwargs)

        resp = call()
        # Research runs long: allow more pause_turn resumes than a single-item appraisal does.
        for _ in range(8):
            if resp.stop_reason != "pause_turn":
                break
            messages.append({"role": "assistant", "content": resp.content})
            resp = call()
        if resp.stop_reason == "refusal":
            raise RuntimeError("model declined")
        text = next((b.text for b in resp.content if b.type == "text"), "")
        return json.loads(text)

    def discover(self, count: int, avoid: list[str], focus: str, now: float | None = None) -> list[dict[str, Any]]:
        """Find new niches. `avoid` are names already in the playbook; `focus` steers the search."""
        now = now or time.time()
        parts = [f"Find {count} resale niches that satisfy all five criteria. Research each one with real "
                 "eBay sold-listing searches and report the counts and prices you actually see."]
        if focus:
            parts.append(f"Focus especially on: {focus}")
        if avoid:
            parts.append("Already covered, do NOT repeat these (find adjacent or different niches instead):\n- "
                         + "\n- ".join(avoid))
        parts.append(f"Spend your searches on the numbers, not the prose. It is better to return "
                     f"{max(3, count // 2)} niches with real counts than {count} with guesses.")
        data = self._ask("\n\n".join(parts), self.max_searches)
        rows = data.get("theses") if isinstance(data.get("theses"), list) else []
        return [r for r in (_to_raw(x, now) for x in rows) if r]

    def refresh(self, theses: list[dict[str, Any]], now: float | None = None) -> list[dict[str, Any]]:
        """Re-measure niches we already hunt, anchored to their existing names."""
        now = now or time.time()
        listing = "\n".join(f"- {t['name']} (search: {' / '.join(t.get('queries', [])[:2])})" for t in theses)
        prompt = ("Re-measure these niches against eBay sold listings as they stand TODAY. Keep each name "
                  "exactly as given so the results can be matched up. Update the counts, prices, days-to-sell "
                  "and trend; correct the queries, must_any, negative and tells if you can improve them.\n\n"
                  + listing)
        data = self._ask(prompt, max(6, len(theses) * 2))
        rows = data.get("theses") if isinstance(data.get("theses"), list) else []
        return [r for r in (_to_raw(x, now) for x in rows) if r]


def researcher_for(s: Settings) -> ThesisResearcher | None:
    import os

    if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
        return None
    if s.valuer not in ("auto", "claude"):
        return None
    try:
        return ThesisResearcher(s.model, web_search=s.web_search)
    except Exception as e:  # the SDK may not be installed
        log.warning("thesis researcher unavailable: %s", e)
        return None


def stale_theses(theses: list[dict[str, Any]], s: Settings, now: float | None = None) -> list[dict[str, Any]]:
    """Theses whose research has gone stale (or never happened), oldest first."""
    now = now or time.time()
    cutoff = now - s.research_ttl_days * 86400
    rows = [t for t in theses if t.get("enabled", True)
            and (t.get("researched_at") is None or t["researched_at"] < cutoff)]
    rows.sort(key=lambda t: t.get("researched_at") or 0)
    return rows
