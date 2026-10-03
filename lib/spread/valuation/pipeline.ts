// Orchestrates: cache -> eBay comps -> Claude appraisal -> auctioneer estimate fallback.
import type { Config } from "../config";
import type { Store } from "../store";
import type { CalibrationReport, Comp, Lot, Valuation, Watchlist } from "../types";
import { adjustmentFor } from "../calibration";
import { titleKey, usable, emptyValuation } from "./base";
import { ClaudeValuer } from "./claude";
import { cleanQuery, fetchActiveComps, fetchSoldComps, summarize } from "./ebay";
import { valueFromEstimate } from "./estimate";
import { readMystery } from "../mystery";
import { lensBoost, watchlistPrompt } from "../lenses";

const HOT_WORDS = /\b(dewalt|milwaukee|makita|bosch|snap-?on|festool|stihl|husqvarna|honda|yamaha|generac|kohler|john deere|kubota|caterpillar|toro|ego\b|ryobi|yeti|weber|traeger|big green egg|stanley|bailey|griswold|wagner|rolex|omega|seiko|tag heuer|breitling|cartier|tiffany|bulova|accutron|elgin|waltham|hamilton|pocket watch|gold|silver|sterling|platinum|diamond|karat|\d+k\b|gold filled|bullion|coin|morgan|eagle|krugerrand|cameo|bakelite|trifari|weiss|coro|monet|napier|costume jewelry|louis vuitton|gucci|coach|prada|chanel|hermes|dooney|lego|nintendo|playstation|ps5|xbox|switch|pokemon|magic the gathering|funko|matchbox|hot wheels|lionel|marx|tonka|buddy l|barbie|g\.?i\.? joe|star wars|pez|topps|bowman|fleer|upper deck|panini|donruss|psa|bgs|rookie|autograph|signed|baseball card|football card|sports card|basketball card|hockey card|trading card|wax pack|apple|iphone|ipad|macbook|imac|samsung|sony|canon|nikon|leica|kodak|polaroid|brownie|bose|sonos|dyson|kitchenaid|vitamix|gibson|fender|martin|taylor|roland|marshall|zenith|philco|typewriter|rotary phone|herman miller|aeron|steelcase|eames|knoll|mid.?century|art deco|art nouveau|victorian|primitive|folk art|occupied japan|noritake|kewpie|bisque|chalkware|hummel|lladro|roseville|mccoy|hull|fenton|fiesta|depression glass|carnival glass|milk glass|wedgwood|jasperware|lenox|royal doulton|limoges|haviland|stoneware|crock|redware|ironstone|pyrex|corning|majolica|cloisonne|satsuma|imari|nippon|wall pocket|salt and pepper|shakers|figurine|advertising|tin sign|porcelain sign|coca.?cola|pepsi|still bank|mechanical bank|calendar bank|letter opener|inkwell|fountain pen|parker|sheaffer|waterman|zippo|lighter|pocket knife|case xx|buck knife|humidor|tobacco|oil lamp|aladdin|kerosene|lantern|railroad|insulator|marbles|license plate|milk bottle|whiskey bottle|decanter|jim beam|ezra brooks|singer|featherweight|seth thomas|ansonia|clock|first edition|1st edition|antique book|primer|mcguffey|yearbook|program|pennant|comic|boy scouts|bsa\b|girl scouts|chip hilton|hardy boys|nancy drew|big little book|lp\b|vinyl|record|45 rpm|78 rpm|vintage|antique|rare|native|indian|wall hanging|trek|specialized|cannondale|giant|peloton|schwinn|garmin|dji|gopro|oculus|quest)\b/gi;

let VISION = true; // set from config by ValuationPipeline

/** Cheap heuristic: which lots are worth spending a valuation call on, highest first. */
export function triageScore(lot: Lot): number {
  const title = lot.title || "";
  if (title.length < 6) return -1;
  let s = Math.min(3, (title.match(HOT_WORDS) ?? []).length);
  if (/\b[A-Z]{1,4}\d{2,5}[A-Z]?\b/.test(title)) s += 1.5;
  if ((lot.bid_count || 0) === 0) s += 1;
  if (lot.estimate) s += 0.5;
  if (lot.time_left_seconds !== null && lot.time_left_seconds < 6 * 3600) s += 1;
  if (/\b(box of|misc|assorted|miscellaneous|contents of|shelf lot|knic ?knac|knick ?knack|bric.a.brac|smalls)\b/i.test(title))
    s += (lot.picture_count ?? 0) >= 1 && VISION ? 0.5 : -1.5; // with photos, vague titles are where unnoticed value hides
  if ((lot.min_bid || lot.high_bid || 0) <= 5) s += 0.5; // penny lots are the bread and butter
  return s;
}

export class ValuationPipeline {
  private claude: ClaudeValuer | null | undefined;
  /** The buyer's lenses and standing instructions, injected into every appraisal prompt. */
  private watchlist: Watchlist | null = null;
  constructor(private c: Config, private store: Store, claude?: ClaudeValuer | null, private pictureFetcher?: (lot: Lot) => Promise<string[]>, private calibrationFetcher?: () => Promise<CalibrationReport | null>) {
    this.claude = claude;
    VISION = c.vision;
  }

  setWatchlist(w: Watchlist | null): void {
    this.watchlist = w;
  }

  /** Triage weight from the buyer's own lenses, so a lens hit competes for a valuation call. */
  lensPriority(lot: Lot): number {
    return this.c.lenses ? lensBoost(lot, this.watchlist, this.c.lensWeight) : 0;
  }

  private getClaude(): ClaudeValuer | null {
    if (this.claude !== undefined) return this.claude;
    this.claude = this.c.claudeEnabled ? new ClaudeValuer(this.c.model, this.c.webSearch, 3, this.c.vision, this.c.maxImages) : null;
    return this.claude;
  }

  async valueLot(lot: Lot, force = false): Promise<Valuation> {
    const key = titleKey(lot.title, lot.quantity);
    if (!force) {
      const cached = await this.store.cachedValuation(key, this.c.valuationTtlDays * 86400);
      if (cached) {
        const v = { ...cached, lot_id: lot.id, cache_hit: true, category: lot.category || "Uncategorized" };
        await this.store.saveValuation(lot.id, v);
        return v;
      }
    }
    let comps: Comp[] = [];
    if (this.c.valuer !== "none" && this.c.valuer !== "estimate") {
      const q = cleanQuery(lot.title);
      if (this.c.ebaySold) comps = await fetchSoldComps(q);
      if (this.c.ebayClientId && this.c.ebayClientSecret) comps = comps.concat(await fetchActiveComps(q, this.c.ebayClientId, this.c.ebayClientSecret));
    }
    let val: Valuation | null = null;
    const claude = this.c.valuer === "auto" || this.c.valuer === "claude" ? this.getClaude() : null;
    if (claude) {
      if (this.c.vision && !lot.pictures?.length && this.pictureFetcher) {
        try {
          const pics = await this.pictureFetcher(lot);
          if (pics.length) {
            lot = { ...lot, pictures: pics };
            await this.store.upsertLots([lot]).catch(() => undefined); // so the dashboard can show them
          }
        } catch (e) {
          console.info("picture fetch failed for", lot.id, e);
        }
      }
      // A mystery lot is judged on the photographs we can actually send, so decide AFTER the picture
      // fetch above: a lot with one thumbnail and one fetched later are different propositions.
      const mystery = this.c.mystery && this.c.vision && readMystery(lot, this.c).is_mystery;
      val = await claude.value(lot, comps, {
        guidance: this.c.lenses ? watchlistPrompt(this.watchlist) : "",
        mystery,
        maxImages: mystery ? Math.max(this.c.maxImages, this.c.mysteryMaxImages) : undefined,
      });
      if (!usable(val)) val = null;
    }
    if (!val && (this.c.valuer === "auto" || this.c.valuer === "ebay")) val = this.fromComps(lot, comps, key);
    if (!val) {
      val = valueFromEstimate(lot);
      if (comps.length) val.comps = comps.slice(0, 10);
    }
    val.created_at = Date.now() / 1000;
    val.category = lot.category || "Uncategorized"; // so trends can group history without a join
    val = await this.applyCalibration(lot, val);
    await this.store.saveValuation(lot.id, val);
    return val;
  }

  /** Bend a fresh valuation toward what this category has actually done. */
  private async applyCalibration(lot: Lot, val: Valuation): Promise<Valuation> {
    if (!this.c.calibration || !this.calibrationFetcher || !val.mid) return val;
    let report: CalibrationReport | null = null;
    try {
      report = await this.calibrationFetcher();
    } catch {
      return val;
    }
    const adj = adjustmentFor(report, lot.category, this.c);
    if (adj.basis === "none" || (adj.bias === 1 && adj.confidence_factor === 1)) return val;
    const scale = (x: number | null) => (x === null ? null : Math.round(x * adj.bias * 100) / 100);
    const note = `Calibrated: ${lot.category || "this category"} valuations adjusted x${adj.bias.toFixed(2)} from ${adj.n} closed lots (${adj.basis === "sales" ? "your recorded sales" : "auction results"}).`;
    return {
      ...val,
      low: scale(val.low), mid: scale(val.mid), high: scale(val.high),
      confidence: Math.round(val.confidence * adj.confidence_factor * 1000) / 1000,
      confidence_reason: (val.confidence_reason ? val.confidence_reason + " " : "") + note,
      calibration: { bias: adj.bias, confidence_factor: adj.confidence_factor, basis: adj.basis, n: adj.n },
    };
  }

  private fromComps(lot: Lot, comps: Comp[], key: string): Valuation | null {
    const sold = comps.filter((c) => c.source === "ebay_sold");
    const pool = sold.length >= 3 ? sold : comps;
    const s = summarize(pool);
    if (s.n < 3) return null;
    const v = emptyValuation(lot);
    v.title_key = key;
    v.identified_item = lot.title;
    v.low = s.p25!; v.mid = s.median!; v.high = s.p75!;
    const active = pool === comps && sold.length < 3;
    v.confidence = Math.min(active ? 0.5 : 0.7, 0.3 + 0.04 * s.n) * (active ? 0.8 : 1);
    v.method = active ? "ebay_active" : "ebay_sold";
    v.confidence_reason = `${active ? "Median asking price of" : "Median of"} ${s.n} eBay ${active ? "active" : "sold"} listings matching the title (unverified item match).`;
    v.comps = pool.slice(0, 15);
    v.rationale = `eBay ${active ? "active" : "sold"} comps for '${cleanQuery(lot.title)}': median $${Math.round(s.median!)}, IQR $${Math.round(s.p25!)}–$${Math.round(s.p75!)} across ${s.n} listings.`;
    v.risks = ["Comps matched on title keywords only; confirm the exact model/condition before bidding."];
    if (active) v.risks.push("Asking prices, not sold prices: expect realized values 10–30% lower.");
    v.search_query = cleanQuery(lot.title);
    return v;
  }

  /** Value the most promising lots, `maxLots` at most, stopping when `deadline` (ms epoch) passes.
   *  `boost` lets the playbook push its own matches to the front: a lot that matches a researched
   *  niche is a far better use of a valuation call than one that merely contains a hot word. */
  async valueMany(lots: Lot[], opts: { maxLots?: number; deadline?: number; boost?: (lot: Lot) => number; reserve?: { pick: (lot: Lot) => boolean; count: number }; onDone?: (n: number, total: number, lot: Lot) => void } = {}): Promise<number> {
    const rank = (l: Lot) => triageScore(l) + (opts.boost?.(l) ?? 0);
    let todo = lots.filter((l) => !l.is_closed && rank(l) >= 0).sort((a, b) => rank(b) - rank(a));
    if (opts.maxLots !== undefined) {
      const cap = Math.max(0, opts.maxLots);
      // A reserved slice guarantees a class of lot gets calls even when the general ranking would
      // starve it. Mystery lots need this: they have no hot words, so on pure triage they lose every
      // time to a lot with a brand name in the title — and they are exactly where the edge is.
      const held = opts.reserve && opts.reserve.count > 0
        ? todo.filter(opts.reserve.pick).slice(0, Math.min(opts.reserve.count, cap))
        : [];
      if (held.length) {
        const heldIds = new Set(held.map((l) => l.id));
        todo = [...held, ...todo.filter((l) => !heldIds.has(l.id))].slice(0, cap);
      } else {
        todo = todo.slice(0, cap);
      }
    }
    let idx = 0, done = 0;
    const worker = async () => {
      while (idx < todo.length) {
        if (opts.deadline && Date.now() > opts.deadline) return;
        const lot = todo[idx++];
        try {
          await this.valueLot(lot);
        } catch (e) {
          console.warn("valuation crashed for lot", lot.id, e);
        }
        done++;
        opts.onDone?.(done, todo.length, lot);
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.c.valuationWorkers, todo.length) }, worker));
    return done;
  }
}
