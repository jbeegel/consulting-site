"""Independent valuation with Claude + server-side web search.

One request per lot. Claude identifies the item, searches for recent sold comps, and returns a
structured appraisal (range, confidence, comps with URLs, value drivers, risks). The lot's current
bid is deliberately NOT shown to the model so the estimate can't anchor on it.
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any

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
- Report prices in USD. Never exceed 3 web searches per item; stop early when you have 3+ solid comps."""

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
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
                 "authenticity_risk", "search_query"],
    "additionalProperties": False,
}


def _lot_prompt(lot: dict[str, Any], comps: list[Comp]) -> str:
    desc = (lot.get("description") or "").strip()
    if len(desc) > 2500:
        desc = desc[:2500] + " …"
    parts = [
        "Appraise this online-auction lot for resale.",
        f"Title: {lot.get('title', '')}",
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


class ClaudeValuer:
    def __init__(self, model: str = "claude-opus-5", *, web_search: bool = True, max_searches: int = 3,
                 effort: str = "medium"):
        import anthropic  # imported lazily so the tool runs without the SDK when Claude is disabled

        self._anthropic = anthropic
        self.client = anthropic.Anthropic()
        self.model = model
        self.web_search = web_search
        self.max_searches = max_searches
        self.effort = effort

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
        messages: list[dict[str, Any]] = [{"role": "user", "content": _lot_prompt(lot, comps)}]
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
        v.method = "claude+web" if (self.web_search and searched) else "claude"
        v.sources_consulted = sorted({(c.get("source") or "").strip() for c in v.comps if c.get("source")})
        v.created_at = time.time()
        return v
