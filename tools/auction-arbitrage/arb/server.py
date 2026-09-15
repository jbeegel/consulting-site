"""FastAPI app: JSON API + the single-page dashboard."""
from __future__ import annotations

import re
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
from .intel import apply_intel_filters
from .lenses import lens_queries, matched_lenses, watchlist_prompt
from .mystery import MYSTERY_QUERIES, mystery_economics
from .playbook import match_theses, normalize_thesis, refresh_thesis
from .sources import hunt_local, parse_pasted_listing, score_local
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


def _slug(name: str) -> str:
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", name.lower()))[:60]


def build_opportunity(lot: dict[str, Any], val: dict[str, Any] | None, s: Settings, now: float,
                      score_opts: dict[str, Any] | None = None,
                      theses: list[dict[str, Any]] | None = None,
                      watchlist: dict[str, Any] | None = None) -> dict[str, Any]:
    sc = score_lot(lot, val, s, now=now, **(score_opts or {}))
    # Playbook matches attach whether or not a valuation exists: a matched, unvalued penny lot already
    # has a researched price and a bid ceiling behind it, which is the whole point of hunting.
    hits = match_theses(lot, theses) if theses else []
    ceilings = [h["max_bid"] for h in hits if h.get("max_bid") is not None]
    return {
        "lot": lot,
        "valuation": val,
        "score": sc,
        "why": why_upside(lot, val, sc, s) if val else "",
        "listing": listing_economics(lot, val, sc, s),
        "grading": grading_economics(val, sc, s),
        "theses": hits,
        "max_bid": min(ceilings) if ceilings else None,
        # A mystery read attaches before any valuation: "this lot is unpriced" is knowable from the
        # listing alone, and is the reason to spend a call on it.
        "mystery": mystery_economics(lot, val, sc, s),
        "lenses": ([{"id": l["id"], "name": l["name"]} for l in matched_lenses(lot, watchlist)]
                   if s.lenses else []),
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
                      q: str | None = None, include_unvalued: bool = True, limit: int = 2000,
                      liquidity_weight: float | None = None, handling_days: float | None = None,
                      min_liquidity_grade: str | None = None, max_days_to_sell: float | None = None,
                      rank_by: str = "score"):
        now = time.time()
        sc.calibration()  # warm the report card so every lot gets its category's measured speed
        theses = sc.theses()
        watchlist = sc.watchlist()
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
            opts = sc.score_options(lot.get("category") or "", liquidity_weight, handling_days)
            opp = build_opportunity(lot, v, s, now, opts, theses, watchlist)
            if opp["score"]["score"] < min_score and v:
                continue
            out.append(opp)
        ranked = apply_intel_filters(out, min_liquidity_grade=(min_liquidity_grade or "").upper() or None,
                                     max_days_to_sell=max_days_to_sell, rank_by=rank_by)
        return {"generated_at": now, "count": len(ranked), "opportunities": ranked[:limit]}

    @app.get("/api/intel")
    def intel(liquidity_weight: float | None = None, handling_days: float | None = None):
        """Market intel: category trends, velocity leaders and value traps, all from stored data."""
        board = sc.intel(liquidity_weight=liquidity_weight, handling_days=handling_days)
        return {**board, "settings": {
            "liquidity_weight": s.liquidity_weight if liquidity_weight is None else liquidity_weight,
            "handling_days": s.handling_days if handling_days is None else handling_days,
            "trend_window_days": s.trend_window_days, "liquidity_min_sales": s.liquidity_min_sales,
        }}

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
        return build_opportunity(l, db.get_valuation(lot_id), s, time.time(),
                                 theses=sc.theses(), watchlist=sc.watchlist())

    @app.post("/api/lot/{lot_id}/refresh")
    def refresh(lot_id: int):
        try:
            l = sc.refresh_lot(lot_id)
        except Exception as e:
            raise HTTPException(502, f"HiBid refresh failed: {e}")
        if not l:
            raise HTTPException(404, "unknown lot")
        return build_opportunity(l, db.get_valuation(lot_id), s, time.time(),
                                 theses=sc.theses(), watchlist=sc.watchlist())

    @app.post("/api/lot/{lot_id}/revalue")
    def revalue(lot_id: int):
        l = db.get_lot(lot_id)
        if not l:
            raise HTTPException(404, "unknown lot")
        # Load the watchlist first: it is what injects the buyer's lenses and standing instructions
        # into the appraisal prompt, and a manual revalue is exactly when those matter most.
        w = sc.watchlist()
        v = sc.pipeline.value_lot(l, force=True)
        return build_opportunity(l, v.to_dict(), s, time.time(), theses=sc.theses(), watchlist=w)

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
            lot_sc = score_lot(lot, val, s, **sc.score_options(lot.get("category") or ""))
            base = {"lot_id": lot_id, "title": lot.get("title"), "category": lot.get("category") or "Uncategorized",
                    "closed_at": lot.get("ends_at") or time.time(), "predicted_low": (val or {}).get("low"),
                    "predicted_mid": (val or {}).get("mid"), "predicted_high": (val or {}).get("high"),
                    "predicted_net": lot_sc.get("net_resale"), "confidence": (val or {}).get("confidence", 0),
                    "method": (val or {}).get("method", "none"), "score": lot_sc.get("score", 0),
                    "hammer": None, "landed_at_hammer": None, "bought": None, "bought_price": None,
                    "sale_price": None, "sale_at": None, "sale_channel": "", "notes": "",
                    "listed_at": None, "list_price": None, "still_listed": None, "views": None,
                    "watchers": None,
                    "predicted_days": (lot_sc.get("liquidity") or {}).get("days_p50")}

        def num(v):
            try:
                f = float(v)
                return f if f > 0 else None
            except (TypeError, ValueError):
                return None

        def non_neg(v):
            try:
                f = float(v)
                return f if f >= 0 else None
            except (TypeError, ValueError):
                return None

        paid, sold = num(body.get("bought_price")), num(body.get("sale_price"))
        sale_at = body.get("sale_at") or (time.time() if sold is not None else base.get("sale_at"))
        listed_at = num(body.get("listed_at")) or base.get("listed_at")
        updated = {**base,
                   "bought": body.get("bought", True if paid is not None else base.get("bought")),
                   "bought_price": paid if paid is not None else base.get("bought_price"),
                   "sale_price": sold if sold is not None else base.get("sale_price"),
                   "sale_at": sale_at,
                   "sale_channel": body.get("sale_channel", base.get("sale_channel", "")),
                   "notes": body.get("notes", base.get("notes", "")),
                   # Liquidity ground truth. If a sale came in, the listing is no longer sitting.
                   "listed_at": listed_at,
                   "list_price": num(body.get("list_price")) or base.get("list_price"),
                   "still_listed": False if sale_at else body.get(
                       "still_listed", True if listed_at else base.get("still_listed")),
                   "views": non_neg(body.get("views")) if body.get("views") is not None else base.get("views"),
                   "watchers": non_neg(body.get("watchers")) if body.get("watchers") is not None else base.get("watchers"),
                   "recorded_at": time.time()}
        db.save_outcome(updated)
        days = round((updated["sale_at"] - listed_at) / 86400, 1) if listed_at and updated.get("sale_at") else None
        return {"outcome": updated, "days_to_sell": days, "predicted_days": updated.get("predicted_days")}

    # ------------------------------------------------------------- playbook
    @app.get("/api/playbook")
    def playbook():
        rows = sc.theses()
        rows.sort(key=lambda t: (-(t.get("max_bid") or 0), t.get("name", "")))
        return {"theses": rows, "settings": {
            "target_monthly_roi": s.target_monthly_roi, "min_buy_multiple": s.min_buy_multiple,
            "research_ttl_days": s.research_ttl_days, "hunt_per_run": s.hunt_per_run,
        }}

    @app.post("/api/playbook")
    def upsert_thesis(body: dict[str, Any]):
        existing = {t["id"]: t for t in sc.theses()}
        prev = existing.get(body.get("id", ""))
        if not prev and not body.get("name"):
            raise HTTPException(400, "name required for a new thesis")
        merged = refresh_thesis({**prev, **body}, s) if prev else normalize_thesis(body, s)
        sc.save_theses([merged])
        return {"thesis": merged}

    @app.delete("/api/playbook/{thesis_id}")
    def delete_thesis(thesis_id: str):
        db.delete_thesis(thesis_id)
        return {"deleted": thesis_id}

    # ----------------------------------------------------------------- watchlist
    @app.get("/api/watchlist")
    def watchlist():
        """Which lenses are switched on, and the buyer's own standing instructions."""
        w = sc.watchlist(force=True)
        return {
            "watchlist": w,
            # What the appraiser will actually be told, verbatim -- no hidden prompt.
            "prompt_preview": watchlist_prompt(w),
            "hunt_queries": lens_queries(w),
            "mystery": {
                "enabled": s.mystery and s.vision, "threshold": s.mystery_threshold,
                "per_run": s.mystery_per_run, "max_images": s.mystery_max_images,
                "queries": MYSTERY_QUERIES[:s.mystery_hunt_queries],
            },
        }

    @app.post("/api/watchlist")
    def save_watchlist(body: dict[str, Any]):
        """Save toggles, custom instructions, or a hand-written lens. A partial body is fine: anything
        absent keeps its current value, so the UI can send just the one switch that changed."""
        cur = sc.watchlist(force=True)
        nxt = {**cur, "lenses": [dict(l) for l in cur["lenses"]]}

        if isinstance(body.get("lenses"), list):
            want = {l["id"]: l.get("enabled") is not False for l in body["lenses"] if l.get("id")}
            for l in nxt["lenses"]:
                if l["id"] in want:
                    l["enabled"] = want[l["id"]]
        if isinstance(body.get("custom_instructions"), str):
            nxt["custom_instructions"] = body["custom_instructions"][:4000]

        add = body.get("add") or {}
        if add.get("name") or add.get("prompt"):
            name = (add.get("name") or "Custom lens")[:80]
            lens_id = add.get("id") or (_slug(name) or f"lens-{int(time.time())}")
            lens = {"id": lens_id, "name": name, "hint": (add.get("hint") or "")[:140], "builtin": False,
                    "keywords": [str(k) for k in (add.get("keywords") or [])][:30],
                    "queries": [str(q) for q in (add.get("queries") or [])][:8],
                    "prompt": (add.get("prompt") or "")[:2000],
                    "enabled": add.get("enabled") is not False}
            if not lens["prompt"].strip():
                raise HTTPException(400, "a lens needs a prompt: say what to look for")
            at = next((i for i, l in enumerate(nxt["lenses"]) if l["id"] == lens_id), None)
            if at is None:
                nxt["lenses"].append(lens)
            else:
                nxt["lenses"][at] = {**nxt["lenses"][at], **lens}

        if body.get("remove"):
            target = next((l for l in nxt["lenses"] if l["id"] == body["remove"]), None)
            # A built-in can be switched off but never deleted: it is code, and it would reappear on
            # the next read.
            if target and target.get("builtin"):
                target["enabled"] = False
            else:
                nxt["lenses"] = [l for l in nxt["lenses"] if l["id"] != body["remove"]]

        saved = sc.save_watchlist(nxt)
        return {"watchlist": saved, "prompt_preview": watchlist_prompt(saved)}

    @app.post("/api/playbook/research")
    def research(body: dict[str, Any] | None = None):
        body = body or {}
        return sc.research(discover=body.get("discover"), refresh=body.get("refresh", 6),
                           focus=body.get("focus"))

    @app.post("/api/playbook/review")
    def review(accept: bool = False):
        out = sc.playbook_review()
        if accept and out["proposed"]:
            sc.save_theses(out["proposed"])
        return {**out, "accepted": len(out["proposed"]) if accept else 0}

    @app.post("/api/hunt")
    def hunt(body: dict[str, Any] | None = None):
        body = body or {}
        rows = sc.theses()
        picked = [t for t in rows if t["id"] in body["ids"]] if body.get("ids") else None
        out = sc.hunt(theses=picked, max_theses=body.get("max_theses"))
        return {"hunted": out["hunted"], "lots_found": len(out["lots"])}

    @app.get("/api/local")
    def local(limit: int = 60):
        theses = sc.theses()
        if not s.local or not s.craigslist_site:
            return {"hits": [], "enabled": False, "detail":
                    "Set ARB_CRAIGSLIST_SITE to your local craigslist subdomain (e.g. 'detroit') to search "
                    "automatically. OfferUp and Facebook Marketplace have no public API and their terms "
                    "forbid scraping, so POST a pasted link to this endpoint instead."}
        listings = hunt_local(theses, s)
        order = {"buy": 0, "negotiate": 1, "unknown": 2, "pass": 3}
        hits = [h for h in (score_local(l, theses, s) for l in listings) if h["theses"]]
        hits.sort(key=lambda h: order[h["verdict"]])
        return {"enabled": True, "site": s.craigslist_site, "scanned": len(listings), "hits": hits[:limit]}

    @app.post("/api/local")
    def local_paste(body: dict[str, Any]):
        listing = parse_pasted_listing(url=body.get("url", ""), text=body.get("text", ""),
                                       price=body.get("price"), title=body.get("title", ""))
        if not listing:
            raise HTTPException(400, "send a url or some text")
        if body.get("distance_miles") is not None:
            listing["distance_miles"] = body["distance_miles"]
        return score_local(listing, sc.theses(), s)

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


