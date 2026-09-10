import json
import time

from fastapi.testclient import TestClient

from arb.db import Store
from arb.hibid import HiBidClient, normalize_lot
from arb.scanner import Scanner
from arb.scoring import score_lot, time_bucket, why_upside
from arb.valuation import ValuationPipeline
from arb.valuation.estimate import parse_estimate


def test_client_search_and_normalize(settings):
    c = HiBidClient(settings.hibid_graphql, site_url=settings.hibid_site, delay=0)
    page = c.search_lots(page=1, page_length=10, status="OPEN", sort="TIME_LEFT", sort_direction="ASC")
    assert page.results and page.filtered_count > 10 and page.has_more
    lot = normalize_lot(page.results[0], fetched_at=time.time(), site_url=settings.hibid_site)
    assert lot["title"] and lot["url"].startswith(settings.hibid_site + "/lot/")
    assert lot["ends_at"] is not None and 0 < lot["buyer_premium_rate"] < 1
    assert lot["category"] and lot["category_path"]
    all_lots = list(c.iter_lots(page_length=25, max_pages=10, status="OPEN"))
    assert len(all_lots) == page.filtered_count
    st = c.lot_state(int(page.results[0]["id"]))
    assert "highBid" in st and "timeLeftSeconds" in st


def test_title_prefix_strip():
    from arb.valuation.base import strip_prefix, title_key
    from arb.valuation.ebay import clean_query
    assert strip_prefix("G) Noritake wall pocket") == "Noritake wall pocket"
    assert strip_prefix("12) vintage bank") == "vintage bank"
    assert title_key("G) Noritake wall pocket") == title_key("Noritake wall pocket")
    assert clean_query("G) Strike Three By Clair Bee A Chip Hilton") == "Strike Three By Clair Bee Chip Hilton"


def test_estimate_parser():
    assert parse_estimate("$100 - $200") == (100, 200)
    assert parse_estimate("1,000 to 1,500") == (1000, 1500)
    assert parse_estimate("") is None
    lo, hi = parse_estimate("$50")
    assert lo < 50 < hi


def test_scoring_math(settings):
    now = time.time()
    lot = {"id": 1, "high_bid": 40.0, "min_bid": 45.0, "bid_count": 3, "ends_at": now + 1800,
           "buyer_premium_rate": 0.15, "quantity": 1}
    val = {"mid": 300.0, "low": 250.0, "high": 350.0, "confidence": 0.8}
    sc = score_lot(lot, val, settings, now=now)
    assert abs(sc["landed_cost"] - 45 * 1.15) < 1e-6
    assert abs(sc["net_resale"] - 300 * (1 - settings.resale_fee)) < 1e-6
    assert sc["spread"] > 0 and sc["ratio"] > 4 and sc["heat"] in ("hot", "warm")
    assert sc["time_bucket"] == "<1h" and sc["price_reliability"] == 1.0
    assert "Next bid $45" in why_upside(lot, val, sc, settings)
    # far-out lots get discounted hard, but keep their value score and stay on the radar
    far = score_lot(dict(lot, ends_at=now + 5 * 86400), val, settings, now=now)
    assert far["score"] < sc["score"] * 0.3 and far["value_score"] == sc["value_score"]
    assert sc["radar"] == "strike" and far["radar"] == "scan"
    assert score_lot(dict(lot, ends_at=now + 5 * 3600), val, settings, now=now)["radar"] == "watch"
    assert score_lot(dict(lot, ends_at=now + 30 * 3600), val, settings, now=now)["radar"] == "track"
    # penny lot: $1 bid that nets $25 is a sweet spot and scores hot
    penny = score_lot(dict(lot, high_bid=1.0, min_bid=1.0), {"mid": 30.0, "low": 20.0, "high": 45.0, "confidence": 0.7}, settings, now=now)
    assert penny["sweet_spot"] and penny["heat"] == "hot"
    from arb.scoring import listing_economics
    le = listing_economics(dict(lot, category_path="Books > Antiquarian"), {"mid": 30.0, "low": 20.0, "high": 45.0, "confidence": 0.7,
                           "listing": {"price_quick": 20, "price_market": 30, "price_patient": 45, "shipping_cost_estimate": 5, "category": "Books"}}, penny, settings)
    assert [p["label"] for p in le["points"]] == ["quick", "market", "patient"]
    m = le["points"][1]
    assert le["fee_rate"] == settings.ebay_fvf_media and le["buyer_pays_shipping"]
    assert abs(m["net"] - ((30 + 5) * (1 - settings.ebay_fvf_media) - settings.ebay_per_order - 5 - settings.packaging_cost)) < 1e-6
    assert m["profit"] == m["net"] - penny["landed_cost"]
    # negative spread -> zero score
    bad = score_lot(dict(lot, min_bid=400.0), val, settings, now=now)
    assert bad["score"] == 0 and bad["spread"] < 0
    assert score_lot(lot, None, settings, now=now)["heat"] == "unvalued"
    assert time_bucket(None) == "unknown" and time_bucket(10 * 86400) == "3d+"


def test_scan_pipeline_and_refresh(settings):
    store = Store(settings.db_path)
    sc = Scanner(settings, store)
    st = sc.scan(status="OPEN", hours=24, max_pages=5, value=True, max_value=10)
    assert not st["error"] and st["lots_seen"] > 0
    lots = store.lots()
    assert lots and all(l["time_left_seconds"] <= 24 * 3600 for l in lots)
    vals = store.valuations_for([l["id"] for l in lots])
    assert vals, "estimate/none fallback should still record valuations"
    assert {v["method"] for v in vals.values()} <= {"hibid_estimate", "none"}
    # live refresh merges new state
    lot = lots[0]
    before = lot["bid_count"]
    fresh = sc.refresh_lot(lot["id"])
    assert fresh["bid_count"] == before + 1 and fresh["high_bid"] >= lot["high_bid"]
    # enrich pulls pictures + terms
    full = sc.enrich_lot(lot["id"])
    assert full["pictures"] and full["terms"] == "Demo terms"
    store.close()


def test_claude_valuer_parsing(settings, monkeypatch):
    """Exercise the Claude valuer with a fake SDK response (no network)."""
    from arb.valuation import claude as cv

    class FakeBlock:
        def __init__(self, type, text=""):
            self.type, self.text = type, text

    class FakeResp:
        stop_reason = "end_turn"
        content = [FakeBlock("web_search_tool_result"), FakeBlock("text", json.dumps({
            "identified_item": "DeWalt DCD996 hammer drill", "brand": "DeWalt", "model": "DCD996",
            "condition_assumption": "used", "bulk_lot": False, "unit_count": 1,
            "resale_low": 85, "resale_mid": 110, "resale_high": 130, "confidence": 0.85,
            "confidence_reason": "many comps", "demand": "high", "days_to_sell": 7, "best_channel": "eBay",
            "value_drivers": ["XR line"], "risks": ["battery"], "rationale": "comps cluster 90-130",
            "comps": [{"title": "sold one", "price": 105, "source": "ebay sold", "url": "https://ebay.com/x", "date": "Aug 2026", "note": ""}],
            "authenticity_risk": False, "search_query": "dewalt dcd996"}))]

    class FakeMessages:
        def create(self, **kw):
            assert kw["output_config"]["format"]["type"] == "json_schema"
            assert kw["tools"][0]["type"].startswith("web_search")
            return FakeResp()

    class FakeClient:
        messages = FakeMessages()

    valuer = cv.ClaudeValuer.__new__(cv.ClaudeValuer)
    import anthropic
    valuer._anthropic, valuer.client, valuer.model, valuer.web_search, valuer.max_searches, valuer.effort = anthropic, FakeClient(), "test-model", True, 3, "medium"
    valuer.vision, valuer.max_images = True, 4
    v = valuer.value({"id": 5, "title": "DeWalt DCD996 drill", "description": "", "quantity": 1})
    assert v.usable and v.method == "claude+web" and v.mid == 110 and v.comps[0]["price"] == 105
    assert v.images_used == 0

    # with photos: image blocks are attached ahead of the text
    seen = {}

    class FakeMessages2(FakeMessages):
        def create(self, **kw):
            seen["content"] = kw["messages"][0]["content"]
            return FakeResp()

    valuer.client = type("C", (), {"messages": FakeMessages2()})()
    monkeypatch.setattr(cv, "load_images", lambda urls, n=4, timeout=15.0: [{"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": "AAAA"}} for _ in urls[:n]])
    v = valuer.value({"id": 5, "title": "G) vintage knic knacs", "description": "", "quantity": 1, "pictures": ["u1", "u2", "u3"]})
    assert v.images_used == 3 and isinstance(seen["content"], list) and sum(b["type"] == "image" for b in seen["content"]) == 3

    # cards: the main range must be RAW; a graded number sneaking in is reset to grading.raw_value
    graded = json.loads(FakeResp.content[1].text)
    graded.update({"resale_low": 800, "resale_mid": 1200, "resale_high": 1500,
                   "grading": {"applicable": True, "card": {"year": "1989", "set": "Upper Deck", "card_number": "1", "player_or_subject": "Griffey", "parallel_or_variation": "base", "rookie": True},
                               "condition": {"centering": "", "corners": "", "edges": "", "surface": "", "notes": "", "photo_quality": "limited"},
                               "grade_probabilities": {"psa10": 0.05, "psa9": 0.35, "psa8": 0.4, "psa7_or_below": 0.2}, "predicted_grade": "PSA 8",
                               "graded_comps": [], "pop": {"psa_total": 1, "psa_10": 0, "psa_9": 0, "note": ""}, "raw_value": 35, "recommended_grader": "PSA", "grading_notes": ""}})

    class FakeResp2(FakeResp):
        content = [FakeBlock("text", json.dumps(graded))]

    class FakeMessages3(FakeMessages):
        def create(self, **kw):
            assert kw["tools"][0]["max_uses"] == 5  # cards get the deeper pass
            return FakeResp2()

    valuer.client = type("C", (), {"messages": FakeMessages3()})()
    v = valuer.value({"id": 7, "title": "1989 Upper Deck Ken Griffey Jr #1 rookie", "description": "", "quantity": 1})
    assert v.grading and v.mid == 35 and v.low == 28 and "raw" in v.confidence_reason
    valuer.client = FakeClient()  # back to the plain fake for non-card lots

    # pipeline uses the injected valuer and caches by title
    store = Store(settings.db_path)
    pipe = ValuationPipeline(settings, store, claude_valuer=valuer)
    lot = {"id": 5, "title": "DeWalt DCD996 drill", "description": "", "quantity": 1, "is_closed": False}
    pipe.value_lot(lot)
    assert store.get_valuation(5)["method"] == "claude+web"
    twin = dict(lot, id=6)
    v2 = pipe.value_lot(twin)
    assert store.get_valuation(6)["cache_hit"] is True and v2.mid == 110
    store.close()


def test_api_surface(settings):
    from arb.demo import load_demo
    from arb.server import create_app
    store = Store(settings.db_path)
    load_demo(store, settings)
    app = create_app(settings, store, Scanner(settings, store))
    c = TestClient(app)
    assert c.get("/").status_code == 200 and "Spread Hunter" in c.get("/").text
    opps = c.get("/api/opportunities").json()
    assert opps["count"] > 50 and opps["opportunities"][0]["score"]["score"] >= opps["opportunities"][-1]["score"]["score"]
    top = opps["opportunities"][0]
    assert top["why"] and top["valuation"]["comps"] and top["listing"]["points"][1]["net"] > 0
    assert any(o["score"].get("sweet_spot") for o in opps["opportunities"])
    cats = c.get("/api/categories").json()
    assert cats and cats[0]["best_score"] >= cats[-1]["best_score"]
    assert c.get(f"/api/lot/{top['lot']['id']}").json()["lot"]["id"] == top["lot"]["id"]
    assert c.get("/api/lot/1").status_code == 404
    st = c.get("/api/scan/status").json()
    assert st["stats"]["open_lots"] > 50
    filt = c.get("/api/opportunities", params={"category": cats[0]["category"], "min_score": 40}).json()
    assert all(o["lot"]["category"] == cats[0]["category"] for o in filt["opportunities"])
    # kick a background scan against the mock and wait for it
    r = c.post("/api/scan", json={"hours": 24, "max_pages": 3, "value": False})
    assert r.json()["started"]
    for _ in range(100):
        if not c.get("/api/scan/status").json()["status"]["running"]:
            break
        time.sleep(0.1)
    assert c.get("/api/scan/status").json()["status"]["phase"] == "done"
    store.close()


def test_card_detection_and_grading_economics(settings):
    from arb.valuation.claude import is_card
    from arb.scoring import grading_economics
    assert is_card({"title": "1989 Upper Deck Ken Griffey Jr #1 Rookie", "category_path": "Collectibles"})
    assert is_card({"title": "Lot of 1987 Topps baseball cards", "category_path": ""})
    assert not is_card({"title": "G) Noritake wall pocket", "category_path": "Collectibles > Decorative"})
    assert not is_card({"title": "Lot 4811 misc tools", "category_path": "Tools"})
    from arb.demo import DEMO_GRADING
    g = next(iter(DEMO_GRADING.values()))
    val = {"mid": 35.0, "grading": g}
    sc = {"landed_cost": 5.0}
    ge = grading_economics(val, sc, settings)
    assert ge and ge["prices"]["10"] == 1180 or ge["prices"]["10"] == 1250
    assert abs(sum(ge["probabilities"].values()) - 1) < 1e-9
    ev = sum(ge["probabilities"][b] * ge["prices"][b] for b in ("10", "9", "8", "7-"))
    assert abs(ge["ev_gross"] - ev) < 1e-6
    assert ge["graded_net"] == ev * (1 - settings.resale_fee) - settings.grading_fee - settings.grading_ship - settings.packaging_cost
    assert ge["grading_cost"] == settings.grading_fee + settings.grading_ship + settings.packaging_cost
    # a common Griffey with a 4% gem rate does not clear ~$90 of grading cost
    assert ge["upside"] < 25 and ge["recommendation"] == "sell raw"
    # a card whose 9 alone clears the cost gets "grade"; one that needs the 10 is flagged speculative
    strong = dict(g, grade_probabilities={"psa10": 0.10, "psa9": 0.55, "psa8": 0.30, "psa7_or_below": 0.05},
                  graded_comps=[{"grader": "PSA", "grade": "10", "price": 900, "source": "", "url": "", "date": ""},
                                {"grader": "PSA", "grade": "9", "price": 300, "source": "", "url": "", "date": ""},
                                {"grader": "PSA", "grade": "8", "price": 120, "source": "", "url": "", "date": ""}], raw_value=60)
    assert grading_economics({"mid": 60.0, "grading": strong}, sc, settings)["recommendation"] == "grade"
    lottery = dict(strong, grade_probabilities={"psa10": 0.12, "psa9": 0.30, "psa8": 0.40, "psa7_or_below": 0.18},
                   graded_comps=[{"grader": "PSA", "grade": "10", "price": 2500, "source": "", "url": "", "date": ""},
                                 {"grader": "PSA", "grade": "9", "price": 90, "source": "", "url": "", "date": ""},
                                 {"grader": "PSA", "grade": "8", "price": 50, "source": "", "url": "", "date": ""}], raw_value=40)
    assert grading_economics({"mid": 40.0, "grading": lottery}, sc, settings)["recommendation"].startswith("speculative")
    assert grading_economics({"mid": 10.0, "grading": None}, sc, settings) is None


def test_calibration_math(settings):
    from arb.calibration import build_report, adjustment_for, hammer_ratio, sale_ratio

    def closed(cat, n, ratio, sales=()):
        """n closed lots in `cat` whose landed-at-hammer is `ratio` x our predicted net."""
        rows = []
        for i in range(n):
            rec = {"lot_id": 1000 + len(rows) + hash(cat) % 500, "title": f"{cat} {i}", "category": cat,
                   "closed_at": 0, "predicted_low": 80, "predicted_mid": 100, "predicted_high": 120,
                   "predicted_net": 85, "confidence": 0.7, "method": "claude+web", "score": 50,
                   "hammer": 85 * ratio / 1.15, "landed_at_hammer": 85 * ratio,
                   "bought": None, "bought_price": None, "sale_price": None, "sale_at": None,
                   "sale_channel": "", "notes": "", "recorded_at": 0}
            if i < len(sales):
                rec["sale_price"] = 100 * sales[i]
                rec["bought_price"] = 20
            rec["lot_id"] = len(rows) * 7 + abs(hash(cat)) % 1000
            rows.append(rec)
        return rows

    # A category we are consistently outbid on at our own number is inflated -> haircut, never inflate.
    bad = build_report(closed("Furniture", 12, 1.3), settings)
    fur = next(c for c in bad["categories"] if c["category"] == "Furniture")
    assert fur["overshoot_rate"] == 1.0 and fur["basis"] == "hammer"
    assert fur["bias"] < 1 and fur["confidence_factor"] < 1

    # A healthy category (hammer well under our net) is left alone.
    good = build_report(closed("Tools", 12, 0.3), settings)
    tools = next(c for c in good["categories"] if c["category"] == "Tools")
    assert tools["overshoot_rate"] == 0.0 and tools["bias"] == 1.0

    # Real sales are ground truth and override the hammer signal, and may raise as well as cut.
    rows = closed("Coins", 12, 1.3, sales=[1.2, 1.25, 1.15, 1.2, 1.3, 1.2])
    rep = build_report(rows, settings)
    coins = next(c for c in rep["categories"] if c["category"] == "Coins")
    assert coins["basis"] == "sales" and coins["n_sold"] == 6 and coins["bias"] > 1

    # Below the sample floor nothing is applied.
    thin = build_report(closed("Art", 3, 1.5), settings)
    assert next(c for c in thin["categories"] if c["category"] == "Art")["basis"] == "none"
    assert adjustment_for(thin, "Art", settings)["bias"] == 1.0

    # Bias is clamped even on wild data.
    wild = build_report(closed("Toys", 12, 1.0, sales=[9, 9, 9, 9, 9, 9]), settings)
    assert next(c for c in wild["categories"] if c["category"] == "Toys")["bias"] == settings.calibration_max_bias

    # Falls back to the global row when the category itself has no basis.
    assert adjustment_for(bad, "Never Seen", settings)["bias"] < 1
    assert hammer_ratio({"landed_at_hammer": 50, "predicted_net": 100}) == 0.5
    assert sale_ratio({"sale_price": 90, "predicted_mid": 100}) == 0.9
    assert sale_ratio({"sale_price": None, "predicted_mid": 100}) is None


def test_settlement_and_feedback(settings, monkeypatch):
    """A closed lot's realized price is captured, and it bends the next valuation in that category."""
    from arb.demo import make_demo_outcomes
    store = Store(settings.db_path)
    sc = Scanner(settings, store)
    st = sc.scan(status="OPEN", hours=24, max_pages=3, value=True, max_value=6)
    assert not st["error"]
    lots = store.lots()
    assert lots
    valued = store.valuations_for([l["id"] for l in lots])
    assert valued

    # Pretend those auctions ended with a hammer price well above what we predicted.
    now = time.time()
    for lot in (l for l in lots if l["id"] in valued):
        store.upsert_lots([dict(lot, ends_at=now - 60)])
    monkeypatch.setattr(sc.client, "lot_state",
                        lambda lot_id: {"isClosed": True, "status": "CLOSED", "priceRealized": 500.0,
                                        "highBid": 500.0, "minBid": 505.0, "bidCount": 9, "timeLeftSeconds": 0})
    settled = sc.settle_closed_lots(limit=len(valued))
    assert settled == len(valued)
    rec = store.outcomes()[0]
    assert rec["hammer"] == 500.0 and rec["landed_at_hammer"] > 500.0
    assert store.get_outcome(rec["lot_id"])["lot_id"] == rec["lot_id"]
    # Already-settled lots are not re-queued.
    assert all(o["lot_id"] != rec["lot_id"] for o in store.awaiting_settlement(50))

    # With enough history the pipeline scales a fresh valuation and stamps it.
    for o in make_demo_outcomes():
        store.save_outcome(o)
    report = sc.calibration(force=True)
    assert report["totals"]["closed"] > 20
    fur = next(c for c in report["categories"] if c["category"] == "Furniture")
    assert fur["basis"] == "hammer" and fur["bias"] < 1

    from arb.valuation import ValuationPipeline
    pipe = ValuationPipeline(settings, store, calibration_fetcher=lambda: report)
    lot = {"id": 999001, "title": "Herman Miller Aeron chair", "description": "", "quantity": 1,
           "category": "Furniture", "estimate": "$300 - $400", "is_closed": False}
    v = pipe.value_lot(lot, force=True)
    assert v.calibration and v.calibration["bias"] == fur["bias"]
    assert v.mid == round(350 * fur["bias"], 2)
    assert "Calibrated" in v.confidence_reason
    store.close()


def test_liquidity_math(settings):
    """The hazard model: sold-vs-active decides how long your money is stuck, not the price tag."""
    from arb.liquidity import (assess_liquidity, daily_hazard, days_at_price, human_days,
                               liquidity_factor, monthly_roi, sell_through)

    # 180 sold in 90 days against 20 listed: two sales a day chasing 20 listings.
    fast = assess_liquidity({"sold_90d": 180, "active_now": 20, "trend": "flat"}, None)
    assert abs(fast["daily_hazard"] - (180 / 90) / 20) < 1e-4
    assert fast["days_p50"] < 8 and fast["grade"] == "A" and fast["depth"] == "deep"
    assert fast["sell_probability_30d"] > 0.95 and fast["basis"] == "market"

    # Same 90-day sales count, ten times the competition: ten times the wait.
    crowded = assess_liquidity({"sold_90d": 180, "active_now": 200, "trend": "flat"}, None)
    assert abs(crowded["days_p50"] / fast["days_p50"] - 10) < 0.5
    assert crowded["grade"] > fast["grade"]  # worse grades sort later in the alphabet

    # The case that motivates the whole layer: real value, no buyers.
    dead = assess_liquidity({"sold_90d": 2, "active_now": 150, "trend": "falling"}, None)
    assert dead["depth"] == "dead" and dead["grade"] == "F"
    # Floored at the max_days horizon: past a year "slower" stops meaning anything.
    assert dead["days_p50"] >= 360 and dead["sell_probability_30d"] < 0.1
    assert any("Crowded" in n for n in dead["notes"])
    assert sell_through(2, 150) == round(2 / 152, 3)

    # Zero sales is a measurement, not a gap: it must not fall through to the optimistic default.
    assert daily_hazard(0, 50) == 0.0005 and daily_hazard(None, 50) is None
    never = assess_liquidity({"sold_90d": 0, "active_now": 50, "trend": "flat"}, None)
    assert never["grade"] == "F" and never["basis"] == "market"

    # Degrading gracefully: researched days beat the demand word, which beats nothing.
    researched = assess_liquidity({"sold_90d": None, "active_now": None, "median_days_to_sell": 10},
                                  {"demand": "low"})
    assert researched["basis"] == "researched" and 9 < researched["days_p50"] < 11
    assumed = assess_liquidity(None, {"demand": "high", "days_to_sell": None})
    assert assumed["basis"] == "assumed" and 11 < assumed["days_p50"] < 13
    # An unresearched guess must not outrank a measured market of the same speed.
    measured_same = assess_liquidity({"sold_90d": 104, "active_now": 20, "trend": "flat"}, None)
    assert abs(measured_same["days_p50"] - assumed["days_p50"]) < 3
    assert measured_same["score"] > assumed["score"]
    # Nothing known at all is NOT the same as known-slow: it must not touch the score.
    blank = assess_liquidity(None, {"demand": "unknown", "days_to_sell": None})
    assert blank["basis"] == "none" and liquidity_factor(blank, 1.0) == 1.0
    assert "does not affect the score" in " ".join(blank["notes"])

    # The feedback multiplier stretches the estimate and relabels the basis.
    slow = assess_liquidity({"sold_90d": 180, "active_now": 20}, None, days_multiplier=2.0, measured_n=7)
    assert abs(slow["days_p50"] / fast["days_p50"] - 2) < 0.05
    assert slow["basis"] == "measured" and "7 listings" in " ".join(slow["notes"])

    # Velocity: the $25-in-a-week flip beats the $37-in-a-year one, which is the whole point.
    quick = monthly_roi(25, 3, 7 + 3)
    slow_big = monthly_roi(37, 3, 300)
    assert quick > slow_big * 20

    # The weight is the user's dial: 0 ignores liquidity entirely, 1 lets a dead market cut to a third.
    assert liquidity_factor(dead, 0) == 1.0
    assert 0.34 < liquidity_factor(dead, 1.0) < 0.4
    assert liquidity_factor(fast, 1.0) > 0.9   # grade A keeps essentially all of its score
    assert liquidity_factor(None, 1.0) == 1.0

    assert days_at_price(fast, "quick") < days_at_price(fast, "market") < days_at_price(fast, "patient")
    assert human_days(1) == "about a day" and human_days(21) == "3 weeks" and human_days(400).startswith("a year")


def test_liquidity_in_scoring(settings):
    """Two lots with identical spreads rank differently once liquidity is priced in."""
    now = time.time()
    lot = {"id": 1, "high_bid": 0.0, "min_bid": 2.0, "bid_count": 0, "ends_at": now + 1800,
           "buyer_premium_rate": 0.15, "quantity": 1, "category": "Collectibles"}
    liquid = {"mid": 40.0, "low": 30.0, "high": 50.0, "confidence": 0.8,
              "demand_signals": {"sold_90d": 200, "active_now": 25, "trend": "flat"}}
    stuck = {"mid": 40.0, "low": 30.0, "high": 50.0, "confidence": 0.8,
             "demand_signals": {"sold_90d": 2, "active_now": 180, "trend": "falling"}}

    a = score_lot(lot, liquid, settings, now=now)
    b = score_lot(lot, stuck, settings, now=now)
    # Same money, same clock: only the market underneath differs.
    assert abs(a["spread"] - b["spread"]) < 1e-9
    assert a["value_score"] == b["value_score"] and a["score_before_liquidity"] == b["score_before_liquidity"]
    assert a["score"] > b["score"] * 1.4
    assert a["liquidity"]["grade"] == "A" and b["liquidity"]["grade"] == "F"
    assert a["monthly_roi"] > b["monthly_roi"] * 10
    # Risk-adjusted profit discounts the one that probably will not sell at all.
    assert a["expected_profit_60d"] > a["spread"] * 0.9
    assert b["expected_profit_60d"] < b["spread"] * 0.2

    # Weight 0 must restore the old behaviour exactly.
    a0 = score_lot(lot, liquid, settings, now=now, liquidity_weight=0)
    b0 = score_lot(lot, stuck, settings, now=now, liquidity_weight=0)
    assert a0["score"] == b0["score"] == a0["score_before_liquidity"]

    from arb.scoring import liquidity_verdict, listing_economics
    assert "Fast money" in liquidity_verdict(a)
    assert "on paper" in liquidity_verdict(b)
    assert "sold in 90 days" in why_upside(lot, liquid, a, settings)

    # Price points get their days from the market, so the slow item's are longer.
    la = listing_economics(lot, liquid, a, settings)
    lb = listing_economics(lot, stuck, b, settings)
    assert la["points"][1]["expected_days"] < lb["points"][1]["expected_days"]
    assert la["points"][0]["monthly_roi"] > la["points"][2]["monthly_roi"]  # quick turns capital faster


def test_liquidity_feedback_and_intel(settings):
    """Recording what your listings actually did bends the speed model — including the unsold ones."""
    from arb.calibration import build_report, liquidity_adjustment_for, observed_days
    from arb.intel import apply_intel_filters, build_trends
    now = time.time()

    def listing(cat, predicted, actual, i, sold=True, age_days=200):
        listed_at = now - age_days * 86400
        return {"lot_id": hash((cat, i)) % 100000, "title": f"{cat} {i}", "category": cat,
                "closed_at": listed_at - 86400, "predicted_low": 80, "predicted_mid": 100,
                "predicted_high": 120, "predicted_net": 85, "confidence": 0.7, "method": "claude+web",
                "score": 50, "hammer": 20, "landed_at_hammer": 23,
                "bought": True, "bought_price": 23,
                "sale_price": 100 if sold else None,
                "sale_at": (listed_at + actual * 86400) if sold else None,
                "sale_channel": "eBay", "notes": "", "listed_at": listed_at,
                "list_price": 105, "still_listed": not sold, "views": 50, "watchers": 3,
                "predicted_days": predicted, "recorded_at": now}

    # Furniture: we said 10 days, it took 30. Five sales clears the sample floor (default 4).
    rows = [listing("Furniture", 10, 30, i) for i in range(5)]
    # Three unsold listings sitting for 200 days: censored evidence that must count against the rate.
    rows += [listing("Furniture", 10, 0, 100 + i, sold=False) for i in range(3)]
    rep = build_report(rows, settings)
    fur = next(c for c in rep["liquidity"]["categories"] if c["category"] == "Furniture")
    assert fur["basis"] == "measured" and abs(fur["days_multiplier"] - 3.0) < 0.01
    assert fur["n_listed"] == 8 and fur["n_sold"] == 5 and fur["stuck"] == 3
    # 5 of 8 sold, but none inside 30 days, and the 3 unsold are well past 30: the rate is 5/8 at best.
    assert fur["sell_rate_30d"] == round(5 / 8, 3)
    assert observed_days(rows[0]) == 30

    adj = liquidity_adjustment_for(rep["liquidity"], "Furniture")
    assert abs(adj["days_multiplier"] - 3.0) < 0.01 and adj["measured_n"] == 5
    # An unknown category falls back to the global measurement, not to 1.0.
    assert liquidity_adjustment_for(rep["liquidity"], "Nonexistent")["days_multiplier"] > 1

    # And that multiplier really does slow a fresh estimate down.
    lot = {"id": 9, "high_bid": 0.0, "min_bid": 5.0, "bid_count": 0, "ends_at": now + 3600,
           "buyer_premium_rate": 0.15, "quantity": 1, "category": "Furniture"}
    val = {"mid": 90.0, "low": 70.0, "high": 110.0, "confidence": 0.8,
           "demand_signals": {"sold_90d": 90, "active_now": 30, "trend": "flat"}}
    base = score_lot(lot, val, settings, now=now)
    bent = score_lot(lot, val, settings, now=now, **{k: v for k, v in adj.items()})
    assert abs(bent["liquidity"]["days_p50"] / base["liquidity"]["days_p50"] - 3.0) < 0.05
    assert bent["score"] < base["score"]

    # Below the sample floor nothing is applied: two sales is not a measurement.
    thin = build_report([listing("Art", 10, 40, i) for i in range(2)], settings)
    art = next(c for c in thin["liquidity"]["categories"] if c["category"] == "Art")
    assert art["basis"] == "none" and art["days_multiplier"] == 1.0

    # Trends: a category seen only once cannot claim a direction.
    def valuation(cat, age_days, sold_90d):
        return {"lot_id": 1, "mid": 50.0, "category": cat, "created_at": now - age_days * 86400,
                "demand_signals": {"sold_90d": sold_90d, "active_now": 50, "trend": "flat"},
                "demand": "medium", "comps": []}

    vals = [valuation("Tools", 18 - i, 20 + i * 12) for i in range(0, 18, 2)]  # steadily improving
    vals += [valuation("Art", 3, 4)]
    trends = build_trends(vals, settings, now=now)
    tools = next(t for t in trends if t["category"] == "Tools")
    art_t = next(t for t in trends if t["category"] == "Art")
    assert tools["direction"] == "warming" and tools["change"] > 0 and len(tools["points"]) >= 4
    assert art_t["direction"] == "new" and art_t["change"] is None

    # User parameters filter and re-rank without touching the underlying scores.
    opps = [{"lot": {"id": 1, "title": "fast", "category": "Tools"}, "valuation": {"mid": 40},
             "score": score_lot(dict(lot, id=1), {"mid": 40.0, "low": 30.0, "high": 50.0, "confidence": 0.8,
                                                  "demand_signals": {"sold_90d": 200, "active_now": 25}},
                                settings, now=now)},
            {"lot": {"id": 2, "title": "stuck", "category": "Art"}, "valuation": {"mid": 400},
             "score": score_lot(dict(lot, id=2), {"mid": 400.0, "low": 300.0, "high": 500.0, "confidence": 0.8,
                                                  "demand_signals": {"sold_90d": 2, "active_now": 180}},
                                settings, now=now)}]
    by_spread = apply_intel_filters(opps, rank_by="spread")
    by_velocity = apply_intel_filters(opps, rank_by="velocity")
    assert by_spread[0]["lot"]["id"] == 2      # the big number wins on paper
    assert by_velocity[0]["lot"]["id"] == 1    # the fast one wins on capital
    assert [o["lot"]["id"] for o in apply_intel_filters(opps, min_liquidity_grade="B")] == [1]
    assert [o["lot"]["id"] for o in apply_intel_filters(opps, max_days_to_sell=30)] == [1]
    assert len(apply_intel_filters(opps)) == 2  # no parameters, nothing dropped
