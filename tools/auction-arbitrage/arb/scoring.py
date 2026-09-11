"""Turn (lot, valuation) into an opportunity: landed cost, net resale, spread, ratio, score, heat."""
from __future__ import annotations

import math
import re
import time
from typing import Any

from .config import Settings
from .liquidity import (assess_liquidity, days_at_price, liquidity_factor, monthly_roi,
                        risk_adjusted_profit)

TIME_BUCKETS = [  # (label, max_seconds)
    ("<1h", 3600), ("1-3h", 3 * 3600), ("3-6h", 6 * 3600), ("6-12h", 12 * 3600),
    ("12-24h", 24 * 3600), ("1-3d", 3 * 86400), ("3d+", math.inf),
]


def time_bucket(seconds: float | None) -> str:
    if seconds is None:
        return "unknown"
    for label, cap in TIME_BUCKETS:
        if seconds < cap:
            return label
    return "3d+"


def price_reliability(seconds: float | None) -> float:
    """How much the current bid tells you about the final price. A $1 bid with a week left is noise;
    the same $1 with an hour left is the price. This multiplies the value score directly."""
    if seconds is None:
        return 0.3
    h = seconds / 3600
    if h < 1:
        return 1.0
    if h < 2:
        return 0.95
    if h < 6:
        return 0.8
    if h < 12:
        return 0.65
    if h < 24:
        return 0.5
    if h < 48:
        return 0.35
    if h < 7 * 24:
        return 0.2
    return 0.1


RADAR_LEVELS = ("strike", "watch", "track", "scan")


def radar_level(seconds: float | None, value_score: float) -> str:
    """Radar = disparity x time. STRIKE: act now. WATCH: refresh often. TRACK: valued, closing within
    two days. SCAN: identified as valuable but too far out for the bid to mean anything yet."""
    if seconds is None or value_score < 20:
        return "scan"
    h = seconds / 3600
    if h < 2:
        return "strike"
    if h < 12:
        return "watch"
    if h < 48:
        return "track"
    return "scan"


def heat(score: float) -> str:
    if score >= 60:
        return "hot"
    if score >= 40:
        return "warm"
    if score >= 20:
        return "mild"
    return "cold"


def landed_cost(bid: float, lot: dict[str, Any], s: Settings) -> float:
    premium = lot.get("buyer_premium_rate")
    if premium is None:
        premium = s.default_buyer_premium
    cost = bid * (1 + premium) * (1 + s.sales_tax)
    return cost + s.pickup_cost


def score_lot(lot: dict[str, Any], val: dict[str, Any] | None, s: Settings, *, now: float | None = None,
              liquidity_weight: float | None = None, days_multiplier: float = 1.0,
              measured_n: int = 0, handling_days: float | None = None) -> dict[str, Any]:
    now = now or time.time()
    ends_at = lot.get("ends_at")
    secs_left = (ends_at - now) if ends_at else lot.get("time_left_seconds")
    if secs_left is not None:
        secs_left = max(0.0, secs_left)
    high_bid = float(lot.get("high_bid") or 0)
    min_bid = lot.get("min_bid")
    # The price you'd pay if you won at the next required bid (or opening bid if untouched).
    next_bid = float(min_bid) if min_bid else (high_bid * 1.1 if high_bid else 0.0)
    if next_bid <= 0:
        next_bid = 1.0
    qty = float(lot.get("quantity") or 1)
    per_each = (lot.get("bid_amount_type") or "").upper().endswith("EACH") and qty > 1
    if per_each:
        next_bid *= qty

    out: dict[str, Any] = {
        "lot_id": lot["id"],
        "seconds_left": secs_left,
        "time_bucket": time_bucket(secs_left),
        "next_bid": next_bid,
        "landed_cost": landed_cost(next_bid, lot, s),
        "price_reliability": price_reliability(secs_left),
        "valued": bool(val and val.get("mid")),
    }
    if not out["valued"]:
        out.update({"net_resale": None, "spread": None, "ratio": None, "score": 0.0, "value_score": 0.0,
                    "heat": "unvalued", "confidence": 0.0, "radar": "scan", "liquidity": None,
                    "liquidity_factor": 1.0, "score_before_liquidity": 0.0, "monthly_roi": None,
                    "expected_profit_60d": None})
        return out

    mid = float(val["mid"])
    net = mid * (1 - s.resale_fee) - s.resale_shipping
    net_low = float(val.get("low") or mid) * (1 - s.resale_fee) - s.resale_shipping
    cost = out["landed_cost"]
    spread = net - cost
    ratio = net / cost if cost > 0 else 0.0
    conf = float(val.get("confidence") or 0)

    # Multiple matters most (a $1 -> $30 penny lot is a 25x, the bread and butter of auction flipping);
    # dollars matter too, scaled to a realistic "great flip" rather than a four-figure one.
    sweet = cost <= s.sweet_spot_max_landed and net >= s.sweet_spot_min_net
    ratio_component = max(0.0, min(1.0, math.log2(max(ratio, 1.0)) / 3.0))  # 8x = full marks, 2x = 1/3
    dollar_component = max(0.0, min(1.0, spread / max(1.0, s.spread_full)))
    if sweet:  # a $1-$3 buy that nets $15+ is the bread and butter; don't let small dollars bury it
        dollar_component = max(dollar_component, 0.5)
    raw = 0.6 * ratio_component + 0.4 * dollar_component
    # value_score: how big the disparity is at today's price, ignoring the clock
    value_score = 100 * raw * (0.5 + 0.5 * conf)
    if spread <= 0:
        value_score = 0.0
    elif spread < s.min_spread:  # a 10x on $2 of headroom is not worth the gas
        value_score *= spread / s.min_spread
    if val.get("authenticity_risk"):
        value_score *= 0.75
    # score: the disparity discounted by how much the current bid can be trusted (time left)
    before_liquidity = round(value_score * out["price_reliability"], 1)

    # Liquidity: worth is not the same as sellable. A number nobody is buying at is a number on paper.
    liq = assess_liquidity(val.get("demand_signals"), val,
                           handling_days=s.handling_days if handling_days is None else handling_days,
                           max_days=s.max_days_to_sell, days_multiplier=days_multiplier,
                           measured_n=measured_n)
    weight = s.liquidity_weight if liquidity_weight is None else liquidity_weight
    factor = liquidity_factor(liq, weight)
    score = round(before_liquidity * factor, 1)
    out.update({
        "net_resale": net, "net_resale_low": net_low, "spread": spread, "spread_low": net_low - cost,
        "ratio": ratio, "confidence": conf, "value_score": round(value_score, 1), "score": score,
        "heat": heat(score), "sweet_spot": sweet, "radar": radar_level(secs_left, value_score),
        "liquidity": liq, "liquidity_factor": factor, "score_before_liquidity": before_liquidity,
        "monthly_roi": monthly_roi(spread, cost, liq["capital_days"]),
        "expected_profit_60d": risk_adjusted_profit(spread, liq),
    })
    return out


def per_month(roi: float) -> str:
    """Monthly return on capital. Past ~10x a percentage stops reading as a number, so switch to
    multiples: a $1 lot that nets $30 in a week is '40x/month', not '4000%'."""
    return f"{round(roi)}x/month" if roi >= 9.99 else f"{round(roi * 100)}%/month"


def liquidity_verdict(sc: dict[str, Any]) -> str:
    """How a lot reads once liquidity is in the picture: the one-line verdict the table shows."""
    liq = sc.get("liquidity")
    if not liq or not sc.get("valued"):
        return ""
    roi = sc.get("monthly_roi")
    tail = "" if roi is None else f", about {per_month(roi)} on the capital"
    if liq["grade"] == "F" or liq["depth"] == "dead":
        return (f"Worth ${sc['net_resale']:,.0f} on paper, but almost nothing comparable sells — "
                f"expect {liq['eta']} or never.")
    if liq["grade"] == "D":
        return f"Slow money: {liq['eta']} to sell{tail}."
    if roi is not None and roi >= 1 and liq["grade"] in ("A", "B"):
        return f"Fast money: sells in {liq['eta']}, roughly {per_month(roi)} on what you tie up."
    return f"Sells in about {liq['eta']}" + ("" if roi is None else f" — {per_month(roi)} on the capital") + "."


# ---------------------------------------------------------------------------
# eBay listing economics: what you net at each recommended price point
# ---------------------------------------------------------------------------

_MEDIA = re.compile(r"\b(book|books|magazine|comic|movie|dvd|blu-ray|vhs|music|cd|vinyl|record|lp|cassette)\b", re.I)


def ebay_fee_rate(category: str, s: Settings) -> float:
    return s.ebay_fvf_media if _MEDIA.search(category or "") else s.ebay_fvf


def net_out(price: float, *, category: str, shipping_cost: float, s: Settings, shipping_charged: float = 0.0,
            promoted_rate: float | None = None) -> dict[str, Any]:
    """Net cash after eBay final value fee, per-order fee, promoted-listing ad, shipping and packaging."""
    gross = price + shipping_charged
    rate = ebay_fee_rate(category, s)
    fvf = gross * rate
    per_order = s.ebay_per_order_small if gross <= 10 else s.ebay_per_order
    promoted = gross * (s.ebay_promoted if promoted_rate is None else promoted_rate)
    net = gross - fvf - per_order - promoted - shipping_cost - s.packaging_cost
    return {"price": price, "shipping_charged": shipping_charged, "fvf": fvf, "fvf_rate": rate, "per_order": per_order,
            "promoted": promoted, "shipping_cost": shipping_cost, "packaging": s.packaging_cost, "net": net}


def listing_economics(lot: dict[str, Any], val: dict[str, Any] | None, sc: dict[str, Any], s: Settings) -> dict[str, Any] | None:
    """Three price points (quick / market / patient) with net-out and profit vs. landed cost."""
    if not val or not val.get("mid"):
        return None
    lst = val.get("listing") or {}
    cat = lst.get("category") or lot.get("category_path") or ""
    ship = float(lst.get("shipping_cost_estimate") or s.resale_shipping or 0)
    quick = float(lst.get("price_quick") or val.get("low") or val["mid"] * 0.8)
    market = float(lst.get("price_market") or val["mid"])
    patient = float(lst.get("price_patient") or val.get("high") or val["mid"] * 1.2)
    # Buyer pays shipping on cheap items (free shipping on a $20 item eats the margin); seller absorbs on pricey ones.
    charged = ship if market < 60 else 0.0
    promo = s.ebay_promoted or max(0.0, min(0.2, float(lst.get("promoted_rate") or 0)))
    pts = []
    liq = sc.get("liquidity")
    handling = liq["handling_days"] if liq else s.handling_days
    for label, price in (("quick", quick), ("market", market), ("patient", patient)):
        e = net_out(price, category=cat, shipping_cost=ship, s=s, shipping_charged=charged, promoted_rate=promo)
        # Days come from the measured market, not a constant: pricing below the comps sells sooner.
        days = days_at_price(liq, label)
        profit = e["net"] - sc["landed_cost"]
        e.update({"label": label, "expected_days": days, "profit": profit,
                  "roi": profit / sc["landed_cost"] if sc["landed_cost"] > 0 else None,
                  "monthly_roi": monthly_roi(profit, sc["landed_cost"], days + handling)})
        pts.append(e)
    return {
        "category": cat, "fee_rate": ebay_fee_rate(cat, s), "shipping_cost": ship, "buyer_pays_shipping": charged > 0,
        "format": lst.get("format") or "fixed_price", "best_offer_floor": lst.get("best_offer_floor"),
        "auction_start": lst.get("auction_start"), "points": pts, "recommended": "market",
    }


def why_upside(lot: dict[str, Any], val: dict[str, Any], sc: dict[str, Any], s: Settings) -> str:
    """One-paragraph plain-English explanation of where the spread comes from."""
    if not sc.get("valued"):
        return "Not yet valued."
    bits = []
    ratio = sc["ratio"]
    bits.append(
        f"Next bid ${sc['next_bid']:,.0f} lands at about ${sc['landed_cost']:,.0f} all-in "
        f"(buyer's premium {int(round((lot.get('buyer_premium_rate') or s.default_buyer_premium) * 100))}%"
        + (f", tax {int(round(s.sales_tax * 100))}%" if s.sales_tax else "") + ")."
    )
    bits.append(
        f"Independent resale estimate is ${val['low']:,.0f}–${val['high']:,.0f} (mid ${val['mid']:,.0f}); "
        f"after {int(round(s.resale_fee * 100))}% selling fees that nets about ${sc['net_resale']:,.0f}, "
        f"a {ratio:.1f}x return and ${sc['spread']:,.0f} of headroom at the mid case."
    )
    if lot.get("bid_count", 0) == 0:
        bits.append("No bids yet, so the opening bid is the price today.")
    elif sc["seconds_left"] is not None and sc["seconds_left"] < 6 * 3600:
        bits.append(f"Closing in under {max(1, int(sc['seconds_left'] // 3600) + 1)}h with {lot.get('bid_count')} bids, so the current price is close to final.")
    elif sc["seconds_left"] is not None and sc["seconds_left"] > 48 * 3600:
        bits.append(f"Still {int(sc['seconds_left'] // 86400)}+ days out, so today's bid means little; it stays on the radar and the score climbs as the close approaches.")
    else:
        bits.append("Plenty of time left; expect the price to rise near close.")
    if val.get("standout_item"):
        bits.append(f"Standout piece: {val['standout_item']}.")
    liq = sc.get("liquidity")
    if liq:
        parts = [f"Liquidity {liq['grade']} ({liq['score']}/100)"]
        if liq["sold_90d"] is not None and liq["active_now"] is not None:
            parts.append(f"{liq['sold_90d']} sold in 90 days vs {liq['active_now']} listed now")
        if liq["sell_through"] is not None:
            parts.append(f"{round(liq['sell_through'] * 100)}% sell-through")
        roi = "" if sc.get("monthly_roi") is None else f" at about {per_month(sc['monthly_roi'])}"
        bits.append(", ".join(parts) + f": expect about {liq['eta']} to sell "
                    f"({round(liq['sell_probability_30d'] * 100)}% chance inside 30 days), so roughly "
                    f"{liq['capital_days']} days of your money{roi}.")
        if liq["grade"] == "F" or liq["depth"] == "dead":
            bits.append("Treat the resale number as theoretical until something comparable actually sells.")
        if liq["trend"] == "falling":
            bits.append("Demand is trending down; price at the quick number, not the patient one.")
        if liq["seasonality"]:
            bits.append(f"Seasonality: {liq['seasonality']}.")
    ge = grading_economics(val, sc, s)
    if ge:
        if ge["upside"] > 0:
            bits.append(f"Grading: expected net ${ge['graded_net']:,.0f} graded vs ${ge['raw_net']:,.0f} raw after ~${ge['grading_cost']:,.0f} to grade "
                        f"(+${ge['upside']:,.0f}, likely {ge['predicted_grade'] or 'PSA 8-9'}); recommendation: {ge['recommendation']}.")
        else:
            bits.append(f"Grading does not pay: ~${ge['grading_cost']:,.0f} to grade against an expected ${ge['ev_gross']:,.0f} graded sale; sell raw.")
    if val.get("value_drivers"):
        bits.append("Value drivers: " + "; ".join(val["value_drivers"][:3]) + ".")
    if val.get("risks"):
        bits.append("Watch for: " + "; ".join(val["risks"][:2]) + ".")
    return " ".join(bits)


# ---------------------------------------------------------------------------
# Grading economics (trading cards): EV of grading vs. selling raw
# ---------------------------------------------------------------------------

_GRADE_BUCKETS = ("10", "9", "8", "7-")


def _bucket(grade: str) -> str | None:
    m = re.search(r"(\d+(?:\.\d)?)", str(grade or ""))
    if not m:
        return None
    g = float(m.group(1))
    return "10" if g >= 9.5 else "9" if g >= 9 else "8" if g >= 8 else "7-"


def grading_economics(val: dict[str, Any] | None, sc: dict[str, Any], s: Settings) -> dict[str, Any] | None:
    """Expected net from grading (grade odds x price by grade, less fees) against the raw net."""
    g = (val or {}).get("grading")
    if not s.grading or not g or not g.get("applicable"):
        return None
    probs = g.get("grade_probabilities") or {}
    p = {"10": float(probs.get("psa10") or 0), "9": float(probs.get("psa9") or 0),
         "8": float(probs.get("psa8") or 0), "7-": float(probs.get("psa7_or_below") or 0)}
    tot = sum(p.values())
    if tot <= 0:
        return None
    p = {k: v / tot for k, v in p.items()}
    # median graded price per bucket from the comps (PSA preferred, any grader otherwise)
    by: dict[str, list[float]] = {b: [] for b in _GRADE_BUCKETS}
    for c in g.get("graded_comps") or []:
        b = _bucket(c.get("grade"))
        if b and float(c.get("price") or 0) > 0:
            by[b].append(float(c["price"]))
    raw = float(g.get("raw_value") or (val or {}).get("mid") or 0)
    prices: dict[str, float | None] = {}
    for b in _GRADE_BUCKETS:
        xs = sorted(by[b])
        prices[b] = xs[len(xs) // 2] if xs else None
    # fill gaps conservatively: a missing higher grade never exceeds the next known one below it is unknown -> raw
    if prices["7-"] is None:
        prices["7-"] = raw
    if prices["8"] is None:
        prices["8"] = max(raw, prices["7-"] or raw)
    if prices["9"] is None:
        prices["9"] = prices["8"]
    if prices["10"] is None:
        prices["10"] = prices["9"]
    ev_gross = sum(p[b] * float(prices[b] or 0) for b in _GRADE_BUCKETS)
    fee = s.resale_fee
    cost = s.grading_fee + s.grading_ship + s.packaging_cost
    graded_net = ev_gross * (1 - fee) - cost
    raw_net = raw * (1 - fee) - s.packaging_cost
    upside = graded_net - raw_net
    # Robustness: what if the 10 never comes? Move the 10's probability onto the 9. Tens are rare and
    # a recommendation that only works in the gem case is a lottery ticket, not a plan.
    p_no10 = dict(p, **{"9": p["9"] + p["10"], "10": 0.0})
    ev_no10 = sum(p_no10[b] * float(prices[b] or 0) for b in _GRADE_BUCKETS)
    graded_net_no10 = ev_no10 * (1 - fee) - cost
    upside_no10 = graded_net_no10 - raw_net
    photo_q = ((g.get("condition") or {}).get("photo_quality") or "limited")
    hurdle = max(25.0, 0.3 * cost, 0.25 * max(raw_net, 1.0))  # must clear the ~$90 outlay with margin
    if photo_q == "unusable":
        rec = "inspect in hand"
    elif upside > hurdle and upside_no10 > 0:
        rec = "grade"
    elif upside > hurdle:
        rec = "speculative: pays only if it gems"
    elif upside > 0 and (p["10"] + p["9"]) >= 0.5:
        rec = "grade if it looks 9+ in hand"
    else:
        rec = "sell raw"
    return {
        "probabilities": p, "prices": prices, "ev_gross": ev_gross, "graded_net": graded_net, "raw_value": raw,
        "raw_net": raw_net, "upside": upside, "graded_net_no10": graded_net_no10, "upside_no10": upside_no10,
        "grading_cost": cost, "hurdle": hurdle, "grading_fee": s.grading_fee, "grading_ship": s.grading_ship,
        "days": s.grading_days, "recommendation": rec, "predicted_grade": g.get("predicted_grade"),
        "recommended_grader": g.get("recommended_grader"), "photo_quality": photo_q,
        "profit_graded_vs_landed": graded_net - sc["landed_cost"],
    }
