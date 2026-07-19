// One-click Excel export. GET /api/audit/export?domain=X[&live=0|1]
// Streams a formatted, pivot-ready .xlsx of the full audit.

import { NextRequest, NextResponse } from "next/server";
import { normalizeDomain } from "@/lib/core/market";
import { dataforseoConfigured } from "@/lib/audit/providers";
import { buildAuditMaybeLive } from "@/lib/audit/live";
import { latestReadyJourney } from "@/lib/audit/journey-store";
import { buildWorkbook } from "@/lib/audit/workbook";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const domain = normalizeDomain(req.nextUrl.searchParams.get("domain") ?? "");
  if (!domain) {
    return NextResponse.json({ error: "Pass ?domain=" }, { status: 400 });
  }
  const live = req.nextUrl.searchParams.get("live");
  const useLive = live === "0" ? false : live === "1" ? true : dataforseoConfigured();
  const [audit, journey] = await Promise.all([
    buildAuditMaybeLive(domain, useLive),
    latestReadyJourney(domain),
  ]);
  const buffer = await buildWorkbook(audit, journey);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="capture-audit-${domain.replace(/[^a-z0-9.-]/g, "")}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
