// Scan = pull lots from HiBid -> store -> value the most promising ones -> refresh closing lots -> alerts.
// Designed for serverless: every run is time-boxed (config.runBudgetMs) and picks up where the last left off.
import { sendAlerts } from "./alerts";
import { config, type Config } from "./config";
import { applyState, HiBidClient, normalizeLot } from "./hibid";
import { scoreLot, whyUpside } from "./scoring";
import { getStore, type Store } from "./store";
import type { Lot, Opportunity, ScanParams, Valuation } from "./types";
import { ValuationPipeline } from "./valuation";

export function buildOpportunity(lot: Lot, val: Valuation | null, c: Config = config, now = Date.now() / 1000): Opportunity {
  const score = scoreLot(lot, val, c, now);
  return { lot, valuation: val, score, why: val ? whyUpside(lot, val, score, c) : "" };
}

export class Scanner {
  readonly client: HiBidClient;
  readonly pipeline: ValuationPipeline;
  constructor(readonly c: Config = config, readonly store: Store = getStore(), client?: HiBidClient) {
    this.client = client ?? new HiBidClient(c.hibidGraphql, c.hibidSite, c.requestDelayMs);
    this.pipeline = new ValuationPipeline(c, store);
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
  async scan(p: ScanParams): Promise<{ id: number; lots_seen: number; lots_valued: number; refreshed: number; alerted: number; error?: string }> {
    const started = Date.now();
    const deadline = started + this.c.runBudgetMs;
    const running = await this.store.runningScan();
    if (running) return { id: running.id, lots_seen: running.lots_seen, lots_valued: running.lots_valued, refreshed: 0, alerted: 0, error: "scan already running" };
    const id = await this.store.startScan(p);
    const out = { id, lots_seen: 0, lots_valued: 0, refreshed: 0, alerted: 0 } as Awaited<ReturnType<Scanner["scan"]>>;
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
        const opps = (refreshed.length ? refreshed : closing).filter((l) => !l.is_closed).map((l) => buildOpportunity(l, vals.get(l.id) ?? null, this.c));
        out.alerted = await sendAlerts(this.store, opps);
      }
      await this.store.purgeClosed();
      await this.store.updateScan(id, { finished_at: Date.now() / 1000, status: "done", lots_valued: out.lots_valued, message: `done in ${Math.round((Date.now() - started) / 1000)}s: ${out.lots_seen} lots, ${out.lots_valued} valued, ${out.refreshed} refreshed, ${out.alerted} alerted` });
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      console.error("spread scan failed", e);
      await this.store.updateScan(id, { finished_at: Date.now() / 1000, status: "error", message: msg });
      out.error = msg;
    }
    return out;
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
