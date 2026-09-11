import { NextResponse } from "next/server";
import { authorized, deny } from "@/lib/spread/auth";
import { applyIntelFilters } from "@/lib/spread/intel";
import { buildOpportunity, Scanner, scoreOptionsFor } from "@/lib/spread/scanner";
import { getStore } from "@/lib/spread/store";
import type { IntelParams } from "@/lib/spread/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!authorized(req)) return deny();
  const u = new URL(req.url);
  const hours = Number(u.searchParams.get("hours")) || null;
  const category = u.searchParams.get("category") || null;
  const minScore = Number(u.searchParams.get("min_score")) || 0;
  const q = (u.searchParams.get("q") || "").toLowerCase();
  const includeUnvalued = u.searchParams.get("include_unvalued") !== "false";
  const limit = Number(u.searchParams.get("limit")) || 2000;
  // The user's own risk parameters: how much liquidity should count, and what they refuse to hold.
  const numParam = (k: string): number | undefined => {
    const v = u.searchParams.get(k);
    if (v === null || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const rankRaw = u.searchParams.get("rank_by");
  const gradeRaw = (u.searchParams.get("min_liquidity_grade") || "").toUpperCase();
  const intelParams: IntelParams = {
    liquidity_weight: numParam("liquidity_weight"),
    handling_days: numParam("handling_days"),
    max_days_to_sell: numParam("max_days_to_sell") ?? null,
    min_liquidity_grade: "ABCDF".includes(gradeRaw) && gradeRaw ? (gradeRaw as IntelParams["min_liquidity_grade"]) : null,
    rank_by: (["score", "velocity", "liquidity", "spread"].includes(rankRaw ?? "") ? rankRaw : "score") as IntelParams["rank_by"],
  };
  const now = Date.now() / 1000;
  const store = getStore();
  // One report card for the whole request; it feeds each lot the measured speed of its category.
  const scanner = new Scanner();
  const report = await scanner.calibration().catch(() => null);
  const theses = await scanner.theses().catch(() => []);
  const lots = await store.lots({ endsBefore: hours ? now + hours * 3600 : null, endsAfter: now - 60, category });
  const vals = await store.valuationsFor(lots.map((l) => l.id));
  const out = [];
  for (const lot of lots) {
    if (q && !`${lot.title} ${lot.auction_name ?? ""}`.toLowerCase().includes(q)) continue;
    const v = vals.get(lot.id) ?? null;
    if (!v && !includeUnvalued) continue;
    const opp = buildOpportunity(lot, v, undefined, now, scoreOptionsFor(lot, report, intelParams), theses);
    if (v && opp.score.score < minScore) continue;
    out.push(opp);
  }
  const ranked = applyIntelFilters(out, intelParams);
  return NextResponse.json({ generated_at: now, count: ranked.length, params: intelParams, opportunities: ranked.slice(0, limit) });
}
