// Persistence for Spread Hunter. Supabase when configured (durable across serverless instances);
// an in-process Map store otherwise so local dev and keyless deployments still work.
import { db } from "@/lib/db";
import type { CategorySummary, Lot, ScanParams, ScanRecord, Valuation } from "./types";

export interface LotQuery {
  includeClosed?: boolean;
  endsBefore?: number | null;
  endsAfter?: number | null;
  category?: string | null;
  onlyUnvalued?: boolean;
  limit?: number;
}

export interface Store {
  upsertLots(lots: Lot[]): Promise<number>;
  getLot(id: number): Promise<Lot | null>;
  lots(q?: LotQuery): Promise<Lot[]>;
  purgeClosed(olderThanSeconds?: number): Promise<number>;
  saveValuation(lotId: number, v: Valuation): Promise<void>;
  getValuation(lotId: number): Promise<Valuation | null>;
  valuationsFor(ids: number[]): Promise<Map<number, Valuation>>;
  cachedValuation(titleKey: string, maxAgeSeconds: number): Promise<Valuation | null>;
  startScan(params: ScanParams): Promise<number>;
  updateScan(id: number, fields: Partial<ScanRecord>): Promise<void>;
  lastScan(): Promise<ScanRecord | null>;
  runningScan(): Promise<ScanRecord | null>;
  valuationsSince(sinceSeconds: number): Promise<number>;
  markAlerted(ids: number[], at: number): Promise<void>;
  stats(): Promise<{ open_lots: number; valued_lots: number }>;
  readonly kind: "supabase" | "memory";
}

// ----------------------------------------------------------------------------- memory
class MemoryStore implements Store {
  readonly kind = "memory" as const;
  private lotsMap = new Map<number, Lot>();
  private vals = new Map<number, Valuation>();
  private cache = new Map<string, Valuation>();
  private scans: ScanRecord[] = [];

  async upsertLots(lots: Lot[]) {
    for (const l of lots) {
      const prev = this.lotsMap.get(l.id);
      this.lotsMap.set(l.id, { ...l, alerted_at: l.alerted_at ?? prev?.alerted_at ?? null, pictures: l.pictures ?? prev?.pictures });
    }
    return lots.length;
  }
  async getLot(id: number) { return this.lotsMap.get(id) ?? null; }
  async lots(q: LotQuery = {}) {
    let out = [...this.lotsMap.values()];
    if (!q.includeClosed) out = out.filter((l) => !l.is_closed);
    if (q.endsBefore != null) out = out.filter((l) => l.ends_at !== null && l.ends_at <= q.endsBefore!);
    if (q.endsAfter != null) out = out.filter((l) => l.ends_at === null || l.ends_at >= q.endsAfter!);
    if (q.category) out = out.filter((l) => l.category === q.category);
    if (q.onlyUnvalued) out = out.filter((l) => !this.vals.has(l.id));
    out.sort((a, b) => (a.ends_at ?? Infinity) - (b.ends_at ?? Infinity));
    return q.limit ? out.slice(0, q.limit) : out;
  }
  async purgeClosed(olderThanSeconds = 3 * 86400) {
    const cutoff = Date.now() / 1000 - olderThanSeconds;
    let n = 0;
    for (const [id, l] of this.lotsMap) if (l.is_closed && l.fetched_at < cutoff) { this.lotsMap.delete(id); n++; }
    return n;
  }
  async saveValuation(lotId: number, v: Valuation) {
    this.vals.set(lotId, v);
    if (v.title_key && v.method !== "none") this.cache.set(v.title_key, v);
  }
  async getValuation(lotId: number) { return this.vals.get(lotId) ?? null; }
  async valuationsFor(ids: number[]) {
    const m = new Map<number, Valuation>();
    for (const id of ids) { const v = this.vals.get(id); if (v) m.set(id, v); }
    return m;
  }
  async cachedValuation(key: string, maxAge: number) {
    const v = this.cache.get(key);
    return v && Date.now() / 1000 - v.created_at <= maxAge ? v : null;
  }
  async startScan(params: ScanParams) {
    const rec: ScanRecord = { id: this.scans.length + 1, started_at: Date.now() / 1000, finished_at: null, status: "running", params, lots_seen: 0, lots_valued: 0, message: "", trigger: params.trigger ?? "manual" };
    this.scans.push(rec);
    return rec.id;
  }
  async updateScan(id: number, fields: Partial<ScanRecord>) {
    const r = this.scans.find((s) => s.id === id);
    if (r) Object.assign(r, fields);
  }
  async lastScan() { return this.scans[this.scans.length - 1] ?? null; }
  async runningScan() { return [...this.scans].reverse().find((s) => s.status === "running") ?? null; }
  async valuationsSince(since: number) { return [...this.vals.values()].filter((v) => v.created_at >= since && !v.cache_hit).length; }
  async markAlerted(ids: number[], at: number) { for (const id of ids) { const l = this.lotsMap.get(id); if (l) l.alerted_at = at; } }
  async stats() {
    const open = [...this.lotsMap.values()].filter((l) => !l.is_closed);
    return { open_lots: open.length, valued_lots: open.filter((l) => this.vals.has(l.id)).length };
  }
}

// ----------------------------------------------------------------------------- supabase
type SB = NonNullable<ReturnType<typeof db>>;
const iso = (s: number | null | undefined) => (s == null ? null : new Date(s * 1000).toISOString());
const secs = (s: string | null | undefined) => (s ? Date.parse(s) / 1000 : null);

class SupabaseStore implements Store {
  readonly kind = "supabase" as const;
  constructor(private sb: SB) {}

  async upsertLots(lots: Lot[]) {
    for (let i = 0; i < lots.length; i += 200) {
      const rows = lots.slice(i, i + 200).map((l) => ({
        id: l.id, title: l.title, category: l.category, category_path: l.category_path, auction_id: l.auction_id ?? null,
        ends_at: iso(l.ends_at), high_bid: l.high_bid, min_bid: l.min_bid, bid_count: l.bid_count, is_closed: l.is_closed,
        fetched_at: iso(l.fetched_at), data: l,
      }));
      const { error } = await this.sb.from("spread_lots").upsert(rows, { onConflict: "id" });
      if (error) throw new Error("spread_lots upsert: " + error.message);
    }
    return lots.length;
  }
  private row2lot(r: { data: Lot; alerted_at: string | null; first_seen?: string | null }): Lot {
    return { ...r.data, alerted_at: secs(r.alerted_at) };
  }
  async getLot(id: number) {
    const { data } = await this.sb.from("spread_lots").select("data, alerted_at").eq("id", id).maybeSingle();
    return data ? this.row2lot(data as { data: Lot; alerted_at: string | null }) : null;
  }
  async lots(q: LotQuery = {}) {
    let qb = this.sb.from("spread_lots").select("data, alerted_at").order("ends_at", { ascending: true, nullsFirst: false }).limit(q.limit ?? 5000);
    if (!q.includeClosed) qb = qb.eq("is_closed", false);
    if (q.endsBefore != null) qb = qb.lte("ends_at", iso(q.endsBefore)!);
    if (q.endsAfter != null) qb = qb.or(`ends_at.is.null,ends_at.gte.${iso(q.endsAfter)}`);
    if (q.category) qb = qb.eq("category", q.category);
    const { data, error } = await qb;
    if (error) throw new Error("spread_lots select: " + error.message);
    let out = (data ?? []).map((r) => this.row2lot(r as { data: Lot; alerted_at: string | null }));
    if (q.onlyUnvalued && out.length) {
      const valued = await this.valuationsFor(out.map((l) => l.id));
      out = out.filter((l) => !valued.has(l.id));
    }
    return out;
  }
  async purgeClosed(olderThanSeconds = 3 * 86400) {
    const { count } = await this.sb.from("spread_lots").delete({ count: "exact" }).eq("is_closed", true).lt("fetched_at", iso(Date.now() / 1000 - olderThanSeconds)!);
    return count ?? 0;
  }
  async saveValuation(lotId: number, v: Valuation) {
    const { error } = await this.sb.from("spread_valuations").upsert({
      lot_id: lotId, title_key: v.title_key, low: v.low, mid: v.mid, high: v.high, confidence: v.confidence,
      method: v.method, created_at: iso(v.created_at), cache_hit: !!v.cache_hit, data: v,
    }, { onConflict: "lot_id" });
    if (error) throw new Error("spread_valuations upsert: " + error.message);
    if (v.title_key && v.method !== "none" && !v.cache_hit) {
      await this.sb.from("spread_valuation_cache").upsert({ title_key: v.title_key, created_at: iso(v.created_at), data: v }, { onConflict: "title_key" });
    }
  }
  async getValuation(lotId: number) {
    const { data } = await this.sb.from("spread_valuations").select("data").eq("lot_id", lotId).maybeSingle();
    return (data?.data as Valuation) ?? null;
  }
  async valuationsFor(ids: number[]) {
    const m = new Map<number, Valuation>();
    for (let i = 0; i < ids.length; i += 500) {
      const { data } = await this.sb.from("spread_valuations").select("lot_id, data").in("lot_id", ids.slice(i, i + 500));
      for (const r of data ?? []) m.set(r.lot_id as number, r.data as Valuation);
    }
    return m;
  }
  async cachedValuation(key: string, maxAge: number) {
    const { data } = await this.sb.from("spread_valuation_cache").select("data, created_at").eq("title_key", key).maybeSingle();
    if (!data) return null;
    const created = secs(data.created_at as string) ?? 0;
    return Date.now() / 1000 - created <= maxAge ? (data.data as Valuation) : null;
  }
  async startScan(params: ScanParams) {
    const { data, error } = await this.sb.from("spread_scans").insert({ started_at: iso(Date.now() / 1000), status: "running", params, trigger: params.trigger ?? "manual" }).select("id").single();
    if (error) throw new Error("spread_scans insert: " + error.message);
    return data.id as number;
  }
  async updateScan(id: number, f: Partial<ScanRecord>) {
    const row: Record<string, unknown> = { ...f };
    if (f.finished_at !== undefined) row.finished_at = iso(f.finished_at);
    if (f.started_at !== undefined) row.started_at = iso(f.started_at);
    await this.sb.from("spread_scans").update(row).eq("id", id);
  }
  private row2scan(r: Record<string, unknown>): ScanRecord {
    return { id: r.id as number, started_at: secs(r.started_at as string) ?? 0, finished_at: secs(r.finished_at as string | null), status: r.status as ScanRecord["status"], params: (r.params as ScanParams) ?? {}, lots_seen: (r.lots_seen as number) ?? 0, lots_valued: (r.lots_valued as number) ?? 0, message: (r.message as string) ?? "", trigger: (r.trigger as string) ?? "manual" };
  }
  async lastScan() {
    const { data } = await this.sb.from("spread_scans").select("*").order("id", { ascending: false }).limit(1).maybeSingle();
    return data ? this.row2scan(data) : null;
  }
  async runningScan() {
    // A scan older than 10 minutes that still says "running" died with its serverless instance.
    const { data } = await this.sb.from("spread_scans").select("*").eq("status", "running").gte("started_at", iso(Date.now() / 1000 - 600)!).order("id", { ascending: false }).limit(1).maybeSingle();
    return data ? this.row2scan(data) : null;
  }
  async valuationsSince(since: number) {
    const { count } = await this.sb.from("spread_valuations").select("lot_id", { count: "exact", head: true }).gte("created_at", iso(since)!).eq("cache_hit", false);
    return count ?? 0;
  }
  async markAlerted(ids: number[], at: number) {
    if (ids.length) await this.sb.from("spread_lots").update({ alerted_at: iso(at) }).in("id", ids);
  }
  async stats() {
    const { count: open } = await this.sb.from("spread_lots").select("id", { count: "exact", head: true }).eq("is_closed", false);
    const lots = await this.lots({ limit: 5000 });
    const vals = await this.valuationsFor(lots.map((l) => l.id));
    return { open_lots: open ?? 0, valued_lots: vals.size };
  }
}

let memory: MemoryStore | null = null;
export function getStore(): Store {
  const sb = db();
  if (sb) return new SupabaseStore(sb);
  return (memory ??= new MemoryStore());
}

export function summarizeCategories(lots: Lot[], scoreOf: (l: Lot) => number | null): CategorySummary[] {
  const agg = new Map<string, CategorySummary>();
  for (const l of lots) {
    const c = l.category || "Uncategorized";
    const a = agg.get(c) ?? { category: c, lots: 0, valued: 0, best_score: 0, hot: 0 };
    a.lots++;
    const s = scoreOf(l);
    if (s !== null) { a.valued++; a.best_score = Math.max(a.best_score, s); if (s >= 60) a.hot++; }
    agg.set(c, a);
  }
  return [...agg.values()].sort((x, y) => y.best_score - x.best_score || y.lots - x.lots);
}
