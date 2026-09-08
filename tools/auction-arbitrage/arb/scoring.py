"""Turn (lot, valuation) into an opportunity: landed cost, net resale, spread, ratio, score, heat."""
from __future__ import annotations

import math
import re
import time
from typing import Any

from .config import Settings

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


def score_lot(lot: dict[str, Any], val: dict[str, Any] | None, s: Settings, *, now: float | None = None) -> dict[str, Any]:
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
                    "heat": "unvalued", "confidence": 0.0, "radar": "scan"})
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
    score = value_score * out["price_reliability"]
    out.update({
        "net_resale": net, "net_resale_low": net_low, "spread": spread, "spread_low": net_low - cost,
        "ratio": ratio, "confidence": conf, "value_score": round(value_score, 1), "score": round(score, 1),
        "heat": heat(score), "sweet_spot": sweet, "radar": radar_level(secs_left, value_score),
    })
    return out


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
    for label, price, days in (("quick", quick, 7), ("market", market, 21), ("patient", patient, 45)):
        e = net_out(price, category=cat, shipping_cost=ship, s=s, shipping_charged=charged, promoted_rate=promo)
        e.update({"label": label, "expected_days": days, "profit": e["net"] - sc["landed_cost"],
                  "roi": (e["net"] - sc["landed_cost"]) / sc["landed_cost"] if sc["landed_cost"] > 0 else None})
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
    if val.get("value_drivers"):
        bits.append("Value drivers: " + "; ".join(val["value_drivers"][:3]) + ".")
    if val.get("risks"):
        bits.append("Watch for: " + "; ".join(val["risks"][:2]) + ".")
    return " ".join(bits)
