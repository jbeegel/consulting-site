"""The feedback loop: grade past predictions against what actually happened, then bend future
valuations toward reality.

Two tiers of evidence, weakest first:

1. HAMMER PRICES (free, automatic, every closed lot -- even ones you never bid on). HiBid publishes
   ``priceRealized``. A hammer price is not a resale value, so it cannot tell us we were too LOW.
   But it can prove we were too HIGH: if a lot's landed cost at the hammer meets or beats the net
   resale we predicted, then either the winner overpaid or -- far more often across many lots --
   our number was inflated. The share of lots where that happens is the ``overshoot_rate``, and it
   is a provably-wrong rate, not a guess.

2. REAL SALES (ground truth, entered when you actually sell something). actual sale / predicted mid.
   This overrides tier 1 as soon as there is enough of it.

Bias is clamped and needs a minimum sample, so a thin or unlucky week cannot swing the model.
"""
from __future__ import annotations

import statistics
import time
from typing import Any, Iterable

from .config import Settings

GLOBAL = "__all__"


def _median(xs: list[float]) -> float | None:
    return statistics.median(xs) if xs else None


def hammer_ratio(o: dict[str, Any]) -> float | None:
    """Landed cost at the hammer over the net resale we predicted. >= 1 means the deal was never there."""
    lah, net = o.get("landed_at_hammer"), o.get("predicted_net")
    if not lah or not net or net <= 0:
        return None
    return lah / net


def sale_ratio(o: dict[str, Any]) -> float | None:
    """Actual sale price over the mid we predicted. 1.0 is a perfect call."""
    sale, mid = o.get("sale_price"), o.get("predicted_mid")
    if not sale or not mid or mid <= 0:
        return None
    return sale / mid


def _calibrate_group(category: str, rows: list[dict[str, Any]], s: Settings, now: float) -> dict[str, Any]:
    hammers = [r for r in (hammer_ratio(o) for o in rows) if r is not None]
    sales = [r for r in (sale_ratio(o) for o in rows) if r is not None]
    med_hammer, med_sale = _median(hammers), _median(sales)
    overshoot = (sum(1 for r in hammers if r >= 1) / len(hammers)) if hammers else None
    mape = _median([abs(r - 1) for r in sales]) if sales else None

    bias, conf_factor, basis = 1.0, 1.0, "none"
    if len(sales) >= s.calibration_min_sales and med_sale is not None:
        basis = "sales"  # ground truth wins outright
        bias = med_sale
        if mape is not None:
            conf_factor = max(0.4, min(1.0, 1 - max(0.0, mape - 0.2)))
    elif len(hammers) >= s.calibration_min_closed and overshoot is not None:
        # No sales yet: we can only detect inflation, so only ever haircut on this basis.
        basis = "hammer"
        excess = max(0.0, overshoot - 0.25)  # a quarter of picks getting outbid is normal
        bias = min(1.0, 1 - excess)
        conf_factor = max(0.5, min(1.0, 1 - excess))

    bias = max(s.calibration_min_bias, min(s.calibration_max_bias, bias))
    return {
        "category": category, "n_closed": len(rows), "n_sold": len(sales),
        "median_hammer_ratio": med_hammer, "overshoot_rate": overshoot,
        "median_sale_ratio": med_sale, "sale_mape": mape,
        "bias": round(bias, 3), "confidence_factor": round(conf_factor, 3),
        "basis": basis, "updated_at": now,
    }


def build_report(outcomes: Iterable[dict[str, Any]], s: Settings, now: float | None = None) -> dict[str, Any]:
    now = now or time.time()
    rows = list(outcomes)
    by_cat: dict[str, list[dict[str, Any]]] = {}
    for o in rows:
        by_cat.setdefault(o.get("category") or "Uncategorized", []).append(o)
    categories = sorted((_calibrate_group(c, r, s, now) for c, r in by_cat.items()),
                        key=lambda x: -x["n_closed"])
    sold = [o for o in rows if o.get("sale_price") is not None]
    realized = sum((o["sale_price"] - o["bought_price"]) for o in sold if o.get("bought_price") is not None)
    return {
        "generated_at": now,
        "global": _calibrate_group(GLOBAL, rows, s, now),
        "categories": categories,
        "totals": {"closed": len(rows), "sold": len(sold),
                   "realized_profit": round(realized, 2) if sold else None},
    }


def adjustment_for(report: dict[str, Any] | None, category: str, s: Settings) -> dict[str, Any]:
    """The adjustment to apply to a new valuation. Falls back to global, then to a no-op."""
    none = {"bias": 1.0, "confidence_factor": 1.0, "basis": "none", "n": 0}
    if not s.calibration or not report:
        return none
    cat = next((x for x in report.get("categories", []) if x["category"] == (category or "Uncategorized")), None)
    pick = cat if cat and cat["basis"] != "none" else (report["global"] if report["global"]["basis"] != "none" else None)
    if not pick:
        return none
    return {"bias": pick["bias"], "confidence_factor": pick["confidence_factor"],
            "basis": pick["basis"], "n": pick["n_closed"]}
