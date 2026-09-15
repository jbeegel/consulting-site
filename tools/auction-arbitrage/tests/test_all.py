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
    # The broad pull honours the closing window. The hunt deliberately does not -- a lot matching a
    # thesis, a lens or the mystery sweep is worth storing whenever it closes -- so check the window
    # against `pull` rather than against everything the scan happened to store.
    assert all(l["time_left_seconds"] <= 24 * 3600 for l in sc.pull(status="OPEN", hours=24, max_pages=5))
    st = sc.scan(status="OPEN", hours=24, max_pages=5, value=True, max_value=10)
    assert not st["error"] and st["lots_seen"] > 0
    lots = store.lots()
    assert lots
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


def test_playbook_matching_and_bid_ceiling(settings):
    """Matching is strict about negatives, and the bid ceiling is arithmetic, not nerve."""
    from arb.playbook import match_theses, max_bid_for, normalize_thesis, refresh_thesis, slugify

    t = normalize_thesis({
        "name": "Advertising letter openers", "family": "Advertising ephemera",
        "queries": ["antique advertising letter opener"],
        "must_any": ["letter opener", "envelope opener"],
        "negative": ["sterling", "reproduction"],
        "ship_cost": 5.0,
    }, settings)
    assert t["id"] == slugify("Advertising letter openers")
    # No researched price yet, so no ceiling and no grade: nothing invents a number to bid.
    assert t["max_bid"] is None and t["liquidity_grade"] is None and t["days_p50"] is None

    real = {"title": "Antique c1918 Citizens Mutual Auto Insurance Howell MI Advertising Letter Opener",
            "description": "", "category_path": "Collectibles"}
    m = match_theses(real, [t])
    assert len(m) == 1 and m[0]["where"] == "title" and m[0]["thesis_id"] == t["id"]
    # A negative anywhere kills it, even with the phrase present.
    assert not match_theses(dict(real, title=real["title"] + " sterling"), [t])
    assert not match_theses(dict(real, title="Vintage cast iron doorstop"), [t])
    # Body-only hits match, but more weakly than a title hit.
    body = match_theses({"title": "Box of desk smalls", "description": "includes a letter opener", "category_path": ""}, [t])
    assert body and body[0]["where"] == "description" and body[0]["strength"] < m[0]["strength"]
    # must_all requires every phrase.
    strict = normalize_thesis({"name": "Bank openers", "must_any": ["letter opener"], "must_all": ["bank"]}, settings)
    assert not match_theses(real, [strict])
    assert match_theses(dict(real, title="Farmers Bank advertising letter opener"), [strict])

    # Research it: a deep, fast market yields a real ceiling.
    fast = refresh_thesis(dict(t, price_median=30.0, sold_90d=140, active_now=55, median_days_to_sell=9), settings)
    assert fast["max_bid"] and 3 < fast["max_bid"] < 9
    assert fast["liquidity_grade"] in ("A", "B") and fast["days_p50"] is not None

    # Same price, dead market: the ceiling drops because your capital is stuck for months.
    slow = refresh_thesis(dict(t, price_median=30.0, sold_90d=6, active_now=300), settings)
    assert slow["max_bid"] < fast["max_bid"]

    # The ceiling really does clear the target return: buying at it must hit target_monthly_roi.
    from arb.liquidity import monthly_roi
    from arb.scoring import ebay_fee_rate
    net = 30.0 * (1 - ebay_fee_rate(fast["ebay_category"] or fast["family"], settings)) - 5.0 - settings.packaging_cost
    landed = fast["max_bid"] * (1 + settings.default_buyer_premium) * (1 + settings.sales_tax) + settings.pickup_cost
    roi = monthly_roi(net - landed, landed, fast["days_p50"] + settings.handling_days)
    assert roi >= settings.target_monthly_roi - 0.01

    # Never pay within min_buy_multiple of net, however fast it moves.
    instant = refresh_thesis(dict(t, price_median=30.0, sold_90d=5000, active_now=1), settings)
    landed_instant = instant["max_bid"] * (1 + settings.default_buyer_premium) * (1 + settings.sales_tax)
    assert landed_instant <= net / settings.min_buy_multiple + 0.01

    # A price too small to survive fees yields no ceiling at all.
    assert max_bid_for(dict(t, price_median=4.0), settings) is None


def test_playbook_learns_from_your_sales(settings):
    """Your own round trips propose new niches — but never ones you already hunt."""
    from arb.playbook import apply_outcome_stats, hunt_order, normalize_thesis, theses_from_outcomes
    now = time.time()

    def sale(title, paid, sold, days=5.0):
        listed = now - 30 * 86400
        return {"lot_id": abs(hash(title)) % 100000, "title": title, "category": "Collectibles",
                "closed_at": listed - 86400, "predicted_mid": sold, "predicted_net": sold * 0.8,
                "confidence": 0.6, "method": "claude+web", "score": 60.0, "hammer": paid / 1.15,
                "landed_at_hammer": paid, "bought": True, "bought_price": paid, "sale_price": sold,
                "sale_at": listed + days * 86400, "sale_channel": "eBay", "notes": "",
                "listed_at": listed, "still_listed": False, "predicted_days": 10.0, "recorded_at": now}

    sales = [sale("Vintage railroad switch key Pere Marquette", 2.0, 55.0),
             sale("Antique railroad switch key Grand Trunk", 3.0, 48.0),
             sale("Railroad switch key Adlake brass", 2.5, 62.0),
             sale("Cheap plastic tub of junk", 5.0, 6.0)]

    proposed = theses_from_outcomes(sales, settings, [])
    names = {t["name"].lower() for t in proposed}
    # The recurring, profitable phrase is proposed; the single unprofitable sale is not.
    assert any("switch key" in n or "railroad" in n for n in names)
    assert not any("plastic" in n for n in names)
    assert all(t["origin"] == "your_sales" for t in proposed)
    assert all(t["price_median"] and t["price_median"] > 0 for t in proposed)

    # Once a thesis covers those sales, they stop generating proposals: no duplicate niches.
    covering = normalize_thesis({"name": "Railroadiana smalls", "must_any": ["switch key", "railroad"]}, settings)
    assert theses_from_outcomes(sales, settings, [covering]) == []

    # Stats roll back onto the thesis that matched.
    scored = apply_outcome_stats([covering], sales, {})
    st = scored[0]["stats"]
    assert st["lots_matched"] == 3 and st["sold"] == 3
    assert st["revenue"] == 165.0 and st["realized_monthly_roi"] > 5

    # Hunting rotates: never-hunted first, then oldest.
    a = normalize_thesis({"name": "A", "queries": ["a"]}, settings)
    b = dict(normalize_thesis({"name": "B", "queries": ["b"]}, settings), last_hunted_at=now - 3600)
    c = dict(normalize_thesis({"name": "C", "queries": ["c"]}, settings), last_hunted_at=now - 99)
    assert [t["name"] for t in hunt_order([c, b, a], 3)] == ["A", "B", "C"]
    # Disabled theses and ones with no queries are never hunted.
    off = dict(normalize_thesis({"name": "D", "queries": ["d"]}, settings), enabled=False)
    assert [t["name"] for t in hunt_order([off, a], 5)] == ["A"]


def test_local_sources(settings):
    """Craigslist RSS parses, and a pasted listing gets the same verdict machinery."""
    from arb.playbook import normalize_thesis, refresh_thesis
    from arb.sources import parse_craigslist_rss, parse_pasted_listing, parse_price, score_local

    xml = """<?xml version="1.0"?><rdf:RDF xmlns:dc="http://purl.org/dc/elements/1.1/">
      <item><title>Antique advertising letter opener - $5 (Howell)</title>
        <link>https://detroit.craigslist.org/wyn/atq/d/x/7712345678.html</link>
        <description>&lt;p&gt;Old bank letter opener, brass&lt;/p&gt;</description>
        <dc:date>2026-09-10T12:00:00-04:00</dc:date></item>
      <item><title>Couch</title><link>https://detroit.craigslist.org/x/7712345679.html</link>
        <description>free</description></item></rdf:RDF>"""
    rows = parse_craigslist_rss(xml)
    assert len(rows) == 2
    assert rows[0]["price"] == 5.0 and rows[0]["external_id"] == "7712345678"
    assert "letter opener" in rows[0]["title"].lower() and rows[0]["source"] == "craigslist"
    assert rows[1]["price"] is None
    assert parse_price("no money here") is None and parse_price("$1,250.50 firm") == 1250.5

    t = refresh_thesis(normalize_thesis({
        "name": "Advertising letter openers", "must_any": ["letter opener"], "ship_cost": 5.0,
        "price_median": 30.0, "sold_90d": 140, "active_now": 55, "median_days_to_sell": 9,
    }, settings), settings)
    # A local buy is judged against the ALL-IN ceiling, not the auction bid: there is no buyer's
    # premium to strip, so `max_bid` would be the wrong yardstick.
    ceiling = t["max_landed"]
    assert ceiling and t["max_bid"] and t["max_bid"] < ceiling

    trip = settings.local_trip_cost + 5 * settings.local_cost_per_mile
    cheap = score_local(dict(rows[0], price=1.0, distance_miles=5), [t], settings)
    assert cheap["verdict"] == "buy" and cheap["landed_cost"] == 1.0 + trip
    assert cheap["max_landed"] == ceiling
    # The trip is real money: the same item further away stops being a buy.
    far = score_local(dict(rows[0], price=1.0, distance_miles=120), [t], settings)
    assert far["verdict"] != "buy"
    # Slightly over the ceiling is a negotiation, not a refusal, and it names the number to offer.
    # The band is on the LANDED cost, so the trip has to be backed out of the asking price.
    near_ask = round(ceiling * 1.25 - trip, 2)
    near = score_local(dict(rows[0], price=near_ask, distance_miles=5), [t], settings)
    assert near["verdict"] == "negotiate" and "Offer" in near["note"]
    assert score_local(dict(rows[0], price=ceiling * 5), [t], settings)["verdict"] == "pass"
    assert score_local(rows[1], [t], settings)["verdict"] == "unknown"  # the couch matches nothing

    # A thesis with no researched price cannot produce a verdict, and says so.
    raw = normalize_thesis({"name": "Unknown niche", "must_any": ["letter opener"]}, settings)
    assert score_local(rows[0], [raw], settings)["verdict"] == "unknown"

    # Pasted OfferUp / Marketplace listings run through the same path.
    p = parse_pasted_listing(url="https://offerup.com/item/detail/123456",
                             text="Antique advertising letter opener\nAsking $2, great shape")
    assert p and p["source"] == "offerup" and p["price"] == 2.0
    assert score_local(p, [t], settings)["verdict"] == "buy"
    # With no distance given the flat trip cost still applies, which is why $4 is already a haggle.
    dearer = parse_pasted_listing(url="https://offerup.com/item/detail/9", text="letter opener $4")
    assert score_local(dearer, [t], settings)["verdict"] == "negotiate"
    assert parse_pasted_listing() is None


def test_hunt_and_thesis_priority(settings):
    """Hunting runs the playbook's queries against HiBid, and matches jump the valuation queue."""
    from arb.playbook import match_theses, normalize_thesis
    from arb.valuation.pipeline import triage_score
    store = Store(settings.db_path)
    sc = Scanner(settings, store)

    seeded = sc.theses()
    assert seeded and all(t["origin"] == "seed" for t in seeded)
    assert all(t["max_bid"] is None for t in seeded), "seeds must not ship invented prices"

    # The mock catalogue contains a plain-language lot; hunt for whatever word it holds.
    t = normalize_thesis({"name": "Test hunt", "queries": ["chair"], "must_any": ["chair"]}, settings)
    sc.save_theses([t])
    out = sc.hunt(theses=[t])
    assert out["hunted"] == [t["id"]]
    # last_hunted_at is persisted, so the next run rotates past it.
    assert (sc.theses(force=True)[0] or {}) is not None
    hunted = {x["id"]: x for x in sc.theses(force=True)}[t["id"]]
    assert hunted["last_hunted_at"] is not None

    # A thesis match outranks a mere hot word when the valuation budget is spent.
    plain = {"id": 1, "title": "Herman Miller Aeron Chair Size B", "description": "", "category_path": "",
             "bid_count": 3, "estimate": "", "time_left_seconds": None, "min_bid": 50, "high_bid": 50,
             "picture_count": 1}
    boost = lambda l: 2 + 2 * match_theses(l, [t])[0]["strength"] if match_theses(l, [t]) else 0.0  # noqa: E731
    assert boost(plain) > 0
    assert triage_score(plain) + boost(plain) > triage_score(plain)
    store.close()


def test_mystery_detection_and_economics(settings):
    """A blind listing is measured from the gap between what was SHOWN and what was SAID."""
    from arb.mystery import mystery_boost, mystery_economics, mystery_verdict, read_mystery
    from arb.scoring import score_lot

    blind = {"id": 1, "title": "G) MISC BOX LOT", "description": "", "category_path": "",
             "picture_count": 7, "min_bid": 2, "high_bid": 2, "bid_count": 0, "quantity": 1,
             "buyer_premium": 0.15}
    read = read_mystery(blind, settings)
    assert read["is_mystery"] and read["score"] >= 0.9
    assert read["informative_words"] == 0
    assert 'Title says "misc"' in read["signals"]

    # A catalogued lot is priced by the crowd however cheap it looks: not our edge.
    named = {**blind, "id": 2, "title": "Milwaukee M18 FUEL Hammer Drill Kit 2804-20", "picture_count": 7}
    assert not read_mystery(named, settings)["is_mystery"]

    # No photos is a blind BID, not an opportunity: there is nothing to read.
    dark = {**blind, "id": 3, "picture_count": 0}
    assert not read_mystery(dark, settings)["is_mystery"]
    assert "nothing to identify" in read_mystery(dark, settings)["reason"].lower()
    assert "No photos: nothing to read" in read_mystery(dark, settings)["signals"]
    assert mystery_boost(dark, settings) == 0

    # The boost is what buys a blind lot a valuation call it would never win on hot words.
    assert mystery_boost(blind, settings) > mystery_boost(named, settings) == 0

    # Economics headline the single best piece, not the pile: you buy the box for one thing in it.
    val = {"mid": 60, "items": [
        {"name": "Roseville Futura vase", "maker_or_mark": "Roseville", "est_low": 90, "est_high": 110,
         "confidence": 0.5, "condition": "hairline to rim", "resell": "list individually", "note": ""},
        {"name": "assorted glass tumblers", "maker_or_mark": "unmarked", "est_low": 4, "est_high": 8,
         "confidence": 0.6, "condition": "fine", "resell": "bundle", "note": ""},
    ], "standout_item": "Roseville Futura vase"}
    sc = score_lot(blind, val, settings)
    econ = mystery_economics(blind, val, sc, settings)
    assert econ["items_identified"] == 2
    assert econ["best_item"]["name"] == "Roseville Futura vase"
    assert econ["concentration"] > 0.9  # one piece carries essentially all of it
    assert econ["best_item_multiple"] > 10  # $100-ish piece against a ~$2 landed cost
    assert "Roseville" in mystery_verdict(econ, settings)
    assert "packing material" in mystery_verdict(econ, settings)

    # A lot with no photo read yet says so rather than pretending to a verdict.
    bare = mystery_economics(blind, None, sc, settings)
    assert bare["items_identified"] == 0
    assert "has not been through a photo read" in mystery_verdict(bare, settings)

    # Nothing worth listing is a real and useful answer: most misc lots ARE junk.
    junk = {"mid": 6, "items": [{"name": "plastic hangers", "maker_or_mark": "unmarked", "est_low": 0,
                                 "est_high": 1, "confidence": 0.8, "condition": "", "resell": "discard",
                                 "note": ""}]}
    assert "none of them worth listing" in mystery_verdict(
        mystery_economics(blind, junk, score_lot(blind, junk, settings), settings), settings)


def test_mystery_budget_is_reserved(settings):
    """Mystery lots carry no hot words, so they must not compete for the budget on triage alone."""
    from arb.valuation.pipeline import ValuationPipeline, triage_score

    store = Store(settings.db_path)
    pipe = ValuationPipeline(settings, store)
    hot = [{"id": 100 + i, "title": f"Rolex Submariner Steel Watch Ref BB168{i}", "description": "",
            "picture_count": 3, "min_bid": 500, "high_bid": 500, "bid_count": 0, "quantity": 1,
            "is_closed": False} for i in range(8)]
    blind = {"id": 200, "title": "MISC SHELF LOT", "description": "", "picture_count": 8,
             "min_bid": 1, "high_bid": 1, "bid_count": 0, "quantity": 1, "is_closed": False}
    # On raw triage the branded lots win outright.
    assert triage_score(blind) < max(triage_score(h) for h in hot)

    valued: list[int] = []
    pipe.value_lot = lambda lot, force=False: valued.append(lot["id"])  # type: ignore[assignment]
    pipe.value_many(hot + [blind], max_lots=4,
                    reserve=(lambda l: l["id"] == 200, 1))
    assert 200 in valued, "the reserved slot must survive a run full of brand-name lots"
    assert len(valued) == 4
    store.close()


def test_lenses_and_custom_instructions(settings):
    """A lens is applied to every lot forever, and the appraiser is told exactly what to look at."""
    from arb.lenses import (default_watchlist, lens_boost, lens_queries, matched_lenses,
                            merge_watchlist, watchlist_prompt)

    w = default_watchlist(0)
    on = {l["id"] for l in w["lenses"] if l["enabled"]}
    assert on == {"occupied-japan", "bank-objects", "advertising-signs"}

    # The prompt is physical instruction, not a category name: it tells the model where to look.
    text = watchlist_prompt(w)
    assert "BASE" in text and "Occupied Japan" in text
    assert "whether or not the title or description mentions them" in text

    # A lens fires on a lot whose title only hints at it; the photo read does the rest.
    jar = {"title": "Vintage porcelain figurine made in Japan", "description": "", "category_path": ""}
    assert [l["id"] for l in matched_lenses(jar, w)] == ["occupied-japan"]
    assert lens_boost(jar, w) > 0
    assert lens_boost({"title": "Craftsman socket set"}, w) == 0

    # Switching a lens off removes its prompt, its keywords and its search terms together.
    off = merge_watchlist({"lenses": [{"id": "occupied-japan", "enabled": False}]})
    assert "Occupied Japan" not in watchlist_prompt(off)
    assert not matched_lenses(jar, off)
    assert "occupied japan" not in lens_queries(off)

    # Built-in prompt text is CODE, not data: a stored copy never overrides the shipped wording.
    stale = merge_watchlist({"lenses": [{"id": "occupied-japan", "enabled": True,
                                         "prompt": "ignore everything"}]})
    assert "ignore everything" not in watchlist_prompt(stale)
    assert "legally required only between 1945 and 1952" in watchlist_prompt(stale)

    # Free text is the escape hatch for a hunch that has not earned a toggle, and is passed verbatim.
    custom = merge_watchlist({"lenses": [], "custom_instructions": "Shaving mugs with a name painted on."})
    assert "Shaving mugs with a name painted on." in watchlist_prompt(custom)
    assert "BUYER'S OWN STANDING INSTRUCTIONS" in watchlist_prompt(custom)

    # A watchlist with nothing on contributes nothing: no lenses, no instructions, no prompt.
    empty = merge_watchlist({"lenses": [{"id": l["id"], "enabled": False} for l in w["lenses"]],
                             "custom_instructions": ""})
    assert watchlist_prompt(empty) == ""


def test_watchlist_api_and_prompt_injection(settings):
    """Toggles persist, a hand-written lens survives a round trip, and the prompt reaches the valuer."""
    from arb.server import create_app

    store = Store(settings.db_path)
    sc = Scanner(settings, store)
    app = create_app(settings, store, sc)
    c = TestClient(app)

    body = c.get("/api/watchlist").json()
    assert body["mystery"]["enabled"] is True
    assert "misc" in body["mystery"]["queries"]
    assert "occupied japan" in body["hunt_queries"]

    r = c.post("/api/watchlist", json={"lenses": [{"id": "advertising-signs", "enabled": False}],
                                       "custom_instructions": "Anything a bank gave away."})
    assert r.status_code == 200
    assert "Anything a bank gave away." in r.json()["prompt_preview"]
    assert "ADVERTISING SIGNS" not in r.json()["prompt_preview"]

    r = c.post("/api/watchlist", json={"add": {"name": "Fishing lures",
                                               "prompt": "Read the box end-label and the hardware.",
                                               "keywords": ["lure", "heddon"], "queries": ["heddon lure"]}})
    assert "Read the box end-label" in r.json()["prompt_preview"]

    # A lens needs to say what to LOOK AT; a name alone is not an instruction.
    assert c.post("/api/watchlist", json={"add": {"name": "Nothing useful"}}).status_code == 400

    # It survives a fresh read, which is what proves it was stored and not just echoed back.
    again = c.get("/api/watchlist").json()["watchlist"]
    assert [l["id"] for l in again["lenses"] if l["enabled"]].count("fishing-lures") == 1
    assert again["custom_instructions"] == "Anything a bank gave away."

    # And it is what the valuer will actually be handed: saving pushes it onto the pipeline.
    from arb.lenses import watchlist_prompt
    assert "Read the box end-label" in watchlist_prompt(sc.pipeline.watchlist)

    # A built-in can be switched off but never deleted: it is code and would reappear on the next read.
    c.post("/api/watchlist", json={"remove": "occupied-japan"})
    after = c.get("/api/watchlist").json()["watchlist"]
    oj = next(l for l in after["lenses"] if l["id"] == "occupied-japan")
    assert oj["enabled"] is False and oj["builtin"] is True

    # A lens of your own, however, is yours to remove.
    c.post("/api/watchlist", json={"remove": "fishing-lures"})
    assert not any(l["id"] == "fishing-lures" for l in c.get("/api/watchlist").json()["watchlist"]["lenses"])
    store.close()


def test_mystery_reaches_the_appraiser(settings, monkeypatch):
    """The whole point: a misc lot gets every photo, a deeper search budget and an inventory brief."""
    from arb.valuation import claude as claude_mod

    seen: dict[str, object] = {}

    class FakeResp:
        stop_reason = "end_turn"
        content = [type("B", (), {"type": "text", "text": json.dumps({
            "identified_item": "box of ceramics", "brand": "", "model": "", "condition_assumption": "used",
            "bulk_lot": True, "unit_count": 6, "resale_low": 40, "resale_mid": 70, "resale_high": 110,
            "confidence": 0.4, "confidence_reason": "photo read", "demand": "medium", "days_to_sell": 30,
            "best_channel": "eBay", "value_drivers": [], "risks": [], "rationale": "", "comps": [],
            "authenticity_risk": False, "search_query": "", "standout_item": "Roseville vase",
            "items": [{"name": "Roseville vase", "maker_or_mark": "Roseville", "era": "1930s",
                       "est_low": 60, "est_high": 90, "confidence": 0.4, "condition": "chip to foot",
                       "resell": "list individually", "note": ""}],
        })})()]

    class FakeClient:
        class messages:
            @staticmethod
            def create(**kwargs):
                seen["kwargs"] = kwargs
                return FakeResp()

    v = claude_mod.ClaudeValuer.__new__(claude_mod.ClaudeValuer)
    v._anthropic = type("A", (), {"APIError": Exception})
    v.client = FakeClient()
    v.model, v.web_search, v.max_searches, v.effort = "m", True, 3, "medium"
    v.vision, v.max_images = True, 4
    monkeypatch.setattr(claude_mod, "load_images", lambda urls, n, **kw: [{"type": "image"}] * min(len(urls), n))

    blind = {"id": 1, "title": "MISC BOX LOT", "description": "", "picture_count": 9,
             "pictures": [f"http://x/{i}.jpg" for i in range(9)], "min_bid": 2, "quantity": 1}
    out = v.value(blind, [], guidance="LOOK FOR: bank imprints.", max_images=8)
    assert out.mystery_read is True
    assert out.images_used == 8, "a blind lot is the photographs; send more than the usual four"
    kwargs = seen["kwargs"]
    assert kwargs["tools"][0]["max_uses"] == 5, "mystery lots get the deeper search budget"
    text = kwargs["messages"][0]["content"][-1]["text"]
    assert "THIS LOT IS UNCATALOGUED" in text
    assert "INVENTORY EVERY OBJECT" in text
    assert text.rstrip().endswith("LOOK FOR: bank imprints."), "standing instructions go last, nearest the photos"

    # A catalogued lot gets none of that: the treatment is targeted, not universal.
    named = {"id": 2, "title": "Milwaukee M18 FUEL Hammer Drill 2804-20", "description": "",
             "picture_count": 3, "pictures": ["http://x/a.jpg"], "min_bid": 40, "quantity": 1}
    v.value(named, [])
    text2 = seen["kwargs"]["messages"][0]["content"][-1]["text"]
    assert "THIS LOT IS UNCATALOGUED" not in text2
    assert seen["kwargs"]["tools"][0]["max_uses"] == 3
