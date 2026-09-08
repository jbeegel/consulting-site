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
    assert ge["upside"] > 0 and ge["recommendation"] == "grade"
    assert grading_economics({"mid": 10.0, "grading": None}, sc, settings) is None
