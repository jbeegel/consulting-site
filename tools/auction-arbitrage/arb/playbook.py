"""The Playbook -- hunting demand-first instead of lot-first.

Everything before this module starts from a lot and asks "what is this worth". That finds value but it
is passive: you only ever evaluate what the scanner happened to pull. A $1 advertising letter opener
that sells for $30 in three hours is not a lucky accident, it is a repeatable NICHE, and the way to work
a niche is to know its numbers first and then go looking for it.

A THESIS is that knowledge, written down and testable:

    what to search for  ->  queries, and the negatives that mean "wrong thing"
    what it sells for   ->  p25 / median / p75 from real eBay sold data
    how fast            ->  sold_90d vs active_now, median days to sell
    what to pay         ->  max_bid, derived, the only number you act on at 2am

MAX BID is the point of the whole exercise. Given a target return on capital, a resale median and a time
to sell, there is exactly one bid above which the trade stops being worth doing, and it is arithmetic
rather than nerve::

    net        = median * (1 - fees) - shipping - packaging
    k          = target_monthly_roi * capital_days / 30
    landed_max = net / (1 + k)                    ... and never more than net / min_multiple
    max_bid    = (landed_max - pickup) / ((1 + premium) * (1 + tax))

Theses arrive three ways: SEEDED (a starter pack), DISCOVERED (a research pass over recent eBay sold
data -- see discovery.py), or YOUR_SALES (mined from what you have actually flipped profitably, so the
system keeps proposing more of what already worked for you).

Mirrors lib/spread/playbook.ts; keep the two in step.
"""
from __future__ import annotations

import re
import time
from typing import Any, Iterable

from .config import Settings
from .liquidity import assess_liquidity
from .scoring import ebay_fee_rate

_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def normalize_text(s: str) -> str:
    """Lowercase, punctuation to spaces, padded so whole-word checks are a substring test."""
    return " " + _NON_ALNUM.sub(" ", (s or "").lower()).strip() + " "


def _phrase_in(haystack: str, phrase: str) -> bool:
    words = [w for w in normalize_text(phrase).split(" ") if w]
    return bool(words) and all(f" {w} " in haystack for w in words)


def slugify(s: str) -> str:
    out = _NON_ALNUM.sub("-", (s or "").lower()).strip("-")[:60]
    return out or "thesis"


def match_thesis(lot: dict[str, Any], t: dict[str, Any]) -> dict[str, Any] | None:
    """Does this lot look like the thing the thesis hunts for?

    The title carries most of the signal -- an auctioneer who bothered to type "advertising letter
    opener" is telling you what it is -- so a title hit counts double. The description is searched too
    because box lots bury the good item in a sentence. A negative term anywhere kills the match: the
    cost of a false positive (a wasted valuation call, or worse, a bid) beats a missed one.
    """
    if not t.get("enabled", True):
        return None
    title = normalize_text(lot.get("title") or "")
    body = normalize_text(f"{lot.get('description') or ''} {lot.get('category_path') or ''}")
    both = title + body

    for n in t.get("negative") or []:
        if _phrase_in(both, n):
            return None
    for p in t.get("must_all") or []:
        if not _phrase_in(both, p):
            return None

    hits_title = [p for p in (t.get("must_any") or []) if _phrase_in(title, p)]
    hits_body = [p for p in (t.get("must_any") or []) if p not in hits_title and _phrase_in(body, p)]
    if not hits_title and not hits_body:
        return None

    raw = len(hits_title) * 2 + len(hits_body)
    strength = max(0.15, min(1.0, raw / 4))
    days = t.get("median_days_to_sell")
    return {
        "thesis_id": t["id"], "name": t.get("name", ""), "family": t.get("family", ""),
        "strength": round(strength, 2),
        "where": "title" if hits_title else "description",
        "matched": (hits_title + hits_body)[:4],
        "max_bid": t.get("max_bid"), "max_landed": t.get("max_landed"),
        "price_median": t.get("price_median"),
        "eta": "" if days is None else f"{round(days)}d",
    }


def match_theses(lot: dict[str, Any], theses: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    out = [m for m in (match_thesis(lot, t) for t in theses) if m]
    out.sort(key=lambda m: (-m["strength"], -(m["max_bid"] or 0)))
    return out


def thesis_liquidity(t: dict[str, Any], s: Settings) -> dict[str, Any]:
    """The liquidity this thesis implies, so a matched-but-unvalued lot still gets a speed read."""
    return assess_liquidity({
        "sold_90d": t.get("sold_90d"), "active_now": t.get("active_now"),
        "sell_through": t.get("sell_through"), "median_days_to_sell": t.get("median_days_to_sell"),
        "trend": t.get("trend") or "unknown", "seasonality": t.get("seasonality") or "",
    }, None, handling_days=s.handling_days, max_days=s.max_days_to_sell)


def max_landed_for(t: dict[str, Any], s: Settings, *, target_monthly_roi: float | None = None) -> float | None:
    """The most this niche can COST YOU ALL-IN and still clear the target return on capital.

    This is the source of truth, and it is the right number for any channel: at an auction you convert
    it back to a bid by stripping the buyer's premium, while buying locally the price plus the trip IS
    the landed cost and compares directly. None when the thesis has no researched price -- an
    un-researched thesis must not hand you a number.
    """
    median = t.get("price_median")
    if not median or median <= 0:
        return None
    fee_rate = ebay_fee_rate(t.get("ebay_category") or t.get("family") or "", s)
    ship = t.get("ship_cost")
    ship = s.resale_shipping if ship is None else ship
    net = median * (1 - fee_rate) - ship - s.packaging_cost
    if net <= 0:
        return None

    liq = thesis_liquidity(t, s)
    capital_days = max(1.0, liq["capital_days"])
    target = s.target_monthly_roi if target_monthly_roi is None else target_monthly_roi
    k = max(0.0, target) * (capital_days / 30)

    landed_max = net / (1 + k)
    # Belt and braces: never pay within `min_buy_multiple` of net even if it sells the same day.
    landed_max = min(landed_max, net / max(1.2, s.min_buy_multiple))
    return round(landed_max, 2) if landed_max > 0 else None


def max_bid_for(t: dict[str, Any], s: Settings, *, premium: float | None = None,
                target_monthly_roi: float | None = None) -> float | None:
    """The landed ceiling converted back to a bid: strip the buyer's premium, tax and pickup."""
    landed_max = max_landed_for(t, s, target_monthly_roi=target_monthly_roi)
    if landed_max is None:
        return None
    prem = s.default_buyer_premium if premium is None else premium
    bid = (landed_max - s.pickup_cost) / ((1 + prem) * (1 + s.sales_tax))
    return round(bid, 2) if bid > 0.5 else None


def refresh_thesis(t: dict[str, Any], s: Settings, now: float | None = None) -> dict[str, Any]:
    """Recompute the derived fields. Call after any edit or research refresh."""
    now = now or time.time()
    out = dict(t)
    if out.get("sell_through") is None and out.get("sold_90d") is not None and out.get("active_now") is not None:
        total = out["sold_90d"] + out["active_now"]
        out["sell_through"] = round(out["sold_90d"] / total, 3) if total > 0 else None
    liq = thesis_liquidity(out, s)
    # With no market data at all the liquidity model falls back to a placeholder. Reporting that as a
    # grade would dress a guess up as a measurement, so an unresearched thesis shows nothing.
    measured = liq["basis"] != "none"
    out.update({
        "max_bid": max_bid_for(out, s),
        "max_landed": max_landed_for(out, s),
        "liquidity_score": liq["score"] if measured else None,
        "liquidity_grade": liq["grade"] if measured else None,
        "days_p50": liq["days_p50"] if measured else None,
        "updated_at": now,
    })
    return out


def refresh_all(theses: Iterable[dict[str, Any]], s: Settings, now: float | None = None) -> list[dict[str, Any]]:
    now = now or time.time()
    return [refresh_thesis(t, s, now) for t in theses]


def empty_stats() -> dict[str, Any]:
    return {"lots_matched": 0, "bought": 0, "sold": 0, "spend": 0.0, "revenue": 0.0,
            "realized_monthly_roi": None, "last_match_at": None}


def _num(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f >= 0 else None


def _arr(v: Any) -> list[str]:
    return [str(x).strip() for x in v if str(x).strip()] if isinstance(v, list) else []


def normalize_thesis(src: dict[str, Any], s: Settings, now: float | None = None) -> dict[str, Any]:
    """Fill in the fields a partial thesis (seed, model output, hand edit) leaves out."""
    now = now or time.time()
    name = str(src.get("name") or "").strip()
    trend = src.get("trend")
    t = {
        "id": src.get("id") or slugify(name),
        "name": name,
        "family": (src.get("family") or "Other").strip(),
        "queries": _arr(src.get("queries")) or [name],
        "negative": _arr(src.get("negative")),
        "must_any": _arr(src.get("must_any")) or [name],
        "must_all": _arr(src.get("must_all")),
        "sold_90d": _num(src.get("sold_90d")),
        "active_now": _num(src.get("active_now")),
        "sell_through": _num(src.get("sell_through")),
        "price_p25": _num(src.get("price_p25")),
        "price_median": _num(src.get("price_median")),
        "price_p75": _num(src.get("price_p75")),
        "median_days_to_sell": _num(src.get("median_days_to_sell")),
        "ship_cost": _num(src.get("ship_cost")) if _num(src.get("ship_cost")) is not None else 5.0,
        "ebay_category": src.get("ebay_category") or "",
        "trend": trend if trend in ("rising", "flat", "falling") else "unknown",
        "seasonality": src.get("seasonality") or "",
        "max_bid": None, "max_landed": None, "liquidity_score": None, "liquidity_grade": None,
        "days_p50": None,
        "rationale": src.get("rationale") or "",
        "tells": _arr(src.get("tells")),
        "risks": _arr(src.get("risks")),
        "sources": _arr(src.get("sources")),
        "confidence": max(0.0, min(1.0, float(src.get("confidence", 0.4) or 0))),
        "origin": src["origin"] if src.get("origin") in ("seed", "discovered", "your_sales", "manual") else "manual",
        "enabled": src.get("enabled", True) is not False,
        "researched_at": src.get("researched_at"),
        "last_hunted_at": src.get("last_hunted_at"),
        "created_at": src.get("created_at") or now,
        "updated_at": now,
        "stats": src.get("stats") or empty_stats(),
    }
    return refresh_thesis(t, s, now)


_STOP = set(("the a an and or of for with in on at to from by lot lots vintage antique old new set pair "
             "large small size inch inches used nice rare estate box case item items piece pieces original "
             "approx approximately condition good great excellent unmarked marked").split())


def theses_from_outcomes(outcomes: Iterable[dict[str, Any]], s: Settings,
                         existing: Iterable[dict[str, Any]] = (), now: float | None = None) -> list[dict[str, Any]]:
    """Mine your own realized round trips for niches worth hunting again.

    This is the flywheel: the letter opener was a $1 buy that sold for $30 in hours, and once that is
    recorded there is no reason the system should ever need to be told about letter openers again. We
    look for words that recur across profitable sales -- never across a single lucky one.
    """
    now = now or time.time()
    existing = list(existing)
    known = {t["id"] for t in existing}
    known.update(slugify(p) for t in existing for p in t.get("must_any", []))

    buckets: dict[str, dict[str, Any]] = {}
    for o in outcomes:
        if o.get("sale_price") is None or not o.get("bought_price"):
            continue
        # A sale the playbook already hunts teaches nothing new. Skipping these is what stops the
        # letter-opener wins from re-proposing "letter", "opener" and "advertising" as separate niches.
        probe = {"title": o.get("title", ""), "description": "", "category_path": o.get("category", "")}
        if match_theses(probe, existing):
            continue
        days = None
        if o.get("listed_at") and o.get("sale_at"):
            days = (o["sale_at"] - o["listed_at"]) / 86400
        tokens = [w for w in normalize_text(o.get("title") or "").split() if len(w) > 3 and w not in _STOP]
        # Bigrams first: "pocket mirror" is a niche, "pocket" is not.
        pairs = [f"{a} {b}" for a, b in zip(tokens, tokens[1:])]
        for w in set(tokens) | set(pairs):
            b = buckets.setdefault(w, {"sales": 0, "spend": 0.0, "revenue": 0.0, "days": [], "prices": [],
                                       "titles": [], "category": o.get("category") or "Other"})
            b["sales"] += 1
            b["spend"] += o["bought_price"]
            b["revenue"] += o["sale_price"]
            b["prices"].append(o["sale_price"])
            if days and days > 0:
                b["days"].append(days)
            if len(b["titles"]) < 3:
                b["titles"].append(o.get("title") or "")

    out = []
    # A phrase beats the words inside it when both describe the same sales, so take phrases first and
    # drop any single word already accounted for by one we kept.
    claimed: set[str] = set()
    for word, b in sorted(buckets.items(), key=lambda kv: (-kv[1]["sales"], -len(kv[0].split()))):
        if b["sales"] < s.thesis_min_sales or slugify(word) in known:
            continue
        roi = (b["revenue"] - b["spend"]) / b["spend"]
        if roi < s.thesis_min_roi:
            continue
        parts = word.split()
        if len(parts) == 1 and word in claimed:
            continue
        claimed.update(parts)
        prices = sorted(b["prices"])
        at = lambda q: prices[min(len(prices) - 1, int(q * len(prices)))]  # noqa: E731
        med_days = sorted(b["days"])[len(b["days"]) // 2] if b["days"] else None
        out.append(normalize_thesis({
            "name": word.capitalize(), "family": b["category"], "queries": [word], "must_any": [word],
            "price_p25": round(at(0.25), 2), "price_median": round(at(0.5), 2), "price_p75": round(at(0.75), 2),
            "median_days_to_sell": None if med_days is None else round(med_days),
            "confidence": max(0.0, min(0.8, 0.3 + 0.1 * b["sales"])),
            "origin": "your_sales",
            "rationale": (f"You have sold {b['sales']} things matching \"{word}\" at a median of "
                          f"${round(at(0.5))}, turning ${round(b['spend'])} into ${round(b['revenue'])}. "
                          "Proposed from your own results, not research."),
            "tells": b["titles"], "researched_at": now,
        }, s, now))
    out.sort(key=lambda t: -(t["price_median"] or 0))
    return out[:s.thesis_max_from_sales]


def apply_outcome_stats(theses: list[dict[str, Any]], outcomes: Iterable[dict[str, Any]],
                        lots_by_id: dict[int, dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """Roll real-world results back onto each thesis, so the playbook grades itself too."""
    lots_by_id = lots_by_id or {}
    stats = {t["id"]: empty_stats() for t in theses}
    for o in outcomes:
        probe = lots_by_id.get(o["lot_id"]) or {"title": o.get("title", ""), "description": "",
                                                "category_path": o.get("category", "")}
        for m in match_theses(probe, theses):
            st = stats[m["thesis_id"]]
            st["lots_matched"] += 1
            st["last_match_at"] = max(st["last_match_at"] or 0, o.get("closed_at") or 0)
            if o.get("bought_price"):
                st["bought"] += 1
                st["spend"] += o["bought_price"]
            if o.get("sale_price") is not None:
                st["sold"] += 1
                st["revenue"] += o["sale_price"]
    out = []
    for t in theses:
        st = stats.get(t["id"], empty_stats())
        roi = (st["revenue"] - st["spend"]) / st["spend"] if st["spend"] > 0 and st["sold"] else None
        st = dict(st, spend=round(st["spend"], 2), revenue=round(st["revenue"], 2),
                  realized_monthly_roi=None if roi is None else round(roi, 3))
        out.append(dict(t, stats=st))
    return out


def hunt_order(theses: Iterable[dict[str, Any]], n: int) -> list[dict[str, Any]]:
    """Which theses to hunt next: least recently hunted first, so the search budget rotates."""
    rows = [t for t in theses if t.get("enabled", True) and t.get("queries")]
    rows.sort(key=lambda t: (t.get("last_hunted_at") or 0, -(t.get("confidence") or 0)))
    return rows[:max(0, n)]
