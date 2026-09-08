"""Independent valuation with Claude + server-side web search.

One request per lot. Claude identifies the item, searches for recent sold comps, and returns a
structured appraisal (range, confidence, comps with URLs, value drivers, risks). The lot's current
bid is deliberately NOT shown to the model so the estimate can't anchor on it.
"""
from __future__ import annotations

import base64
import json
import logging
import time
from typing import Any

import httpx

from .base import Comp, Valuation, title_key

log = logging.getLogger(__name__)

SYSTEM = """You are a veteran secondary-market appraiser and reseller (eBay power seller, estate liquidator,
pawn-shop valuation experience). You estimate what an item from an online auction lot would realistically
NET-SELL for on the open resale market in the next 30 days, based on evidence, not wishful thinking.

Rules:
- Identify the item precisely (brand, model, generation, size, variant). If the lot is vague, say what
  you assumed and lower confidence.
- Prefer SOLD/completed prices (eBay sold listings, auction results, Facebook Marketplace sold, Reverb,
  WorthPoint, Chrono24 sold, etc.) over asking prices. Note the source of every comp.
- Assume used/good condition unless the listing says otherwise; auction photos often hide flaws.
- For bulk lots, value the lot as a whole (what one buyer would pay), not the retail sum of parts.
- Flag authenticity risk for luxury brands, precious metals/coins, autographs, designer goods.
- Be conservative on obscure items, art, and collectibles; be precise on commodity electronics/tools.
- PHOTOS ARE THE EVIDENCE. Auction titles are often useless ("vintage knic knacs"); the value hides in a
  backstamp, a signature, a label, a pattern, or one piece among ten. Study every photo: read maker's marks,
  country-of-origin stamps, model numbers, hallmarks, edition numbers. For multi-item lots identify EACH
  distinct item, value each one, name the standout piece, and make the lot range the realistic total a
  reseller would net selling the good pieces individually and the rest as a group.
- Report prices in USD. Never exceed 3 web searches per item; stop early when you have 3+ solid comps.
- Also draft the eBay listing you would post, with three price points (quick sale = around the 25th
  percentile of sold comps, market = median, patient = 75th percentile), a best-offer floor, and a shipping
  estimate (weight class and packaging).
- The eBay listing must be written for eBay's search ranking (Best Match), not for a human editor:
  * TITLE (max 80 chars): front-load the highest-volume search terms buyers actually type (brand/maker,
    what it is, model/pattern, era, size, color, material, country). Use all 80 characters when possible.
    No filler ("L@@K", "WOW", "RARE!!" unless the item is verifiably rare), no punctuation runs, no ALL CAPS.
    Give two alternate titles that target different search phrasings.
  * CATEGORY: the leaf category where the sold comps actually live (browse the comps' categories).
  * ITEM SPECIFICS: fill every specific buyers filter on in that category (Brand, Type, Material, Color,
    Era/Decade, Country/Region of Manufacture, Original/Reproduction, Theme, Pattern, Style, Size, Features,
    Occasion, Character, Franchise, Set, Year, Model, MPN/UPC when known). Unfilled specifics cost ranking.
  * CONDITION: the eBay condition value, plus a one-line condition description that names every flaw.
  * DESCRIPTION: 4-8 short sentences; repeat the key terms naturally; what it is, marks, measurements,
    condition, what is included, shipping/handling promise. No walls of text, no HTML tricks.
  * PRICE/FORMAT: fixed price with Best Offer for items with steady sold comps; 7-day auction ending
    Sunday evening for scarce/collector items with bidding competition. Price at the comps, not at hope.
  * PHOTOS: list the exact shots to take (front, back, base/backstamp, close-up of marks, any damage, scale).
  * PROMOTED LISTINGS: suggest an ad rate (0 for commodity items with many sellers, 2-5% for competitive
    categories) and the best day/time to list."""

LISTING_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "title": {"type": "string", "description": "eBay title, max 80 characters"},
        "category": {"type": "string", "description": "eBay category path, e.g. Collectibles > Decorative Collectibles > Figurines"},
        "condition": {"type": "string", "description": "eBay condition: New, Like New, Very Good, Good, Acceptable, Used, For parts"},
        "item_specifics": {"type": "array", "items": {"type": "object", "properties": {"name": {"type": "string"}, "value": {"type": "string"}}, "required": ["name", "value"], "additionalProperties": False}},
        "description": {"type": "string"},
        "format": {"type": "string", "enum": ["fixed_price", "auction"]},
        "price_quick": {"type": "number"},
        "price_market": {"type": "number"},
        "price_patient": {"type": "number"},
        "best_offer_floor": {"type": "number"},
        "auction_start": {"type": "number", "description": "starting bid if format is auction, else 0"},
        "shipping_weight_oz": {"type": "number"},
        "packaging": {"type": "string", "description": "padded mailer | small box | medium box | large box | freight"},
        "shipping_cost_estimate": {"type": "number", "description": "what it will cost you to ship domestically, USD"},
        "keywords": {"type": "array", "items": {"type": "string"}},
        "alt_titles": {"type": "array", "items": {"type": "string"}, "description": "two alternate 80-char titles targeting other search phrasings"},
        "condition_description": {"type": "string", "description": "one line naming every flaw"},
        "photo_checklist": {"type": "array", "items": {"type": "string"}, "description": "exact shots to take"},
        "seo_notes": {"type": "string", "description": "why these terms/category/specifics rank; what buyers search"},
        "promoted_rate": {"type": "number", "description": "suggested promoted listing ad rate as a fraction, 0 if none"},
        "best_time_to_list": {"type": "string"},
    },
    "required": ["title", "category", "condition", "item_specifics", "description", "format", "price_quick", "price_market",
                 "price_patient", "best_offer_floor", "auction_start", "shipping_weight_oz", "packaging",
                 "shipping_cost_estimate", "keywords", "alt_titles", "condition_description", "photo_checklist",
                 "seo_notes", "promoted_rate", "best_time_to_list"],
    "additionalProperties": False,
}

ITEM_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "name": {"type": "string", "description": "what the item is, precisely"},
        "maker_or_mark": {"type": "string", "description": "maker, backstamp, label or hallmark read from the photos, or 'unmarked'"},
        "era": {"type": "string"},
        "est_low": {"type": "number"},
        "est_high": {"type": "number"},
        "confidence": {"type": "number"},
        "note": {"type": "string", "description": "why it is worth that; condition observations"},
    },
    "required": ["name", "maker_or_mark", "era", "est_low", "est_high", "confidence", "note"],
    "additionalProperties": False,
}

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "items": {"type": "array", "items": ITEM_SCHEMA, "description": "every distinct item identified in the lot (one entry for a single-item lot)"},
        "standout_item": {"type": "string", "description": "the single most valuable item in the lot and why, or empty"},
        "listing": LISTING_SCHEMA,
        "identified_item": {"type": "string"},
        "brand": {"type": "string"},
        "model": {"type": "string"},
        "condition_assumption": {"type": "string"},
        "bulk_lot": {"type": "boolean"},
        "unit_count": {"type": "integer"},
        "resale_low": {"type": "number"},
        "resale_mid": {"type": "number"},
        "resale_high": {"type": "number"},
        "confidence": {"type": "number", "description": "0-1 confidence that resale_mid is within +/-25%"},
        "confidence_reason": {"type": "string"},
        "demand": {"type": "string", "enum": ["high", "medium", "low", "unknown"]},
        "days_to_sell": {"type": "integer"},
        "best_channel": {"type": "string"},
        "value_drivers": {"type": "array", "items": {"type": "string"}},
        "risks": {"type": "array", "items": {"type": "string"}},
        "rationale": {"type": "string"},
        "comps": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "price": {"type": "number"},
                    "source": {"type": "string"},
                    "url": {"type": "string"},
                    "date": {"type": "string"},
                    "note": {"type": "string"},
                },
                "required": ["title", "price", "source", "url", "date", "note"],
                "additionalProperties": False,
            },
        },
        "authenticity_risk": {"type": "boolean"},
        "search_query": {"type": "string", "description": "best eBay sold-listings search string for this item"},
    },
    "required": ["identified_item", "brand", "model", "condition_assumption", "bulk_lot", "unit_count",
                 "resale_low", "resale_mid", "resale_high", "confidence", "confidence_reason", "demand",
                 "days_to_sell", "best_channel", "value_drivers", "risks", "rationale", "comps",
                 "authenticity_risk", "search_query", "listing", "items", "standout_item"],
    "additionalProperties": False,
}


_MAX_IMAGE_BYTES = 4_500_000


def load_images(urls: list[str], max_images: int = 4, timeout: float = 15.0) -> list[dict[str, Any]]:
    """Download lot photos and wrap them as Claude image blocks. Failures are skipped silently."""
    blocks: list[dict[str, Any]] = []
    for url in [u for u in urls if u][:max_images]:
        try:
            r = httpx.get(url, timeout=timeout, follow_redirects=True, headers={"user-agent": "spread-hunter/0.1"})
            if r.status_code != 200 or len(r.content) > _MAX_IMAGE_BYTES:
                continue
            ctype = (r.headers.get("content-type") or "").split(";")[0].strip().lower()
            if ctype not in ("image/jpeg", "image/png", "image/webp", "image/gif"):
                ctype = "image/jpeg" if r.content[:3] == b"\xff\xd8\xff" else "image/png" if r.content[:4] == b"\x89PNG" else "image/webp" if r.content[8:12] == b"WEBP" else ""
                if not ctype:
                    continue
            blocks.append({"type": "image", "source": {"type": "base64", "media_type": ctype, "data": base64.b64encode(r.content).decode()}})
        except (httpx.HTTPError, ValueError) as e:
            log.info("image skipped %s: %s", url, e)
    return blocks


def lot_image_urls(lot: dict[str, Any]) -> list[str]:
    urls = list(lot.get("pictures") or [])
    for u in (lot.get("image_full"), lot.get("image")):
        if u and u not in urls:
            urls.append(u)
    return urls


def _lot_prompt(lot: dict[str, Any], comps: list[Comp]) -> str:
    desc = (lot.get("description") or "").strip()
    if len(desc) > 2500:
        desc = desc[:2500] + " …"
    parts = [
        "Appraise this online-auction lot for resale.",
        f"Title: {lot.get('title', '')}",
        "Note: a leading code like 'G)' is the auctioneer's sort prefix, not part of the item.",
        f"Lot category: {lot.get('category_path') or lot.get('category') or 'unknown'}",
        f"Quantity in lot: {lot.get('quantity') or 1}",
        f"Auctioneer's estimate (may be absent or optimistic): {lot.get('estimate') or 'none'}",
        f"Auction location: {lot.get('city') or ''} {lot.get('state') or ''}".strip(),
        f"Description:\n{desc or '(none)'}",
    ]
    if comps:
        parts.append("Recent eBay SOLD listings we already pulled (verify relevance; some may be the wrong item):")
        for c in comps[:15]:
            parts.append(f"- ${c.price:,.2f} | {c.title} | {c.date} | {c.url}")
    parts.append("Search the web for sold comps if the evidence above is thin or ambiguous, then return the appraisal.")
    return "\n".join(parts)


def _lot_content(lot: dict[str, Any], comps: list[Comp], images: list[dict[str, Any]]) -> Any:
    text = _lot_prompt(lot, comps)
    if not images:
        return text
    return [{"type": "text", "text": f"Photos of the lot ({len(images)} attached). Read every mark and label you can."},
            *images, {"type": "text", "text": text}]


class ClaudeValuer:
    def __init__(self, model: str = "claude-opus-5", *, web_search: bool = True, max_searches: int = 3,
                 effort: str = "medium", vision: bool = True, max_images: int = 4):
        import anthropic  # imported lazily so the tool runs without the SDK when Claude is disabled

        self._anthropic = anthropic
        self.client = anthropic.Anthropic()
        self.model = model
        self.web_search = web_search
        self.max_searches = max_searches
        self.effort = effort
        self.vision = vision
        self.max_images = max_images

    def _request(self, messages: list[dict[str, Any]]):
        kwargs: dict[str, Any] = dict(
            model=self.model,
            max_tokens=8000,
            system=[{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
            messages=messages,
            output_config={"effort": self.effort, "format": {"type": "json_schema", "schema": SCHEMA}},
        )
        if self.web_search:
            kwargs["tools"] = [{"type": "web_search_20260209", "name": "web_search", "max_uses": self.max_searches}]
        return self.client.messages.create(**kwargs)

    def value(self, lot: dict[str, Any], comps: list[Comp] | None = None) -> Valuation:
        comps = comps or []
        v = Valuation(lot_id=lot["id"], title_key=title_key(lot.get("title", ""), lot.get("quantity")),
                      model_used=self.model)
        images = load_images(lot_image_urls(lot), self.max_images) if self.vision else []
        v.images_used = len(images)
        messages: list[dict[str, Any]] = [{"role": "user", "content": _lot_content(lot, comps, images)}]
        try:
            resp = self._request(messages)
            for _ in range(3):  # server tools can pause a long turn; resume it
                if resp.stop_reason != "pause_turn":
                    break
                messages.append({"role": "assistant", "content": resp.content})
                resp = self._request(messages)
            if resp.stop_reason == "refusal":
                v.error = "model declined"
                v.method = "none"
                return v
            text = next((b.text for b in resp.content if b.type == "text"), "")
            searched = [b for b in resp.content if b.type == "web_search_tool_result"]
            data = json.loads(text)
        except (self._anthropic.APIError, ValueError, StopIteration) as e:
            log.warning("claude valuation failed for lot %s: %s", lot.get("id"), e)
            v.error = f"{type(e).__name__}: {e}"[:300]
            v.method = "none"
            return v

        v.identified_item = data.get("identified_item", "")
        v.brand = data.get("brand", "")
        v.model = data.get("model", "")
        v.condition_assumption = data.get("condition_assumption", "")
        v.bulk_lot = bool(data.get("bulk_lot"))
        v.unit_count = int(data.get("unit_count") or 1)
        lo, mid, hi = (float(data.get(k) or 0) for k in ("resale_low", "resale_mid", "resale_high"))
        if mid <= 0:
            v.method = "none"
            v.rationale = data.get("rationale", "")
            return v
        v.low, v.mid, v.high = min(lo, mid), mid, max(hi, mid)
        v.confidence = max(0.0, min(1.0, float(data.get("confidence") or 0)))
        v.confidence_reason = data.get("confidence_reason", "")
        v.demand = data.get("demand", "unknown")
        v.days_to_sell = data.get("days_to_sell")
        v.best_channel = data.get("best_channel", "")
        v.value_drivers = list(data.get("value_drivers") or [])
        v.risks = list(data.get("risks") or [])
        v.rationale = data.get("rationale", "")
        v.comps = [c for c in (data.get("comps") or []) if isinstance(c, dict)]
        for c in comps[:10]:  # keep the raw eBay pulls too, deduped by url
            if not any(x.get("url") == c.url for x in v.comps):
                v.comps.append({"title": c.title, "price": c.price, "source": c.source, "url": c.url,
                                "date": c.date, "note": "raw eBay sold pull"})
        v.authenticity_risk = bool(data.get("authenticity_risk"))
        v.search_query = data.get("search_query", "")
        v.items = [i for i in (data.get("items") or []) if isinstance(i, dict) and i.get("name")]
        v.standout_item = data.get("standout_item", "") or ""
        lst = data.get("listing")
        if isinstance(lst, dict) and lst.get("title"):
            lst["title"] = str(lst["title"])[:80]
            v.listing = lst
        v.method = "claude+web" if (self.web_search and searched) else "claude"
        v.sources_consulted = sorted({(c.get("source") or "").strip() for c in v.comps if c.get("source")})
        v.created_at = time.time()
        return v
