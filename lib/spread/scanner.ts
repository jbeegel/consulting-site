// Scan = pull lots from HiBid -> store -> value the most promising ones -> refresh closing lots -> alerts.
// Designed for serverless: every run is time-boxed (config.runBudgetMs) and picks up where the last left off.
import { sendAlerts } from "./alerts";
import { config, type Config } from "./config";
import { applyState, HiBidClient, normalizeLot } from "./hibid";
import { buildReport, liquidityAdjustmentFor } from "./calibration";
import { buildIntel } from "./intel";
import { researcherFor, staleTheses } from "./discovery";
import { applyOutcomeStats, huntOrder, matchTheses, normalizeThesis, refreshAll, thesesFromOutcomes } from "./playbook";
import { SEED_THESES } from "./seeds";
import { gradingEconomics, landedCost, listingEconomics, scoreLot, whyUpside, type ScoreOptions } from "./scoring";
import { getStore, type Store } from "./store";
import type { CalibrationReport, IntelParams, Lot, MarketIntel, Opportunity, Outcome, ScanParams, Thesis, Valuation } from "./types";
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

export function buildOpportunity(lot: Lot, val: Valuation | null, c: Config = config, now = Date.now() / 1000, opts: ScoreOptions = {}, theses: Thesis[] = []): Opportunity {
  const score = scoreLot(lot, val, c, now, opts);
  // Playbook matches attach whether or not a valuation exists: a matched, unvalued penny lot already
  // has a researched price and a bid ceiling behind it, which is the whole point of hunting.
  const hits = theses.length ? matchTheses(lot, theses) : [];
  const ceilings = hits.map((h) => h.max_bid).filter((x): x is number => x !== null);
  return {
    lot, valuation: val, score,
    why: val ? whyUpside(lot, val, score, c) : "",
    listing: listingEconomics(lot, val, score, c),
    grading: gradingEconomics(val, score, c),
    theses: hits,
    max_bid: ceilings.length ? Math.min(...ceilings) : null,
  };
}

export class Scanner {
  readonly client: HiBidClient;
  readonly pipeline: ValuationPipeline;
  constructor(readonly c: Config = config, readonly store: Store = getStore(), client?: HiBidClient) {
    this.client = client ?? new HiBidClient(c.hibidGraphql, c.hibidSite, c.requestDelayMs);
    this.pipeline = new ValuationPipeline(c, store, undefined, (lot) => this.picturesFor(lot), () => this.calibration());
  }

  private _calibration: { at: number; report: CalibrationReport } | null = null;
  private _theses: { at: number; rows: Thesis[] } | null = null;

  /**
   * The playbook, seeded on first use. Cached for a minute per instance like the report card.
   *
   * Seeding on read rather than on deploy means a fresh install has something to hunt immediately,
   * and the seeds carry no invented market data — their prices stay null until a research pass runs.
   */
  async theses(force = false): Promise<Thesis[]> {
    if (!this.c.playbook) return [];
    const now = Date.now();
    if (!force && this._theses && now - this._theses.at < 60_000) return this._theses.rows;
    let rows = await this.store.theses();
    if (!rows.length) {
      rows = SEED_THESES.map((s) => normalizeThesis(s, this.c));
      await this.store.saveTheses(rows);
      console.log(`spread: seeded playbook with ${rows.length} theses`);
    } else {
      // Config can change under stored theses (a new target ROI moves every ceiling), so re-derive.
      rows = refreshAll(rows, this.c);
    }
    this._theses = { at: now, rows };
    return rows;
  }

  async saveTheses(rows: Thesis[]): Promise<void> {
    await this.store.saveTheses(rows);
    this._theses = null;
  }

  /** Roll recorded outcomes onto each thesis, and propose new ones from what you have actually flipped. */
  async playbookReview(): Promise<{ theses: Thesis[]; proposed: Thesis[] }> {
    const [rows, outcomes] = await Promise.all([this.theses(), this.store.outcomes()]);
    const lots = await this.store.lots({ includeClosed: true, limit: 5000 });
    const byId = new Map(lots.map((l) => [l.id, l]));
    const withStats = applyOutcomeStats(rows, outcomes, byId);
    const proposed = thesesFromOutcomes(outcomes, this.c, withStats);
    await this.saveTheses(withStats);
    return { theses: withStats, proposed };
  }

  /**
   * Research pass: discover new niches and re-measure stale ones. Costs Claude calls with web search,
   * so it is explicit rather than part of every scan.
   */
  async research(opts: { discover?: number; refresh?: number; focus?: string } = {}): Promise<{ added: Thesis[]; updated: Thesis[]; error?: string }> {
    const r = researcherFor(this.c);
    if (!r) return { added: [], updated: [], error: "no Anthropic key: set ANTHROPIC_API_KEY to run research" };
    const existing = await this.theses();
    const added: Thesis[] = [];
    const updated: Thesis[] = [];
    try {
      const nRefresh = opts.refresh ?? 6;
      const stale = staleTheses(existing, this.c).slice(0, nRefresh);
      if (stale.length) {
        const byName = new Map(existing.map((t) => [t.name.toLowerCase(), t]));
        for (const raw of await r.refresh(stale)) {
          const prev = byName.get(raw.name.toLowerCase());
          if (!prev) continue;
          // Keep identity, provenance and accumulated stats; replace only what research measures.
          updated.push(normalizeThesis({ ...prev, ...raw, id: prev.id, origin: prev.origin, stats: prev.stats, created_at: prev.created_at }, this.c));
        }
      }
      const nDiscover = opts.discover ?? this.c.discoverCount;
      if (nDiscover > 0) {
        const avoid = existing.map((t) => t.name);
        const focus = opts.focus ?? "small advertising ephemera, and bank / insurance / financial memorabilia";
        for (const raw of await r.discover(nDiscover, avoid, focus)) {
          const t = normalizeThesis({ ...raw, origin: "discovered" }, this.c);
          if (existing.some((e) => e.id === t.id) || added.some((e) => e.id === t.id)) continue;
          added.push(t);
        }
      }
      if (added.length || updated.length) await this.saveTheses([...updated, ...added]);
      return { added, updated };
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      console.warn("thesis research failed", e);
      if (added.length || updated.length) await this.saveTheses([...updated, ...added]);
      return { added, updated, error: msg };
    }
  }

  /**
   * Hunt: run the playbook's own search terms against HiBid instead of waiting for a matching lot to
   * drift past in a broad scan. Rotates through theses least-recently-hunted first so the search budget
   * spreads across the whole playbook over a few runs.
   */
  async hunt(opts: { theses?: Thesis[]; maxTheses?: number; deadline?: number } = {}): Promise<{ hunted: string[]; lots: Lot[] }> {
    const all = opts.theses ?? (await this.theses());
    const picks = huntOrder(all, opts.maxTheses ?? this.c.huntPerRun);
    const kept = new Map<number, Lot>();
    const hunted: string[] = [];
    for (const t of picks) {
      if (opts.deadline && Date.now() > opts.deadline) break;
      for (const q of t.queries.slice(0, 2)) {
        if (opts.deadline && Date.now() > opts.deadline) break;
        try {
          const lots = await this.pull({ status: "OPEN", hours: null, search_text: q, max_pages: this.c.huntPages, value: false });
          for (const l of lots) kept.set(l.id, l);
        } catch (e) {
          console.warn("hunt failed for", t.id, q, e);
        }
      }
      hunted.push(t.id);
      t.last_hunted_at = Date.now() / 1000;
    }
    if (hunted.length) await this.saveTheses(picks);
    return { hunted, lots: [...kept.values()] };
  }

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
  async scan(p: ScanParams): Promise<{ id: number; lots_seen: number; lots_valued: number; refreshed: number; alerted: number; settled: number; hunted: number; error?: string }> {
    const started = Date.now();
    const deadline = started + this.c.runBudgetMs;
    const running = await this.store.runningScan();
    if (running) return { id: running.id, lots_seen: running.lots_seen, lots_valued: running.lots_valued, refreshed: 0, alerted: 0, settled: 0, hunted: 0, error: "scan already running" };
    const id = await this.store.startScan(p);
    const out = { id, lots_seen: 0, lots_valued: 0, refreshed: 0, alerted: 0, settled: 0, hunted: 0 } as Awaited<ReturnType<Scanner["scan"]>>;
    try {
      let lots = await this.pull(p);

      // Hunt: the broad pull sees whatever is closing; these searches go looking for the niches we
      // already know pay. Cheap (no valuation), and the results join the same pool.
      const theses = p.hunt === false ? [] : await this.theses();
      if (theses.length && Date.now() < deadline - 30_000) {
        const h = await this.hunt({ theses, deadline: deadline - 20_000 });
        out.hunted = h.hunted.length;
        const seen = new Set(lots.map((l) => l.id));
        lots = lots.concat(h.lots.filter((l) => !seen.has(l.id)));
        if (h.hunted.length) await this.store.updateScan(id, { message: `hunted ${h.hunted.length} theses` });
      }

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
          // A lot that matches a researched niche outranks one that merely contains a hot word.
          const boost = theses.length ? (l: Lot) => { const m = matchTheses(l, theses); return m.length ? 2 + 2 * m[0].strength : 0; } : undefined;
          out.lots_valued = await this.pipeline.valueMany(todo, {
            maxLots, deadline, boost,
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
          .map((l) => buildOpportunity(l, vals.get(l.id) ?? null, this.c, Date.now() / 1000, scoreOptionsFor(l, report, {}, this.c), theses));
        out.alerted = await sendAlerts(this.store, opps);
      }
      out.settled = await this.settleClosedLots(this.c.settlePerRun, deadline);
      if (theses.length) {
        // Local arithmetic over outcomes we already hold, so the playbook never goes stale waiting
        // for someone to press a button.
        try {
          await this.playbookReview();
        } catch (e) {
          console.warn("playbook review failed", e);
        }
      }
      await this.store.purgeClosed();
      await this.store.updateScan(id, { finished_at: Date.now() / 1000, status: "done", lots_valued: out.lots_valued, message: `done in ${Math.round((Date.now() - started) / 1000)}s: ${out.lots_seen} lots, ${out.lots_valued} valued, ${out.refreshed} refreshed, ${out.alerted} alerted, ${out.settled} settled, ${out.hunted} theses hunted` });
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
    const theses = await this.theses();
    const opps = lots.map((l) => buildOpportunity(l, vals.get(l.id) ?? null, this.c, now, scoreOptionsFor(l, report, p, this.c), theses));
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
