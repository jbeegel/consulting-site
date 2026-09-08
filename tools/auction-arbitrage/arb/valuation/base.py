from __future__ import annotations

import hashlib
import re
import time
from dataclasses import asdict, dataclass, field
from typing import Any

_STOP = {"lot", "of", "the", "and", "with", "a", "an", "for", "in", "new", "used", "pcs", "pc", "set"}


def title_key(title: str, quantity: float | None = None) -> str:
    """Stable key for 'same item' so identical lots across auctions reuse a valuation."""
    words = re.findall(r"[a-z0-9]+", (title or "").lower())
    words = [w for w in words if w not in _STOP]
    base = " ".join(words)
    if quantity and quantity > 1:
        base += f" x{int(quantity)}"
    return hashlib.sha1(base.encode()).hexdigest()[:16]


@dataclass
class Comp:
    title: str
    price: float
    source: str = ""
    url: str = ""
    date: str = ""
    note: str = ""


@dataclass
class Valuation:
    lot_id: int
    title_key: str
    identified_item: str = ""
    brand: str = ""
    model: str = ""
    low: float | None = None
    mid: float | None = None
    high: float | None = None
    currency: str = "USD"
    confidence: float = 0.0  # 0..1
    confidence_reason: str = ""
    method: str = "none"  # claude+web | claude | ebay_sold | hibid_estimate | none
    demand: str = "unknown"  # high | medium | low | unknown
    days_to_sell: int | None = None
    best_channel: str = ""
    condition_assumption: str = ""
    value_drivers: list[str] = field(default_factory=list)
    risks: list[str] = field(default_factory=list)
    rationale: str = ""
    comps: list[dict[str, Any]] = field(default_factory=list)
    search_query: str = ""
    authenticity_risk: bool = False
    bulk_lot: bool = False
    unit_count: int = 1
    sources_consulted: list[str] = field(default_factory=list)
    model_used: str = ""
    created_at: float = field(default_factory=time.time)
    error: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @property
    def usable(self) -> bool:
        return self.mid is not None and self.mid > 0 and self.method != "none"
