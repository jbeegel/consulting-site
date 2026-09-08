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
    # far-out lots get discounted
    far = score_lot(dict(lot, ends_at=now + 5 * 86400), val, settings, now=now)
    assert far["score"] < sc["score"]
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
    v = valuer.value({"id": 5, "title": "DeWalt DCD996 drill", "description": "", "quantity": 1})
    assert v.usable and v.method == "claude+web" and v.mid == 110 and v.comps[0]["price"] == 105

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
    assert top["why"] and top["valuation"]["comps"]
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
