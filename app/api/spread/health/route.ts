// Setup self-check: everything the dashboard needs to be operational, as pass/fail rows with fixes.
import { NextResponse } from "next/server";
import { authorized, deny } from "@/lib/spread/auth";
import { config } from "@/lib/spread/config";
import { HiBidClient } from "@/lib/spread/hibid";
import { getStore } from "@/lib/spread/store";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Check = { name: string; ok: boolean; level: "required" | "recommended"; detail: string; fix?: string };

export async function GET(req: Request) {
  if (!authorized(req)) return deny();
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  // --- storage
  const sb = db();
  if (!sb) {
    add({ name: "Supabase", ok: false, level: "required", detail: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set; using in-memory store (data vanishes between requests on Vercel)", fix: "Set the Supabase env vars on Vercel and redeploy" });
  } else {
    const missing: string[] = [];
    for (const t of ["spread_lots", "spread_valuations", "spread_valuation_cache", "spread_scans"]) {
      const { error } = await sb.from(t).select("*", { count: "exact", head: true }).limit(1);
      if (error) missing.push(t);
    }
    add(missing.length
      ? { name: "Supabase tables", ok: false, level: "required", detail: `missing: ${missing.join(", ")}`, fix: "Run supabase/spread.sql in the Supabase SQL editor" }
      : { name: "Supabase tables", ok: true, level: "required", detail: "all four tables present" });
  }

  // --- valuation
  add(config.anthropicAvailable
    ? { name: "Anthropic API key", ok: true, level: "required", detail: `model ${config.model}, web search ${config.webSearch ? "on" : "off"}, vision ${config.vision ? "on" : "off"}` }
    : { name: "Anthropic API key", ok: false, level: "required", detail: "ANTHROPIC_API_KEY not set; valuations fall back to eBay comps / auctioneer estimates", fix: "Set ANTHROPIC_API_KEY on Vercel" });
  add({ name: "Valuation budget", ok: true, level: "recommended", detail: `${config.valuePerRun} lots per run, ${config.dailyValuationCap} per day, cache ${config.valuationTtlDays}d` });

  // --- access
  add(config.password
    ? { name: "Dashboard password", ok: true, level: "required", detail: "SPREAD_PASSWORD set" }
    : { name: "Dashboard password", ok: false, level: "required", detail: "SPREAD_PASSWORD not set: anyone with the URL can trigger scans and spend your API budget", fix: "Set SPREAD_PASSWORD on Vercel" });
  add(config.cronSecret
    ? { name: "Cron secret", ok: true, level: "required", detail: "CRON_SECRET set" }
    : { name: "Cron secret", ok: false, level: "required", detail: "CRON_SECRET not set: scheduled scans cannot authenticate", fix: "Set CRON_SECRET on Vercel and as a GitHub Actions secret" });

  // --- alerts / scope
  const alerts = !!config.alertWebhook || !!(config.resendKey && config.alertEmail);
  add({ name: "Alerts", ok: alerts, level: "recommended", detail: alerts ? `webhook ${config.alertWebhook ? "on" : "off"}, email ${config.resendKey && config.alertEmail ? "on" : "off"}; fire at score ≥ ${config.alertMinScore} inside ${config.alertWindowMin} min` : "no alert channel: Strike-level lots will not notify you", fix: alerts ? undefined : "Set SPREAD_ALERT_WEBHOOK (Discord/Slack webhook URL) or RESEND_API_KEY + SPREAD_ALERT_EMAIL" });
  add({ name: "Pickup radius", ok: !!config.zip, level: "recommended", detail: config.zip ? `${config.zip} within ${config.miles ?? "?"} miles` : "no SPREAD_ZIP: scanning nationwide, including lots you cannot pick up", fix: config.zip ? undefined : "Set SPREAD_ZIP and SPREAD_MILES" });

  // --- HiBid reachability (one tiny request)
  try {
    const client = new HiBidClient(config.hibidGraphql, config.hibidSite, 0, 1);
    const page = await client.searchLots({ page: 1, pageLength: 1, status: "OPEN", sort: "TIME_LEFT" });
    add({ name: "HiBid reachable", ok: page.filteredCount > 0 || page.results.length > 0, level: "required", detail: `${config.hibidSite}: ${page.filteredCount.toLocaleString()} open lots visible` });
  } catch (e) {
    add({ name: "HiBid reachable", ok: false, level: "required", detail: `request failed: ${e instanceof Error ? e.message : e}`, fix: "If this persists, HiBid is blocking Vercel's IP: run the Python scanner from a home machine (tools/auction-arbitrage)" });
  }

  // --- last scan
  const last = await getStore().lastScan();
  add(last
    ? { name: "Last scan", ok: last.status !== "error", level: "recommended", detail: `${last.status} (${last.trigger}) ${last.finished_at ? Math.round((Date.now() / 1000 - last.finished_at) / 60) + " min ago" : "running"}: ${last.message || `${last.lots_seen} lots, ${last.lots_valued} valued`}` }
    : { name: "Last scan", ok: false, level: "recommended", detail: "no scan has run yet", fix: "Click Scan HiBid, or trigger the cron (GitHub Actions → spread-hunter-cron → Run workflow)" });

  const ok = checks.filter((c) => c.level === "required").every((c) => c.ok);
  return NextResponse.json({ ok, checks, generated_at: Date.now() / 1000 });
}
