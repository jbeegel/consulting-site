// Scan = pull lots from HiBid -> store -> value the most promising ones -> refresh closing lots -> alerts.
// Designed for serverless: every run is time-boxed (config.runBudgetMs) and picks up where the last left off.
import { sendAlerts } from "./alerts";
import { config, type Config } from "./config";
import { applyState, HiBidClient, normalizeLot } from "./hibid";
import { buildReport, liquidityAdjustmentFor } from "./calibration";
import { buildIntel } from "./intel";
import { gradingEconomics, landedCost, listingEconomics, scoreLot, whyUpside, type ScoreOptions } from "./scoring";
import { getStore, type Store } from "./store";
import type { CalibrationReport, IntelParams, Lot, MarketIntel, Opportunity, Outcome, ScanParams, Valuation } from "./types";
import { ValuationPipeline } from "./valuation";

/** Score options for one lot: the user's liquidity weight plus whatever the feedback loop knows about
 *  how fast this category really moves. */
export function scoreOptionsFor(lot: Lot, report: CalibrationReport | null, p: IntelParams = {}, c: Config = config): ScoreOptions {
  const adj = liquidityAdjustmentFor(report?.liquidity, lot.category);
  return {
    liquidityWeight: p.liquidity_weight ?? c.liquidityWeight,
    liquidity: { ...adj, handlingDays: p.handling_days ?? c.handlingDays, maxDays: c.maxDaysToSell },
  };
}

export function buildOpportunity(lot: Lot, val: Valuation | null, c: Config = config, now = Date.now() / 1000, opts: ScoreOptions = {}): Opportunity {
  const score = scoreLot(lot, val, c, now, opts);
  return { lot, valuation: val, score, why: val ? whyUpside(lot, val, score, c) : "", listing: listingEconomics(lot, val, score, c), grading: gradingEconomics(val, score, c) };
}

export class Scanner {
  readonly client: HiBidClient;
  readonly pipeline: ValuationPipeline;
  constructor(readonly c: Config = config, readonly store: Store = getStore(), client?: HiBidClient) {
    this.client = client ?? new HiBidClient(c.hibidGraphql, c.hibidSite, c.requestDelayMs);
    this.pipeline = new ValuationPipeline(c, store, undefined, (lot) => this.picturesFor(lot), () => this.calibration());
  }

  private _calibration: { at: number; report: CalibrationReport } | null = null;

  /** The valuer's own report card, rebuilt at most once a minute per instance. */
  async calibration(force = false): Promise<CalibrationReport | null> {
    if (!this.c.calibration) return null;
    const now = Date.now();
    if (!force && this._calibration && now - this._calibration.at < 60_000) return this._calibration.report;
    try {
      const report = buildReport(await this.store.outcomes(), this.c);
      this._calibration = { at: now, report };
      return report;
    } catch (e) {
      console.warn("calibration report failed", e);
      return this._calibration?.report ?? null;
    }
  }

  /**
   * Record what actually happened to lots whose auctions have ended. HiBid publishes the realized
   * price on every closed lot — including ones we never bid on — so the valuer can grade its own
   * past calls for free, without buying anything.
   */
  async settleClosedLots(limit = this.c.settlePerRun, deadline?: number): Promise<number> {
    if (!this.c.calibration) return 0;
    const due = await this.store.awaitingSettlement(limit);
    let n = 0;
    for (const lot of due) {
      if (deadline && Date.now() > deadline) break;
      try {
        const st = await this.client.lotState(lot.id);
        const hammer = Number(st?.priceRealized ?? 0) || null;
        const closed = st && (st.isClosed || st.status === "CLOSED");
        if (!closed && hammer === null) continue; // still running (soft close extended it)
        const val = await this.store.getValuation(lot.id);
        const sc = scoreLot(lot, val, this.c, Date.now() / 1000, scoreOptionsFor(lot, this._calibration?.report ?? null, {}, this.c));
        const outcome: Outcome = {
          lot_id: lot.id,
          title: lot.title,
          category: lot.category || "Uncategorized",
          closed_at: lot.ends_at ?? Date.now() / 1000,
          predicted_low: val?.low ?? null,
          predicted_mid: val?.mid ?? null,
          predicted_high: val?.high ?? null,
          predicted_net: sc.net_resale,
          confidence: val?.confidence ?? 0,
          method: val?.method ?? "none",
          score: sc.score,
          hammer,
          landed_at_hammer: hammer === null ? null : landedCost(hammer, lot, this.c),
          bought: null, bought_price: null, sale_price: null, sale_at: null, sale_channel: "", notes: "",
          listed_at: null, list_price: null, still_listed: null, views: null, watchers: null,
          predicted_days: sc.liquidity?.days_p50 ?? null,
          recorded_at: Date.now() / 1000,
        };
        await this.store.saveOutcome(outcome);
        n++;
      } catch (e) {
        console.warn("settle failed for lot", lot.id, e);
      }
    }
    if (n) this._calibration = null; // force a rebuild on the next read
    return n;
  }

  async pull(p: ScanParams): Promise<Lot[]> {
    const window = p.hours ? p.hours * 3600 : null;
    const kept: Lot[] = [];
    let seen = 0;
    for await (const raw of this.client.iterLots({
      status: p.status ?? "OPEN", sort: "TIME_LEFT", sortDirection: "DESC", category: p.category ?? null,
      searchText: p.search_text ?? null, zip: p.zip ?? this.c.zip, miles: p.miles ?? this.c.miles,
      country: this.c.country, state: this.c.state, maxPages: p.max_pages ?? 5, pageLength: 100,
    })) {
      seen++;
      const lot = normalizeLot(raw, Date.now() / 1000, this.c.hibidSite, this.c.buyerPremium);
      if (lot.is_closed) continue;
      if (window !== null && lot.time_left_seconds !== null && lot.time_left_seconds > window) continue;
      kept.push(lot);
    }
    if (kept.length) await this.store.upsertLots(kept);
    console.log(`spread: pulled ${seen} lots, kept ${kept.length} within window`);
    return kept;
  }

  /** Full run. Returns the scan record id. Safe to call from a cron or a request handler. */
  async scan(p: ScanParams): Promise<{ id: number; lots_seen: number; lots_valued: number; refreshed: number; alerted: number; settled: number; error?: string }> {
    const started = Date.now();
    const deadline = started + this.c.runBudgetMs;
    const running = await this.store.runningScan();
    if (running) return { id: running.id, lots_seen: running.lots_seen, lots_valued: running.lots_valued, refreshed: 0, alerted: 0, settled: 0, error: "scan already running" };
    const id = await this.store.startScan(p);
    const out = { id, lots_seen: 0, lots_valued: 0, refreshed: 0, alerted: 0, settled: 0 } as Awaited<ReturnType<Scanner["scan"]>>;
    try {
      const lots = await this.pull(p);
      out.lots_seen = lots.length;
      await this.store.updateScan(id, { lots_seen: lots.length, message: "pulled; valuing" });

      if (p.value !== false && lots.length) {
        const dayStart = Math.floor(Date.now() / 86400000) * 86400;
        const usedToday = await this.store.valuationsSince(dayStart);
        const budget = Math.max(0, this.c.dailyValuationCap - usedToday);
        const maxLots = Math.min(p.max_value ?? this.c.valuePerRun, budget);
        if (maxLots > 0) {
          const unvalued = new Set((await this.store.lots({ onlyUnvalued: true })).map((l) => l.id));
          const todo = lots.filter((l) => unvalued.has(l.id));
          out.lots_valued = await this.pipeline.valueMany(todo, {
            maxLots, deadline,
            onDone: (n, total, lot) => this.store.updateScan(id, { lots_valued: n, message: `valued ${n}/${total}: ${lot.title.slice(0, 60)}` }).catch(() => undefined),
          });
        } else {
          await this.store.updateScan(id, { message: `daily valuation cap reached (${usedToday}/${this.c.dailyValuationCap})` });
        }
      }

      // Live-refresh what is about to close, then alert on hot ones.
      if (Date.now() < deadline - 20_000) {
        const now = Date.now() / 1000;
        const closing = await this.store.lots({ endsAfter: now - 60, endsBefore: now + Math.max(2, this.c.alertWindowMin / 60) * 3600 });
        const vals = await this.store.valuationsFor(closing.map((l) => l.id));
        const refreshed: Lot[] = [];
        for (const lot of closing.slice(0, 60)) {
          if (Date.now() > deadline - 10_000) break;
          try {
            const st = await this.client.lotState(lot.id);
            if (st && Object.keys(st).length) refreshed.push(applyState(lot, st, Date.now() / 1000));
          } catch (e) {
            console.warn("refresh failed", lot.id, e);
          }
        }
        if (refreshed.length) await this.store.upsertLots(refreshed);
        out.refreshed = refreshed.length;
        const report = await this.calibration();
        const opps = (refreshed.length ? refreshed : closing).filter((l) => !l.is_closed)
          .map((l) => buildOpportunity(l, vals.get(l.id) ?? null, this.c, Date.now() / 1000, scoreOptionsFor(l, report, {}, this.c)));
        out.alerted = await sendAlerts(this.store, opps);
      }
      out.settled = await this.settleClosedLots(this.c.settlePerRun, deadline);
      await this.store.purgeClosed();
      await this.store.updateScan(id, { finished_at: Date.now() / 1000, status: "done", lots_valued: out.lots_valued, message: `done in ${Math.round((Date.now() - started) / 1000)}s: ${out.lots_seen} lots, ${out.lots_valued} valued, ${out.refreshed} refreshed, ${out.alerted} alerted, ${out.settled} settled` });
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      console.error("spread scan failed", e);
      await this.store.updateScan(id, { finished_at: Date.now() / 1000, status: "error", message: msg });
      out.error = msg;
    }
    return out;
  }

  /** The market-intel board: category trends, velocity leaders and value traps, all from stored data. */
  async intel(p: IntelParams = {}): Promise<MarketIntel> {
    const report = await this.calibration();
    const now = Date.now() / 1000;
    const lots = await this.store.lots({ limit: 5000 });
    const vals = await this.store.valuationsFor(lots.map((l) => l.id));
    const opps = lots.map((l) => buildOpportunity(l, vals.get(l.id) ?? null, this.c, now, scoreOptionsFor(l, report, p, this.c)));
    const history = await this.store.valuationHistory(now - this.c.trendWindowDays * 86400);
    const liquidity = report?.liquidity ?? buildReport([], this.c, now).liquidity;
    return buildIntel(opps, history, liquidity, this.c, now);
  }

  async refreshLot(lotId: number): Promise<Lot | null> {
    const lot = await this.store.getLot(lotId);
    if (!lot) return null;
    const st = await this.client.lotState(lotId);
    if (!st || !Object.keys(st).length) return lot;
    const fresh = applyState(lot, st, Date.now() / 1000);
    await this.store.upsertLots([fresh]);
    return fresh;
  }

  async refreshMany(ids: number[]): Promise<number> {
    let n = 0;
    for (const id of ids) if (await this.refreshLot(id)) n++;
    return n;
  }

  /** Full-size photo URLs for a lot (one GetLotDetails call; cached on the stored lot). */
  async picturesFor(lot: Lot): Promise<string[]> {
    const fresh = await this.enrichLot(lot.id);
    return fresh?.pictures ?? [];
  }

  async enrichLot(lotId: number): Promise<Lot | null> {
    const lot = await this.store.getLot(lotId);
    if (!lot) return null;
    const raw = await this.client.lotDetails(lotId);
    if (!raw || !raw.id) return lot;
    const fresh = normalizeLot(raw, Date.now() / 1000, this.c.hibidSite, this.c.buyerPremium);
    fresh.pictures = ((raw.pictures ?? []) as { fullSizeLocation?: string; hdThumbnailLocation?: string }[]).map((p) => p.fullSizeLocation || p.hdThumbnailLocation || "").filter(Boolean);
    fresh.terms = raw.auction?.termsAndConditions ?? null;
    fresh.shipping_info = raw.auction?.shippingAndPickupInfo ?? null;
    fresh.payment_info = raw.auction?.paymentInfo ?? null;
    fresh.alerted_at = lot.alerted_at ?? null;
    await this.store.upsertLots([fresh]);
    return fresh;
  }
}
