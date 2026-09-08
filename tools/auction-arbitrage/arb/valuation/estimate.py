"""Fallback valuer: parse the auctioneer's own estimate text ("$100 - $200")."""
from __future__ import annotations

import re

from .base import Valuation, title_key

_RANGE = re.compile(r"\$?\s*([\d,]+(?:\.\d+)?)\s*(?:-|–|to)\s*\$?\s*([\d,]+(?:\.\d+)?)")
_SINGLE = re.compile(r"\$?\s*([\d,]+(?:\.\d+)?)")


def parse_estimate(text: str) -> tuple[float, float] | None:
    if not text:
        return None
    m = _RANGE.search(text)
    if m:
        lo, hi = float(m.group(1).replace(",", "")), float(m.group(2).replace(",", ""))
        return (min(lo, hi), max(lo, hi)) if hi > 0 else None
    m = _SINGLE.search(text)
    if m:
        v = float(m.group(1).replace(",", ""))
        return (v * 0.8, v * 1.2) if v > 0 else None
    return None


def value_from_estimate(lot: dict) -> Valuation:
    v = Valuation(lot_id=lot["id"], title_key=title_key(lot.get("title", ""), lot.get("quantity")))
    rng = parse_estimate(lot.get("estimate") or "")
    if not rng:
        v.method = "none"
        v.rationale = "No independent valuation available and the auctioneer published no estimate."
        return v
    lo, hi = rng
    v.low, v.high, v.mid = lo, hi, (lo + hi) / 2
    v.method = "hibid_estimate"
    v.confidence = 0.3
    v.confidence_reason = "Auctioneer's own estimate only; not independently verified."
    v.identified_item = lot.get("title", "")
    v.rationale = f"Auctioneer estimate {lot.get('estimate')}. Treat as a rough guide; auction-house estimates skew optimistic."
    v.risks = ["Estimate is from the seller side, not from sold comps."]
    return v
