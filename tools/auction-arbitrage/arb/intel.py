"""Market intel -- the layer above any single lot. Three questions a per-lot score cannot answer:

  Which categories are actually moving right now?  (trends, from the valuations we already paid for)
  Where is my capital best used today?             (velocity leaders: profit per dollar per month)
  What looks great and is secretly unsellable?     (value traps: high mid, no buyers)

Everything here is derived from data already on disk -- stored valuations and open lots -- so the intel
panel costs nothing extra to render and gets sharper with every scan.

Mirrors lib/spread/intel.ts.
"""
from __future__ import annotations

import statistics
import time
from datetime import datetime, timezone
from typing import Any, Iterable

from .config import Settings
from .liquidity import assess_liquidity


def _median(xs: list[float]) -> float | None:
    return statistics.median(xs) if xs else None


def _r1(x: float | None) -> float | None:
    return None if x is None else round(x, 1)


def _day(unix: float) -> str:
    return datetime.fromtimestamp(unix, tz=timezone.utc).strftime("%Y-%m-%d")


def build_trends(valuations: Iterable[dict[str, Any]], s: Settings, *, window_days: int | None = None,
                 now: float | None = None) -> list[dict[str, Any]]:
    """Category trends over a rolling window.

    "Warming" compares the recent half against the earlier half of the same window, so it reflects a
    change in what the market is doing rather than which lots we happened to scan. Categories with too
    little history in one half are reported as "new" instead of a fake delta.
    """
    now = now or time.time()
    window_days = window_days or s.trend_window_days
    cutoff = now - window_days * 86400
    midpoint = now - (window_days / 2) * 86400

    samples: list[dict[str, Any]] = []
    for v in valuations:
        created = v.get("created_at") or 0
        if created < cutoff or not v.get("mid"):
            continue
        liq = assess_liquidity(v.get("demand_signals"), v, handling_days=s.handling_days,
                               max_days=s.max_days_to_sell)
        samples.append({"day": _day(created), "at": created, "category": v.get("category") or "Uncategorized",
                        "liquidity": liq["score"], "days": liq["days_p50"],
                        "sell_through": liq["sell_through"], "mid": v.get("mid")})

    by_cat: dict[str, list[dict[str, Any]]] = {}
    for x in samples:
        by_cat.setdefault(x["category"], []).append(x)

    out: list[dict[str, Any]] = []
    for category, rows in by_cat.items():
        by_day: dict[str, list[dict[str, Any]]] = {}
        for x in rows:
            by_day.setdefault(x["day"], []).append(x)
        points = [{
            "day": d,
            "n": len(xs),
            "liquidity": _r1(_median([x["liquidity"] for x in xs])),
            "days_p50": _r1(_median([x["days"] for x in xs])),
            "mid": _r1(_median([x["mid"] for x in xs if x["mid"] is not None])),
        } for d, xs in sorted(by_day.items())]

        early = [x["liquidity"] for x in rows if x["at"] < midpoint]
        late = [x["liquidity"] for x in rows if x["at"] >= midpoint]
        comparable = len(early) >= 2 and len(late) >= 2
        change = round(_median(late) - _median(early), 1) if comparable else None
        if not comparable:
            direction = "new"
        elif change >= 5:
            direction = "warming"
        elif change <= -5:
            direction = "cooling"
        else:
            direction = "steady"

        out.append({
            "category": category, "n": len(rows),
            "liquidity": _r1(_median([x["liquidity"] for x in rows])),
            "days_p50": _r1(_median([x["days"] for x in rows])),
            "sell_through": _median([x["sell_through"] for x in rows if x["sell_through"] is not None]),
            "median_mid": _r1(_median([x["mid"] for x in rows if x["mid"] is not None])),
            "change": change, "direction": direction, "points": points,
        })
    out.sort(key=lambda t: (-(t["liquidity"] or 0), -t["n"]))
    return out


def build_intel(opps: list[dict[str, Any]], history: Iterable[dict[str, Any]],
                liquidity_report: dict[str, Any], s: Settings, now: float | None = None) -> dict[str, Any]:
    """The live board: category trends, velocity leaders and value traps."""
    now = now or time.time()
    trends = build_trends(history, s, now=now)

    leaders = []
    for o in opps:
        sc, liq = o["score"], o["score"].get("liquidity")
        if not sc.get("valued") or not liq or (sc.get("spread") or 0) <= 0 or sc.get("monthly_roi") is None:
            continue
        if liq["grade"] not in ("A", "B", "C"):
            continue
        leaders.append({
            "lot_id": o["lot"]["id"], "title": o["lot"]["title"],
            "category": o["lot"].get("category") or "Uncategorized",
            "monthly_roi": sc["monthly_roi"], "liquidity_grade": liq["grade"], "eta": liq["eta"],
            "spread": round(sc["spread"]), "landed_cost": round(sc["landed_cost"], 2),
            "ends_at": o["lot"].get("ends_at"),
        })
    leaders.sort(key=lambda x: -x["monthly_roi"])

    traps = []
    for o in opps:
        sc, liq = o["score"], o["score"].get("liquidity")
        val = o.get("valuation") or {}
        if not liq or not val.get("mid"):
            continue
        # Looks like money (would have scored well on upside alone) but the market underneath is not there.
        if sc.get("score_before_liquidity", 0) < 30:
            continue
        if not (liq["grade"] == "F" or liq["depth"] == "dead" or liq["days_p50"] >= 120):
            continue
        if liq["depth"] == "dead":
            reason = f"Only {liq['sold_90d'] or 0} comparable sales in 90 days."
        elif liq["active_now"] is not None and liq["sold_90d"] is not None and liq["active_now"] > liq["sold_90d"]:
            reason = f"{liq['active_now']} listed against {liq['sold_90d']} sold in 90 days."
        else:
            reason = f"Median time to sell is about {liq['eta']}."
        traps.append({
            "lot_id": o["lot"]["id"], "title": o["lot"]["title"],
            "category": o["lot"].get("category") or "Uncategorized", "mid": val.get("mid"),
            "liquidity_grade": liq["grade"], "eta": liq["eta"], "reason": reason,
            "_rank": sc.get("score_before_liquidity", 0),
        })
    traps.sort(key=lambda x: -x.pop("_rank"))

    warming = sorted([t for t in trends if t["direction"] == "warming"], key=lambda t: -(t["change"] or 0))
    cooling = sorted([t for t in trends if t["direction"] == "cooling"], key=lambda t: (t["change"] or 0))
    return {
        "generated_at": now, "window_days": s.trend_window_days, "trends": trends,
        "warming": warming[:6], "cooling": cooling[:6], "liquidity": liquidity_report,
        "velocity_leaders": leaders[:12], "value_traps": traps[:12],
    }


_GRADES = "ABCDF"


def apply_intel_filters(opps: list[dict[str, Any]], *, min_liquidity_grade: str | None = None,
                        max_days_to_sell: float | None = None, rank_by: str = "score") -> list[dict[str, Any]]:
    """Apply the user's own risk parameters to a ranked list."""
    out = list(opps)
    if min_liquidity_grade and min_liquidity_grade in _GRADES:
        # Unvalued lots have no grade and are kept: the filter rejects known-illiquid items, it does not
        # hide things we have not looked at yet.
        out = [o for o in out if not o["score"].get("liquidity")
               or o["score"]["liquidity"]["grade"] <= min_liquidity_grade]
    if max_days_to_sell and max_days_to_sell > 0:
        out = [o for o in out if not o["score"].get("liquidity")
               or o["score"]["liquidity"]["days_p50"] <= max_days_to_sell]

    def key(o: dict[str, Any]) -> float:
        sc = o["score"]
        if rank_by == "velocity":
            return sc.get("monthly_roi") if sc.get("monthly_roi") is not None else -1
        if rank_by == "liquidity":
            return sc["liquidity"]["score"] if sc.get("liquidity") else -1
        if rank_by == "spread":
            return sc.get("spread") if sc.get("spread") is not None else -1
        return sc.get("score", 0)

    out.sort(key=lambda o: -key(o))
    return out
