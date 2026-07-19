// The full Opportunity Audit as JSON — the same object the /audit/[domain]
// page renders. GET /api/audit?domain=X[&live=0|1]

import { NextRequest, NextResponse } from "next/server";
import { normalizeDomain } from "@/lib/core/market";
import { dataforseoConfigured } from "@/lib/audit/providers";
import { buildAuditMaybeLive } from "@/lib/audit/live";

export const maxDuration = 300; // first live run can exceed 60s (providers + analyst pass)

export async function GET(req: NextRequest) {
  const domain = normalizeDomain(req.nextUrl.searchParams.get("domain") ?? "");
  if (!domain) {
    return NextResponse.json({ error: "Pass ?domain=" }, { status: 400 });
  }
  const live = req.nextUrl.searchParams.get("live");
  const useLive = live === "0" ? false : live === "1" ? true : dataforseoConfigured();
  const audit = await buildAuditMaybeLive(domain, useLive);
  return NextResponse.json(audit);
}
