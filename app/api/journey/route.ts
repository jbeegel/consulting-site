// The Journey Map job API.
//
//   POST { domain, force? } → starts (or reuses) a deep-pass job and returns
//     it immediately; the crawl + analyst passes continue after the response
//     via after(), inside this function's 300s budget. Status lives in
//     Supabase so any instance can answer the polls.
//   GET ?id= | ?domain=    → job status; payload included once ready.

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { normalizeDomain } from "@/lib/core/market";
import { anthropicConfigured } from "@/lib/audit/analyst";
import { firecrawlConfigured } from "@/lib/audit/crawl";
import { runJourneyJob } from "@/lib/audit/journey";
import {
  createJourneyJob,
  getJourneyJob,
  latestJourneyJob,
} from "@/lib/audit/journey-store";

export const maxDuration = 300; // the deep pass runs inside this window

const REUSE_READY_MS = 7 * 24 * 60 * 60 * 1000; // a week-old map is still the map

export async function POST(req: NextRequest) {
  let body: { domain?: string; force?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const domain = normalizeDomain(body.domain ?? "");
  if (!domain) {
    return NextResponse.json({ error: "Pass { domain }" }, { status: 400 });
  }
  if (!firecrawlConfigured() || !anthropicConfigured()) {
    return NextResponse.json(
      {
        error:
          "The Journey Map needs FIRECRAWL_API_KEY (site crawl) and ANTHROPIC_API_KEY (analyst layer) configured.",
      },
      { status: 503 }
    );
  }

  // Reuse before spending: a fresh finished map, or a run already in flight.
  if (!body.force) {
    const existing = await latestJourneyJob(domain);
    if (existing) {
      const age = Date.now() - new Date(existing.createdAt).getTime();
      const active =
        existing.status === "queued" || existing.status === "crawling" || existing.status === "analyzing";
      if (active || (existing.status === "ready" && age < REUSE_READY_MS)) {
        return NextResponse.json({ job: existing, reused: true });
      }
    }
  }

  const job = await createJourneyJob(domain);
  after(() => runJourneyJob(job.id, domain));
  return NextResponse.json({ job, reused: false });
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const domain = normalizeDomain(req.nextUrl.searchParams.get("domain") ?? "");
  const job = id ? await getJourneyJob(id) : domain ? await latestJourneyJob(domain) : null;
  if (!id && !domain) {
    return NextResponse.json({ error: "Pass ?id= or ?domain=" }, { status: 400 });
  }
  return NextResponse.json({ job });
}
