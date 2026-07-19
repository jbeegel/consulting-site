// Audit persistence — Supabase as durable cache + archive.
//
// Two jobs in one table:
//   1. Durable cache: on Vercel serverless the in-memory cache is
//      per-instance, so without this a cold start re-runs the DataForSEO
//      and Claude calls. A read-through here makes the 6h window real.
//   2. Archive: every live audit is saved, so a prospect's first audit
//      becomes their baseline — re-openable and queryable later.
//
// Only LIVE audits persist (demo audits are deterministic and free to
// recompute). Everything no-ops without the Supabase env keys.

import { db } from "@/lib/db";
import type { OpportunityAudit } from "./types";

export async function loadRecentAudit(
  domain: string,
  maxAgeMs: number
): Promise<OpportunityAudit | null> {
  const supabase = db();
  if (!supabase) return null;
  try {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const { data } = await supabase
      .from("audits")
      .select("payload")
      .eq("domain", domain)
      .eq("mode", "live")
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data?.payload as OpportunityAudit) ?? null;
  } catch {
    return null;
  }
}

export async function saveAudit(audit: OpportunityAudit): Promise<void> {
  const supabase = db();
  if (!supabase) return;
  try {
    await supabase.from("audits").insert({
      domain: audit.brand.domain,
      mode: audit.meta.mode,
      score: audit.score.overall,
      opportunity_base: audit.economics.opportunity.base,
      payload: audit,
    });
  } catch {
    /* archiving must never block the audit */
  }
}
