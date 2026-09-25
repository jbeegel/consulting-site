"""Liquidity — how fast the money comes back, which is a different question from what a thing is worth.

A $40 item that sits for six months is worse than a $25 item that sells in three days: the second one
turns your capital over eight times while the first one is still sitting in a bin. Value tells you the
size of the win; liquidity tells you whether you ever collect it.

THE MODEL. eBay's own numbers give a clean hazard rate. If S comparable items sold in the last 90 days
and A are listed right now, then each active listing sells at roughly

    p = (S / 90) / A        per day

That single number carries everything: a deep, fast market (S big, A small) gives a high p; a category
where everyone is listing and nobody is buying (S small, A huge) gives a p near zero, which is exactly
the "max promotion, no views" case. From p:

    days_p50 = ln 2 / p     the median wait
    days_p80 = ln 5 / p     the slow case you should plan cash around
    P(sold within 30d) = 1 - (1 - p)^30

SELL-THROUGH (S / (S + A)) is reported alongside because it is the number resellers already know, but
the hazard is what the arithmetic runs on: sell-through alone cannot distinguish 5-sold-of-10 in a week
from 5-sold-of-10 in a year.

DEPTH is a separate axis and it gates confidence, not speed. Three sold comps in 90 days can still
produce a fast-looking hazard; it is a fast-looking hazard computed from three data points.

The estimate degrades gracefully: measured history (what YOUR listings actually did) beats the hazard,
the hazard beats the appraiser's days-to-sell guess, and that beats a bucket read off the demand word.

This mirrors lib/spread/liquidity.ts exactly; keep the two in step.
"""
from __future__ import annotations

import math
from typing import Any

LN2 = math.log(2)
LN5 = math.log(5)

# Fallback median days-to-sell when there are no counts to work from.
DEMAND_DAYS = {"high": 12.0, "medium": 32.0, "low": 85.0, "unknown": 45.0}
DEPTH_FACTOR = {"deep": 1.0, "moderate": 0.93, "thin": 0.78, "dead": 0.55, "unknown": 0.8}


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def depth_of(sold_90d: float | None) -> str:
    if sold_90d is None:
        return "unknown"
    if sold_90d >= 40:
        return "deep"
    if sold_90d >= 12:
        return "moderate"
    if sold_90d >= 4:
        return "thin"
    return "dead"


def liquidity_grade(score: float) -> str:
    if score >= 75:
        return "A"
    if score >= 55:
        return "B"
    if score >= 35:
        return "C"
    if score >= 18:
        return "D"
    return "F"


def human_days(days: float) -> str:
    """'3 days' / '2 weeks' / '4 months' — the number a person actually plans around."""
    if days <= 1.5:
        return "about a day"
    if days < 14:
        return f"{round(days)} days"
    if days < 70:
        return f"{round(days / 7)} weeks"
    if days < 365:
        return f"{round(days / 30)} months"
    return "a year or more"


def daily_hazard(sold_90d: float | None, active_now: float | None) -> float | None:
    """Daily probability that one listing sells, from the sold/active counts."""
    if sold_90d is None or active_now is None:
        return None
    if sold_90d <= 0:
        return 0.0005  # listed and never selling is information, not missing data
    return _clamp((sold_90d / 90) / max(active_now, 1), 0.0005, 0.35)


def sell_through(sold_90d: float | None, active_now: float | None) -> float | None:
    if sold_90d is None or active_now is None:
        return None
    total = sold_90d + active_now
    return round(sold_90d / total, 3) if total > 0 else None


def _count(signals: dict[str, Any] | None, key: str) -> float | None:
    """A negative or missing value means 'not determined'; it must stay None, never become 0."""
    if not signals:
        return None
    v = signals.get(key)
    if v is None or v == "":
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) and f >= 0 else None


def assess_liquidity(signals: dict[str, Any] | None, val: dict[str, Any] | None, *,
                     handling_days: float = 3.0, max_days: float = 365.0,
                     days_multiplier: float = 1.0, measured_n: int = 0) -> dict[str, Any]:
    """Turn what we know about demand into a speed estimate."""
    sold = _count(signals, "sold_90d")
    active = _count(signals, "active_now")
    if sold is not None:
        sold = round(sold)
    if active is not None:
        active = round(active)
    val = val or {}

    hazard = daily_hazard(sold, active)
    basis = "market" if hazard is not None else "none"
    notes: list[str] = []

    if hazard is not None:
        notes.append(f"{sold} sold in 90 days against {active} listed now.")
    else:
        researched = _count(signals, "median_days_to_sell")
        appraised = val.get("days_to_sell")
        if researched:
            hazard = LN2 / _clamp(researched, 1, max_days)
            basis = "researched"
            notes.append("No sold/active counts; using the researched median time to sell.")
        elif appraised and float(appraised) > 0:
            hazard = LN2 / _clamp(float(appraised), 1, max_days)
            basis = "researched"
            notes.append("Using the appraiser's days-to-sell estimate.")
        else:
            # Last resort: the appraiser's one-word demand read. When even that is missing we know
            # nothing, and "we did not look" must not be scored like "we looked and it is slow" --
            # basis stays "none", which makes liquidity_factor a no-op. Ignorance is not evidence.
            demand = val.get("demand") or "unknown"
            hazard = LN2 / DEMAND_DAYS.get(demand, DEMAND_DAYS["unknown"])
            basis = "none" if demand == "unknown" else "assumed"
            notes.append("No demand data was researched for this lot, so its speed is a placeholder "
                         "and does not affect the score." if demand == "unknown"
                         else f"No sold/active counts; assuming a {demand}-demand item.")

    # The feedback loop: if this category has actually taken longer than the model said, believe history.
    mult = _clamp(days_multiplier, 0.3, 4.0) if days_multiplier and math.isfinite(days_multiplier) else 1.0
    if mult != 1.0:
        hazard = hazard / mult
        basis = "measured"
        how = f"{round(mult, 2)}x slower" if mult > 1 else f"{round(1 / mult, 2)}x faster"
        notes.append(f"Your own sales in this category run {how} than the model ({measured_n} listings).")
    hazard = _clamp(hazard, LN2 / max_days, 0.35)

    days_p50 = _clamp(LN2 / hazard, 0.5, max_days)
    days_p80 = _clamp(LN5 / hazard, 1, max_days * 2)
    comps = val.get("comps") or []
    depth = depth_of(sold if sold is not None else (len(comps) * 2 if comps else None))

    # Score: speed is the spine, everything else trims it.
    score = 100 * math.exp(-days_p50 / 45)  # 7d->85, 14d->73, 30d->51, 60d->26, 120d->7
    score *= DEPTH_FACTOR[depth]
    trend = (signals or {}).get("trend") or "unknown"
    if trend == "rising":
        score *= 1.08
        notes.append("Prices/demand trending up.")
    elif trend == "falling":
        score *= 0.88
        notes.append("Demand trending down — sell sooner, price at the low end.")
    disp = _count(signals, "price_dispersion")
    if disp is not None and disp > 0.8:
        score *= 0.9
        notes.append("Sold prices are all over the map; the realized number is a coin flip.")
    if basis in ("assumed", "none"):
        score *= 0.85  # a guess should not outrank a measured market
    score = round(_clamp(score, 1, 100), 1)

    if depth == "dead":
        notes.append("Almost nothing comparable has sold recently — treat any value estimate as theoretical.")
    elif depth == "thin":
        notes.append("Thin market: few sales to average, so both price and timing are uncertain.")
    if active is not None and sold is not None and sold > 0 and active > sold * 3:
        notes.append(f"Crowded: {active} sellers competing for roughly {round(sold / 3, 1)} sales a month. "
                     "Promotion will not fix that.")

    st = (signals or {}).get("sell_through")
    st = st if isinstance(st, (int, float)) and st >= 0 else sell_through(sold, active)
    return {
        "score": score,
        "grade": liquidity_grade(score),
        "depth": depth,
        "sold_90d": sold,
        "active_now": active,
        "sell_through": st,
        "daily_hazard": round(hazard, 5),
        "days_p50": round(days_p50, 1),
        "days_p80": round(days_p80, 1),
        "sell_probability_30d": round(1 - (1 - hazard) ** 30, 3),
        "capital_days": round(days_p50 + handling_days, 1),
        "handling_days": handling_days,
        "trend": trend,
        "seasonality": (signals or {}).get("seasonality") or "",
        "basis": basis,
        "measured_n": measured_n,
        "eta": human_days(days_p50),
        "notes": notes,
    }


def monthly_roi(profit: float, landed_cost: float, capital_days: float) -> float | None:
    """Profit per dollar of capital per 30 days. The metric that settles '$40 item vs $25 item'."""
    if landed_cost <= 0 or capital_days <= 0:
        return None
    return round((profit / landed_cost) * (30 / capital_days), 3)


def risk_adjusted_profit(profit: float, liq: dict[str, Any], horizon_days: int = 60) -> float:
    """Expected profit weighted by the chance it actually sells inside the horizon."""
    p = 1 - (1 - liq["daily_hazard"]) ** horizon_days
    return round(profit * p, 2)


def liquidity_factor(liq: dict[str, Any] | None, weight: float) -> float:
    """How much of a lot's headline score survives its liquidity, at the weight the user chose.

    weight 0 ignores liquidity entirely; weight 1 lets a dead market cut the score to a third.
    """
    if not liq or weight <= 0 or liq.get("basis") == "none":
        return 1.0
    w = _clamp(weight, 0.0, 1.0)
    full = 0.35 + 0.65 * (liq["score"] / 100)
    return round(1 - w * (1 - full), 4)


def days_at_price(liq: dict[str, Any] | None, label: str) -> int:
    """Per-price-point speed: cheap sells faster."""
    base = liq["days_p50"] if liq else {"quick": 7, "market": 21, "patient": 45}[label]
    factor = {"quick": 0.45, "market": 1.0, "patient": 2.2}[label]
    return max(1, round(base * factor))
