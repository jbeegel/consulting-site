"""Scan = pull lots from HiBid -> store -> value the most promising ones."""
from __future__ import annotations

import logging
import threading
import time
from typing import Any, Callable

from .calibration import build_report, liquidity_adjustment_for
from .config import Settings
from .db import Store
from .hibid import HiBidClient, apply_state, normalize_lot
from .valuation import ValuationPipeline

log = logging.getLogger(__name__)


class ScanStatus:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.running = False
        self.phase = "idle"
        self.lots_seen = 0
        self.lots_valued = 0
        self.lots_to_value = 0
        self.started_at: float | None = None
        self.finished_at: float | None = None
        self.message = ""
        self.error = ""
        self.scan_id: int | None = None

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            return {k: v for k, v in self.__dict__.items() if k != "lock"}


class Scanner:
    def __init__(self, settings: Settings, store: Store, client: HiBidClient | None = None,
                 pipeline: ValuationPipeline | None = None):
        self.settings = settings
        self.store = store
        self.client = client or HiBidClient(settings.hibid_graphql, site_url=settings.hibid_site,
                                            delay=settings.request_delay)
        self.pipeline = pipeline or ValuationPipeline(settings, store, picture_fetcher=self.pictures_for,
                                                      calibration_fetcher=self.calibration)
        self._calibration: tuple[float, dict[str, Any]] | None = None
        self.status = ScanStatus()

    # ------------------------------------------------------------------ pull
    def pull(self, *, status: str = "OPEN", hours: float | None = 24, category: int | None = None,
             search_text: str | None = None, max_pages: int = 10, page_length: int = 100,
             zip: str | None = None, miles: int | None = None, sort: str = "TIME_LEFT",
             sort_direction: str = "DESC", auction_id: int | None = None,
             on_page: Callable[[int], None] | None = None) -> list[dict[str, Any]]:
        """Fetch lots and store them. Returns the normalized lots within the time window."""
        s = self.settings
        window = hours * 3600 if hours else None
        kept: list[dict[str, Any]] = []
        seen = 0
        for raw in self.client.iter_lots(status=status, sort=sort, sort_direction=sort_direction,
                                         category=category, search_text=search_text, zip=zip or s.zip,
                                         miles=miles or s.miles, country=s.country, state=s.state,
                                         auction_id=auction_id, max_pages=max_pages, page_length=page_length):
            seen += 1
            lot = normalize_lot(raw, fetched_at=time.time(), site_url=s.hibid_site,
                                default_premium=s.default_buyer_premium)
            if lot["is_closed"]:
                continue
            tl = lot.get("time_left_seconds")
            if window is not None and tl is not None and tl > window:
                continue
            kept.append(lot)
            if on_page and seen % page_length == 0:
                on_page(seen)
        if kept:
            self.store.upsert_lots(kept)
        log.info("pulled %d lots, kept %d within window", seen, len(kept))
        return kept

    # ------------------------------------------------------------------ scan
    def scan(self, *, value: bool = True, max_value: int | None = 40, **pull_kwargs) -> dict[str, Any]:
        st = self.status
        with st.lock:
            if st.running:
                return {"error": "scan already running"}
            st.running, st.phase, st.error, st.message = True, "pulling", "", ""
            st.lots_seen = st.lots_valued = st.lots_to_value = 0
            st.started_at, st.finished_at = time.time(), None
        params = dict(pull_kwargs, value=value, max_value=max_value)
        scan_id = self.store.start_scan(params)
        st.scan_id = scan_id
        try:
            lots = self.pull(**pull_kwargs)
            with st.lock:
                st.lots_seen = len(lots)
                st.phase = "valuing" if value else "done"
            self.store.update_scan(scan_id, lots_seen=len(lots))
            if value and lots:
                unvalued_ids = {l["id"] for l in self.store.lots(only_unvalued=True)}
                todo = [l for l in lots if l["id"] in unvalued_ids]
                with st.lock:
                    st.lots_to_value = min(len(todo), max_value or len(todo))

                def progress(done: int, total: int, lot: dict[str, Any]) -> None:
                    with st.lock:
                        st.lots_valued = done
                        st.message = f"valued {done}/{total}: {lot.get('title', '')[:60]}"

                self.pipeline.value_many(todo, max_lots=max_value, progress=progress)
            settled = self.settle_closed_lots()
            if settled:
                log.info("settled %d closed lots into the report card", settled)
            self.store.purge_closed()
            with st.lock:
                st.phase = "done"
            self.store.update_scan(scan_id, finished_at=time.time(), status="done", lots_valued=st.lots_valued)
        except Exception as e:  # keep the server alive; surface the error in status
            log.exception("scan failed")
            with st.lock:
                st.phase, st.error = "error", f"{type(e).__name__}: {e}"
            self.store.update_scan(scan_id, finished_at=time.time(), status="error", message=str(e))
        finally:
            with st.lock:
                st.running = False
                st.finished_at = time.time()
        return st.snapshot()

    def scan_in_background(self, **kwargs) -> bool:
        if self.status.running:
            return False
        threading.Thread(target=self.scan, kwargs=kwargs, daemon=True, name="arb-scan").start()
        return True

    # --------------------------------------------------------------- refresh
    def refresh_lot(self, lot_id: int) -> dict[str, Any] | None:
        lot = self.store.get_lot(lot_id)
        if not lot:
            return None
        state = self.client.lot_state(lot_id)
        if not state:
            return lot
        lot = apply_state(lot, state, time.time())
        self.store.upsert_lots([lot])
        return lot

    def refresh_many(self, lot_ids: list[int]) -> int:
        n = 0
        for lid in lot_ids:
            if self.refresh_lot(lid):
                n += 1
        return n

    # --------------------------------------------------------------- calibration
    def calibration(self, force: bool = False) -> dict[str, Any] | None:
        """The valuer's own report card, rebuilt at most once a minute."""
        if not self.settings.calibration:
            return None
        now = time.time()
        if not force and self._calibration and now - self._calibration[0] < 60:
            return self._calibration[1]
        try:
            report = build_report(self.store.outcomes(), self.settings)
            self._calibration = (now, report)
            return report
        except Exception as e:
            log.warning("calibration report failed: %s", e)
            return self._calibration[1] if self._calibration else None

    def score_options(self, category: str, liquidity_weight: float | None = None,
                      handling_days: float | None = None) -> dict[str, Any]:
        """Score kwargs for a lot: the user's liquidity weight plus what the feedback loop has learned
        about how fast this category really moves."""
        report = self._calibration[1] if self._calibration else None
        adj = liquidity_adjustment_for((report or {}).get("liquidity"), category)
        return {
            "liquidity_weight": liquidity_weight,
            "handling_days": handling_days,
            "days_multiplier": adj["days_multiplier"],
            "measured_n": adj["measured_n"],
        }

    def intel(self, *, liquidity_weight: float | None = None, handling_days: float | None = None) -> dict[str, Any]:
        """The market-intel board: category trends, velocity leaders and value traps."""
        from .intel import build_intel
        from .scoring import grading_economics, listing_economics, score_lot, why_upside
        report = self.calibration() or build_report([], self.settings)
        now = time.time()
        lots = self.store.lots(limit=5000)
        vals = self.store.valuations_for([l["id"] for l in lots])
        opps = []
        for l in lots:
            v = vals.get(l["id"])
            sc = score_lot(l, v, self.settings, now=now,
                           **self.score_options(l.get("category") or "", liquidity_weight, handling_days))
            opps.append({"lot": l, "valuation": v, "score": sc,
                         "why": why_upside(l, v, sc, self.settings) if v else "",
                         "listing": listing_economics(l, v, sc, self.settings),
                         "grading": grading_economics(v, sc, self.settings)})
        history = self.store.valuation_history(now - self.settings.trend_window_days * 86400)
        return build_intel(opps, history, report.get("liquidity", {}), self.settings, now)

    def settle_closed_lots(self, limit: int | None = None) -> int:
        """Record what actually happened to lots whose auctions ended. HiBid publishes the realized
        price on every closed lot, including ones we never bid on, so the valuer can grade its own
        past calls for free without buying anything."""
        if not self.settings.calibration:
            return 0
        from .scoring import landed_cost, score_lot
        due = self.store.awaiting_settlement(limit or self.settings.settle_per_run)
        n = 0
        for lot in due:
            try:
                st = self.client.lot_state(lot["id"])
                hammer = float(st.get("priceRealized") or 0) or None
                closed = bool(st.get("isClosed")) or st.get("status") == "CLOSED"
                if not closed and hammer is None:
                    continue  # still running (soft close extended it)
                val = self.store.get_valuation(lot["id"])
                sc = score_lot(lot, val, self.settings,
                               **self.score_options(lot.get("category") or ""))
                self.store.save_outcome({
                    "lot_id": lot["id"], "title": lot.get("title"), "category": lot.get("category") or "Uncategorized",
                    "closed_at": lot.get("ends_at") or time.time(),
                    "predicted_low": (val or {}).get("low"), "predicted_mid": (val or {}).get("mid"),
                    "predicted_high": (val or {}).get("high"), "predicted_net": sc.get("net_resale"),
                    "confidence": (val or {}).get("confidence", 0), "method": (val or {}).get("method", "none"),
                    "score": sc.get("score", 0), "hammer": hammer,
                    "landed_at_hammer": None if hammer is None else landed_cost(hammer, lot, self.settings),
                    "bought": None, "bought_price": None, "sale_price": None, "sale_at": None,
                    "sale_channel": "", "notes": "",
                    "listed_at": None, "list_price": None, "still_listed": None, "views": None, "watchers": None,
                    "predicted_days": (sc.get("liquidity") or {}).get("days_p50"),
                    "recorded_at": time.time(),
                })
                n += 1
            except Exception as e:
                log.warning("settle failed for lot %s: %s", lot.get("id"), e)
        if n:
            self._calibration = None
        return n

    def pictures_for(self, lot: dict[str, Any]) -> list[str]:
        """Full-size photo URLs for a lot (one GetLotDetails call; cached on the stored lot)."""
        fresh = self.enrich_lot(int(lot["id"]))
        return list((fresh or {}).get("pictures") or [])

    def enrich_lot(self, lot_id: int) -> dict[str, Any] | None:
        """Pull full details (description, all pictures) for the dossier."""
        lot = self.store.get_lot(lot_id)
        if not lot:
            return None
        raw = self.client.lot_details(lot_id)
        if not raw:
            return lot
        fresh = normalize_lot(raw, fetched_at=time.time(), site_url=self.settings.hibid_site,
                              default_premium=self.settings.default_buyer_premium)
        fresh["pictures"] = [p.get("fullSizeLocation") or p.get("hdThumbnailLocation") for p in raw.get("pictures") or []]
        fresh["terms"] = (raw.get("auction") or {}).get("termsAndConditions")
        fresh["shipping_info"] = (raw.get("auction") or {}).get("shippingAndPickupInfo")
        fresh["payment_info"] = (raw.get("auction") or {}).get("paymentInfo")
        self.store.upsert_lots([fresh])
        return fresh
