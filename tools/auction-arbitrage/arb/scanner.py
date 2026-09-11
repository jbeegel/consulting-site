"""Scan = pull lots from HiBid -> store -> value the most promising ones."""
from __future__ import annotations

import logging
import threading
import time
from typing import Any, Callable

from .calibration import build_report, liquidity_adjustment_for
from .playbook import (apply_outcome_stats, hunt_order, match_theses, normalize_thesis, refresh_all,
                       theses_from_outcomes)
from .seeds import SEED_THESES
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
        self._theses: tuple[float, list[dict[str, Any]]] | None = None
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
    def scan(self, *, value: bool = True, max_value: int | None = 40, hunt: bool = True,
             **pull_kwargs) -> dict[str, Any]:
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

            # Hunt: the broad pull sees whatever is closing; these searches go looking for the niches
            # we already know pay. Cheap (no valuation), and the results join the same pool.
            theses = self.theses() if hunt else []
            if theses:
                with st.lock:
                    st.message = "hunting the playbook"
                found = self.hunt(theses=theses)
                seen = {l["id"] for l in lots}
                lots = lots + [l for l in found["lots"] if l["id"] not in seen]
                log.info("hunted %d theses, %d extra lots", len(found["hunted"]), len(lots) - len(seen))

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

                # A lot matching a researched niche outranks one that merely contains a hot word.
                boost = None
                if theses:
                    def boost(lot: dict[str, Any]) -> float:
                        m = match_theses(lot, theses)
                        return 2 + 2 * m[0]["strength"] if m else 0.0

                self.pipeline.value_many(todo, max_lots=max_value, progress=progress, boost=boost)
            settled = self.settle_closed_lots()
            if settled:
                log.info("settled %d closed lots into the report card", settled)
            if theses:
                # Local arithmetic over outcomes we already hold, so the playbook never goes stale
                # waiting for someone to press a button.
                try:
                    self.playbook_review()
                except Exception as e:
                    log.warning("playbook review failed: %s", e)
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

    # ----------------------------------------------------------------- playbook
    def theses(self, force: bool = False) -> list[dict[str, Any]]:
        """The playbook, seeded on first use and cached for a minute.

        Seeding on read rather than on deploy means a fresh install has something to hunt immediately,
        and the seeds carry no invented market data -- their prices stay None until research runs.
        """
        if not self.settings.playbook:
            return []
        now = time.time()
        if not force and self._theses and now - self._theses[0] < 60:
            return self._theses[1]
        rows = self.store.theses()
        if not rows:
            rows = [normalize_thesis(s, self.settings) for s in SEED_THESES]
            self.store.save_theses(rows)
            log.info("seeded playbook with %d theses", len(rows))
        else:
            # Config can change under stored theses (a new target ROI moves every ceiling), so re-derive.
            rows = refresh_all(rows, self.settings)
        self._theses = (now, rows)
        return rows

    def save_theses(self, rows: list[dict[str, Any]]) -> None:
        self.store.save_theses(rows)
        self._theses = None

    def playbook_review(self) -> dict[str, Any]:
        """Roll recorded outcomes onto each thesis, and propose new ones from what you have flipped."""
        rows = self.theses()
        outcomes = self.store.outcomes()
        lots = {l["id"]: l for l in self.store.lots(include_closed=True, limit=5000)}
        with_stats = apply_outcome_stats(rows, outcomes, lots)
        proposed = theses_from_outcomes(outcomes, self.settings, with_stats)
        self.save_theses(with_stats)
        return {"theses": with_stats, "proposed": proposed}

    def research(self, *, discover: int | None = None, refresh: int = 6,
                 focus: str | None = None) -> dict[str, Any]:
        """Discover new niches and re-measure stale ones. Costs Claude calls with web search."""
        from .discovery import researcher_for, stale_theses

        r = researcher_for(self.settings)
        if r is None:
            return {"added": [], "updated": [], "error": "no Anthropic key: set ANTHROPIC_API_KEY to run research"}
        existing = self.theses()
        added: list[dict[str, Any]] = []
        updated: list[dict[str, Any]] = []
        error = None
        try:
            stale = stale_theses(existing, self.settings)[:refresh]
            if stale:
                by_name = {t["name"].lower(): t for t in existing}
                for raw in r.refresh(stale):
                    prev = by_name.get(raw["name"].lower())
                    if not prev:
                        continue
                    # Keep identity, provenance and accumulated stats; replace what research measures.
                    merged = {**prev, **raw, "id": prev["id"], "origin": prev["origin"],
                              "stats": prev.get("stats"), "created_at": prev.get("created_at")}
                    updated.append(normalize_thesis(merged, self.settings))
            n = self.settings.discover_count if discover is None else discover
            if n > 0:
                avoid = [t["name"] for t in existing]
                focus = focus or "small advertising ephemera, and bank / insurance / financial memorabilia"
                seen = {t["id"] for t in existing}
                for raw in r.discover(n, avoid, focus):
                    t = normalize_thesis({**raw, "origin": "discovered"}, self.settings)
                    if t["id"] in seen:
                        continue
                    seen.add(t["id"])
                    added.append(t)
        except Exception as e:
            log.warning("thesis research failed: %s", e)
            error = f"{type(e).__name__}: {e}"
        if added or updated:
            self.save_theses(updated + added)
        return {"added": added, "updated": updated, "error": error}

    def hunt(self, *, theses: list[dict[str, Any]] | None = None, max_theses: int | None = None,
             deadline: float | None = None) -> dict[str, Any]:
        """Run the playbook's own search terms against HiBid rather than waiting for a match to drift
        past in a broad scan. Rotates least-recently-hunted first."""
        rows = theses if theses is not None else self.theses()
        picks = hunt_order(rows, self.settings.hunt_per_run if max_theses is None else max_theses)
        kept: dict[int, dict[str, Any]] = {}
        hunted: list[str] = []
        for t in picks:
            if deadline and time.time() > deadline:
                break
            for q in (t.get("queries") or [])[:2]:
                if deadline and time.time() > deadline:
                    break
                try:
                    for lot in self.pull(status="OPEN", hours=None, search_text=q,
                                         max_pages=self.settings.hunt_pages):
                        kept[lot["id"]] = lot
                except Exception as e:
                    log.warning("hunt failed for %s %r: %s", t["id"], q, e)
            hunted.append(t["id"])
            t["last_hunted_at"] = time.time()
        if hunted:
            self.save_theses(picks)
        return {"hunted": hunted, "lots": list(kept.values())}

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
