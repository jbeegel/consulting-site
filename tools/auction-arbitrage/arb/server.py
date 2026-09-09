"""FastAPI app: JSON API + the single-page dashboard."""
from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from .config import Settings, load
from .calibration import build_report
from .db import Store
from .scanner import Scanner
from .scoring import TIME_BUCKETS, grading_economics, listing_economics, score_lot, why_upside

log = logging.getLogger(__name__)
STATIC = Path(__file__).parent / "static"


class ScanRequest(BaseModel):
    status: str = "OPEN"
    hours: float | None = 24
    category: int | None = None
    search_text: str | None = None
    zip: str | None = None
    miles: int | None = None
    max_pages: int = 10
    max_value: int | None = 40
    value: bool = True


def build_opportunity(lot: dict[str, Any], val: dict[str, Any] | None, s: Settings, now: float) -> dict[str, Any]:
    sc = score_lot(lot, val, s, now=now)
    return {
        "lot": lot,
        "valuation": val,
        "score": sc,
        "why": why_upside(lot, val, sc, s) if val else "",
        "listing": listing_economics(lot, val, sc, s),
        "grading": grading_economics(val, sc, s),
    }


def create_app(settings: Settings | None = None, store: Store | None = None, scanner: Scanner | None = None) -> FastAPI:
    s = settings or load()
    db = store or Store(s.db_path)
    sc = scanner or Scanner(s, db)
    app = FastAPI(title="Auction Arbitrage", version="0.1")
    app.state.settings, app.state.store, app.state.scanner = s, db, sc

    @app.get("/")
    def index():
        return FileResponse(STATIC / "index.html")

    @app.get("/api/config")
    def config():
        return {
            "buyer_premium": s.default_buyer_premium, "sales_tax": s.sales_tax, "resale_fee": s.resale_fee,
            "resale_shipping": s.resale_shipping, "pickup_cost": s.pickup_cost, "model": s.model,
            "valuer": s.valuer, "claude_enabled": s.anthropic_available and s.valuer in ("auto", "claude"),
            "ebay_sold": s.ebay_sold, "hibid": s.hibid_site, "time_buckets": [b[0] for b in TIME_BUCKETS],
            "sweet_spot": {"max_landed": s.sweet_spot_max_landed, "min_net": s.sweet_spot_min_net},
            "calibration": {"enabled": s.calibration, "min_closed": s.calibration_min_closed, "min_sales": s.calibration_min_sales},
            "vision": s.vision, "radar_levels": ["strike", "watch", "track", "scan"],
            "grading": {"enabled": s.grading, "fee": s.grading_fee, "ship": s.grading_ship, "days": s.grading_days},
            "ebay_fees": {"fvf": s.ebay_fvf, "fvf_media": s.ebay_fvf_media, "per_order": s.ebay_per_order, "packaging": s.packaging_cost},
        }

    @app.get("/api/opportunities")
    def opportunities(hours: float | None = Query(None), category: str | None = None, min_score: float = 0,
                      q: str | None = None, include_unvalued: bool = True, limit: int = 2000):
        now = time.time()
        lots = db.lots(ends_before=(now + hours * 3600) if hours else None, ends_after=now - 60,
                       category=category or None)
        vals = db.valuations_for([l["id"] for l in lots])
        out = []
        ql = (q or "").lower()
        for lot in lots:
            if ql and ql not in (lot.get("title", "") + " " + lot.get("auction_name", "")).lower():
                continue
            v = vals.get(lot["id"])
            if not v and not include_unvalued:
                continue
            opp = build_opportunity(lot, v, s, now)
            if opp["score"]["score"] < min_score and v:
                continue
            out.append(opp)
        out.sort(key=lambda o: (o["score"]["score"], o["score"].get("spread") or 0), reverse=True)
        return {"generated_at": now, "count": len(out), "opportunities": out[:limit]}

    @app.get("/api/lot/{lot_id}")
    def lot(lot_id: int, enrich: bool = False):
        l = db.get_lot(lot_id)
        if not l:
            raise HTTPException(404, "unknown lot")
        if enrich and not l.get("pictures"):
            try:
                l = sc.enrich_lot(lot_id) or l
            except Exception as e:  # HiBid hiccup shouldn't break the dossier
                log.warning("enrich failed: %s", e)
        return build_opportunity(l, db.get_valuation(lot_id), s, time.time())

    @app.post("/api/lot/{lot_id}/refresh")
    def refresh(lot_id: int):
        try:
            l = sc.refresh_lot(lot_id)
        except Exception as e:
            raise HTTPException(502, f"HiBid refresh failed: {e}")
        if not l:
            raise HTTPException(404, "unknown lot")
        return build_opportunity(l, db.get_valuation(lot_id), s, time.time())

    @app.post("/api/lot/{lot_id}/revalue")
    def revalue(lot_id: int):
        l = db.get_lot(lot_id)
        if not l:
            raise HTTPException(404, "unknown lot")
        v = sc.pipeline.value_lot(l, force=True)
        return build_opportunity(l, v.to_dict(), s, time.time())

    @app.post("/api/refresh")
    def refresh_many(body: dict[str, list[int]]):
        ids = [int(i) for i in body.get("ids", [])][:60]
        try:
            n = sc.refresh_many(ids)
        except Exception as e:
            raise HTTPException(502, f"HiBid refresh failed: {e}")
        return {"refreshed": n}

    @app.post("/api/scan")
    def scan(req: ScanRequest):
        started = sc.scan_in_background(status=req.status, hours=req.hours, category=req.category,
                                        search_text=req.search_text, zip=req.zip, miles=req.miles,
                                        max_pages=req.max_pages, value=req.value, max_value=req.max_value)
        if not started:
            return JSONResponse({"started": False, "status": sc.status.snapshot()}, status_code=409)
        return {"started": True, "status": sc.status.snapshot()}

    @app.get("/api/scan/status")
    def scan_status():
        return {"status": sc.status.snapshot(), "last_scan": db.last_scan(), "stats": db.stats()}

    @app.get("/api/calibration")
    def calibration(rows: bool = False):
        outcomes = db.outcomes()
        report = build_report(outcomes, s)
        return {**report, "enabled": s.calibration, "min_closed": s.calibration_min_closed,
                "min_sales": s.calibration_min_sales, "outcomes": outcomes[:500] if rows else None}

    @app.post("/api/lot/{lot_id}/sale")
    def record_sale(lot_id: int, body: dict[str, Any]):
        """Record what a lot actually did for you. Ground truth beats auction hammer prices."""
        existing = db.get_outcome(lot_id)
        lot = db.get_lot(lot_id)
        if not existing and not lot:
            raise HTTPException(404, "unknown lot")
        if existing:
            base = existing
        else:
            val = db.get_valuation(lot_id)
            sc = score_lot(lot, val, s)
            base = {"lot_id": lot_id, "title": lot.get("title"), "category": lot.get("category") or "Uncategorized",
                    "closed_at": lot.get("ends_at") or time.time(), "predicted_low": (val or {}).get("low"),
                    "predicted_mid": (val or {}).get("mid"), "predicted_high": (val or {}).get("high"),
                    "predicted_net": sc.get("net_resale"), "confidence": (val or {}).get("confidence", 0),
                    "method": (val or {}).get("method", "none"), "score": sc.get("score", 0),
                    "hammer": None, "landed_at_hammer": None, "bought": None, "bought_price": None,
                    "sale_price": None, "sale_at": None, "sale_channel": "", "notes": ""}

        def num(v):
            try:
                f = float(v)
                return f if f > 0 else None
            except (TypeError, ValueError):
                return None

        paid, sold = num(body.get("bought_price")), num(body.get("sale_price"))
        updated = {**base,
                   "bought": body.get("bought", True if paid is not None else base.get("bought")),
                   "bought_price": paid if paid is not None else base.get("bought_price"),
                   "sale_price": sold if sold is not None else base.get("sale_price"),
                   "sale_at": body.get("sale_at") or (time.time() if sold is not None else base.get("sale_at")),
                   "sale_channel": body.get("sale_channel", base.get("sale_channel", "")),
                   "notes": body.get("notes", base.get("notes", "")),
                   "recorded_at": time.time()}
        db.save_outcome(updated)
        return {"outcome": updated}

    @app.get("/api/categories")
    def categories():
        lots = db.lots(ends_after=time.time() - 60)
        vals = db.valuations_for([l["id"] for l in lots])
        agg: dict[str, dict[str, Any]] = {}
        now = time.time()
        for l in lots:
            c = l.get("category") or "Uncategorized"
            a = agg.setdefault(c, {"category": c, "lots": 0, "valued": 0, "best_score": 0.0, "hot": 0})
            a["lots"] += 1
            v = vals.get(l["id"])
            if v:
                a["valued"] += 1
                scr = score_lot(l, v, s, now=now)["score"]
                a["best_score"] = max(a["best_score"], scr)
                if scr >= 60:
                    a["hot"] += 1
        return sorted(agg.values(), key=lambda a: (-a["best_score"], -a["lots"]))

    return app


