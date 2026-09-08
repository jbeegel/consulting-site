"""Orchestrates: cache -> eBay sold comps -> Claude appraisal -> auctioneer estimate fallback."""
from __future__ import annotations

import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable, Iterable

from ..config import Settings
from ..db import Store
from .base import Comp, Valuation, title_key
from .ebay import clean_query, fetch_sold_comps
from .estimate import value_from_estimate

log = logging.getLogger(__name__)

# Words that hint at resale-grade items; used only to prioritise which lots get valued first.
_HOT_WORDS = re.compile(
    r"\b("
    # tools / equipment / outdoor
    r"dewalt|milwaukee|makita|bosch|snap-?on|festool|stihl|husqvarna|honda|yamaha|generac|kohler|"
    r"john deere|kubota|caterpillar|toro|ego\b|ryobi|yeti|weber|traeger|big green egg|stanley|bailey|griswold|wagner|"
    # watches / jewelry / precious
    r"rolex|omega|seiko|tag heuer|breitling|cartier|tiffany|bulova|accutron|elgin|waltham|hamilton|pocket watch|"
    r"gold|silver|sterling|platinum|diamond|karat|\d+k\b|gold filled|bullion|coin|morgan|eagle|krugerrand|cameo|bakelite|"
    r"trifari|weiss|coro|monet|napier|costume jewelry|"
    # luxury / fashion
    r"louis vuitton|gucci|coach|prada|chanel|hermes|dooney|"
    # toys / games / cards
    r"lego|nintendo|playstation|ps5|xbox|switch|pokemon|magic the gathering|funko|matchbox|hot wheels|lionel|marx|tonka|"
    r"buddy l|barbie|g\.?i\.? joe|star wars|pez|"
    r"topps|bowman|fleer|upper deck|panini|donruss|psa|bgs|rookie|autograph|signed|baseball card|football card|sports card|"
    r"basketball card|hockey card|trading card|wax pack|"
    # electronics / cameras / music gear
    r"apple|iphone|ipad|macbook|imac|samsung|sony|canon|nikon|leica|kodak|polaroid|brownie|bose|sonos|dyson|kitchenaid|vitamix|"
    r"gibson|fender|martin|taylor|roland|marshall|zenith|philco|typewriter|rotary phone|"
    # furniture / design
    r"herman miller|aeron|steelcase|eames|knoll|mid.?century|art deco|art nouveau|victorian|primitive|folk art|"
    # ceramics / glass / collectibles
    r"occupied japan|noritake|kewpie|bisque|chalkware|hummel|lladro|roseville|mccoy|hull|fenton|fiesta|depression glass|"
    r"carnival glass|milk glass|wedgwood|jasperware|lenox|royal doulton|limoges|haviland|stoneware|crock|redware|ironstone|"
    r"pyrex|corning|majolica|cloisonne|satsuma|imari|nippon|wall pocket|salt and pepper|shakers|figurine|"
    # advertising / banks / ephemera
    r"advertising|tin sign|porcelain sign|coca.?cola|pepsi|still bank|mechanical bank|calendar bank|letter opener|inkwell|"
    r"fountain pen|parker|sheaffer|waterman|zippo|lighter|pocket knife|case xx|buck knife|humidor|tobacco|"
    r"oil lamp|aladdin|kerosene|lantern|railroad|insulator|marbles|license plate|milk bottle|whiskey bottle|decanter|"
    r"jim beam|ezra brooks|singer|featherweight|seth thomas|ansonia|clock|"
    # books / paper / media
    r"first edition|1st edition|antique book|primer|mcguffey|yearbook|program|pennant|comic|"
    r"boy scouts|bsa\b|girl scouts|chip hilton|hardy boys|nancy drew|big little book|"
    r"lp\b|vinyl|record|45 rpm|78 rpm|"
    # generic signals
    r"vintage|antique|rare|native|indian|wall hanging|"
    # bikes / fitness / drones
    r"trek|specialized|cannondale|giant|peloton|schwinn|garmin|dji|gopro|oculus|quest"
    r")\b", re.I)


_VISION = True  # set from Settings by ValuationPipeline


def triage_score(lot: dict[str, Any]) -> float:
    """Cheap heuristic: which lots are worth spending a valuation call on, highest first."""
    title = lot.get("title") or ""
    s = 0.0
    if len(title) < 6:
        return -1.0
    s += min(3, len(_HOT_WORDS.findall(title)))
    if re.search(r"\b[A-Z]{1,4}\d{2,5}[A-Z]?\b", title):  # looks like a model number
        s += 1.5
    if (lot.get("bid_count") or 0) == 0:
        s += 1.0  # nobody has noticed it yet
    if lot.get("estimate"):
        s += 0.5
    tl = lot.get("time_left_seconds")
    if tl is not None and tl < 6 * 3600:
        s += 1.0
    if re.search(r"\b(box of|misc|assorted|miscellaneous|contents of|shelf lot|knic ?knac|knick ?knack|bric.a.brac|smalls)\b", title, re.I):
        # Vague title: junk without photos, but with photos it is exactly where the unnoticed value hides.
        s += 0.5 if (lot.get("picture_count") or 0) >= 1 and _VISION else -1.5
    # Penny lots: the whole game is $1-$3 buys that resell for $20-$50. Don't let a low bid look boring.
    if (lot.get("min_bid") or lot.get("high_bid") or 0) <= 5:
        s += 0.5
    return s


class ValuationPipeline:
    def __init__(self, settings: Settings, store: Store, *, claude_valuer: Any | None = None,
                 picture_fetcher: Callable[[dict[str, Any]], list[str]] | None = None):
        global _VISION
        _VISION = settings.vision
        self.settings = settings
        self.store = store
        self.picture_fetcher = picture_fetcher  # e.g. Scanner.pictures_for: pulls full-size photos from HiBid
        self._claude = claude_valuer
        self._claude_tried = claude_valuer is not None

    # ---------------------------------------------------------- provider setup
    def _get_claude(self):
        if self._claude_tried:
            return self._claude
        self._claude_tried = True
        if self.settings.valuer in ("none", "ebay", "estimate"):
            return None
        if not self.settings.anthropic_available:
            log.warning("ANTHROPIC_API_KEY not set: falling back to eBay comps / auctioneer estimates only")
            return None
        try:
            from .claude import ClaudeValuer
            self._claude = ClaudeValuer(self.settings.model, web_search=self.settings.web_search,
                                        vision=self.settings.vision, max_images=self.settings.max_images)
        except Exception as e:  # SDK missing, bad key format, etc.
            log.warning("Claude valuer unavailable: %s", e)
            self._claude = None
        return self._claude

    # -------------------------------------------------------------- one lot
    def value_lot(self, lot: dict[str, Any], *, force: bool = False) -> Valuation:
        key = title_key(lot.get("title", ""), lot.get("quantity"))
        if not force:
            cached = self.store.cached_valuation(key, self.settings.valuation_ttl_days * 86400)
            if cached:
                cached = dict(cached, lot_id=lot["id"], cache_hit=True)
                self.store.save_valuation(lot["id"], cached)
                return Valuation(**{k: v for k, v in cached.items() if k in Valuation.__dataclass_fields__})

        comps: list[Comp] = []
        if self.settings.ebay_sold and self.settings.valuer in ("auto", "ebay", "claude"):
            comps = fetch_sold_comps(clean_query(lot.get("title", "")))

        val: Valuation | None = None
        claude = self._get_claude() if self.settings.valuer in ("auto", "claude") else None
        if claude is not None:
            if self.settings.vision and not lot.get("pictures") and self.picture_fetcher:
                try:
                    pics = self.picture_fetcher(lot)
                    if pics:
                        lot = dict(lot, pictures=pics)
                except Exception as e:  # photos are a bonus, never a blocker
                    log.info("picture fetch failed for %s: %s", lot.get("id"), e)
            val = claude.value(lot, comps)
            if not val.usable:
                log.info("claude gave no usable value for %s (%s)", lot["id"], val.error or val.rationale[:80])
                val = None

        if val is None and comps and self.settings.valuer in ("auto", "ebay"):
            val = self._from_comps(lot, comps, key)

        if val is None:
            val = value_from_estimate(lot)
            if comps:
                val.comps = [c.__dict__ for c in comps[:10]]

        val.created_at = time.time()
        d = val.to_dict()
        self.store.save_valuation(lot["id"], d)
        return val

    @staticmethod
    def _from_comps(lot: dict[str, Any], comps: list[Comp], key: str) -> Valuation | None:
        from .ebay import summarize
        s = summarize(comps)
        if s.get("n", 0) < 3:
            return None
        v = Valuation(lot_id=lot["id"], title_key=key, identified_item=lot.get("title", ""))
        v.low, v.mid, v.high = s["p25"], s["median"], s["p75"]
        v.confidence = min(0.7, 0.3 + 0.04 * s["n"])
        v.confidence_reason = f"Median of {s['n']} eBay sold listings matching the title (unverified item match)."
        v.method = "ebay_sold"
        v.comps = [c.__dict__ for c in comps[:15]]
        v.rationale = (f"eBay sold comps for '{clean_query(lot.get('title', ''))}': median ${s['median']:,.0f}, "
                       f"IQR ${s['p25']:,.0f}–${s['p75']:,.0f} across {s['n']} sales.")
        v.risks = ["Comps matched on title keywords only; confirm the exact model/condition before bidding."]
        v.search_query = clean_query(lot.get("title", ""))
        return v

    # ------------------------------------------------------------ many lots
    def value_many(self, lots: Iterable[dict[str, Any]], *, max_lots: int | None = None,
                   progress: Callable[[int, int, dict[str, Any]], None] | None = None) -> int:
        todo = [l for l in lots if not l.get("is_closed")]
        todo.sort(key=triage_score, reverse=True)
        todo = [l for l in todo if triage_score(l) >= 0]
        if max_lots:
            todo = todo[:max_lots]
        done = 0
        workers = max(1, self.settings.valuation_workers)
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futs = {ex.submit(self.value_lot, lot): lot for lot in todo}
            for fut in as_completed(futs):
                lot = futs[fut]
                try:
                    fut.result()
                except Exception as e:  # never let one lot kill the scan
                    log.exception("valuation crashed for lot %s: %s", lot.get("id"), e)
                done += 1
                if progress:
                    progress(done, len(todo), lot)
        return done
