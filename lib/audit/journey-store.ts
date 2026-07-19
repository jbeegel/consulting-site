// Journey job persistence — Supabase `journeys` table, with an in-memory
// fallback so local keyless dev still works end to end (single process, so
// the fallback is real there; production polling needs the table because
// each poll may land on a different serverless instance).

import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import type { JourneyJob, JourneyMap, JourneyStatus } from "./journey-types";

const memory = new Map<string, JourneyJob>();

// A job that hasn't touched its row in this long is dead — the serverless
// invocation behind it was reclaimed. GET marks it failed so the UI can
// offer a clean retry instead of spinning forever.
export const STALE_MS = 8 * 60 * 1000;

interface JourneyRow {
  id: string;
  domain: string;
  status: JourneyStatus;
  phase: string | null;
  error: string | null;
  payload: JourneyMap | null;
  created_at: string;
  updated_at: string;
}

function fromRow(r: JourneyRow): JourneyJob {
  return {
    id: r.id,
    domain: r.domain,
    status: r.status,
    phase: r.phase,
    error: r.error,
    payload: r.payload,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function createJourneyJob(domain: string): Promise<JourneyJob> {
  const now = new Date().toISOString();
  const job: JourneyJob = {
    id: randomUUID(),
    domain,
    status: "queued",
    phase: "Queued",
    error: null,
    payload: null,
    createdAt: now,
    updatedAt: now,
  };
  const supabase = db();
  if (supabase) {
    try {
      await supabase.from("journeys").insert({
        id: job.id,
        domain,
        status: job.status,
        phase: job.phase,
      });
    } catch {
      /* fall through to memory */
    }
  }
  memory.set(job.id, job);
  return job;
}

export async function updateJourneyJob(
  id: string,
  patch: Partial<Pick<JourneyJob, "status" | "phase" | "error" | "payload">>
): Promise<void> {
  const now = new Date().toISOString();
  const m = memory.get(id);
  if (m) memory.set(id, { ...m, ...patch, updatedAt: now });
  const supabase = db();
  if (!supabase) return;
  try {
    await supabase
      .from("journeys")
      .update({
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.phase !== undefined ? { phase: patch.phase } : {}),
        ...(patch.error !== undefined ? { error: patch.error } : {}),
        ...(patch.payload !== undefined ? { payload: patch.payload } : {}),
        updated_at: now,
      })
      .eq("id", id);
  } catch {
    /* memory copy already updated */
  }
}

function withStaleCheck(job: JourneyJob | null): JourneyJob | null {
  if (!job) return null;
  const active = job.status === "queued" || job.status === "crawling" || job.status === "analyzing";
  if (active && Date.now() - new Date(job.updatedAt).getTime() > STALE_MS) {
    const failed: JourneyJob = {
      ...job,
      status: "error",
      error: "The run was interrupted — likely a serverless timeout. Rebuild to try again.",
    };
    // Persist the verdict so every future poll agrees.
    void updateJourneyJob(job.id, { status: failed.status, error: failed.error });
    return failed;
  }
  return job;
}

export async function getJourneyJob(id: string): Promise<JourneyJob | null> {
  const supabase = db();
  if (supabase) {
    try {
      const { data } = await supabase.from("journeys").select("*").eq("id", id).maybeSingle();
      if (data) return withStaleCheck(fromRow(data as JourneyRow));
    } catch {
      /* fall through */
    }
  }
  return withStaleCheck(memory.get(id) ?? null);
}

export async function latestJourneyJob(domain: string): Promise<JourneyJob | null> {
  const supabase = db();
  if (supabase) {
    try {
      const { data } = await supabase
        .from("journeys")
        .select("*")
        .eq("domain", domain)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) return withStaleCheck(fromRow(data as JourneyRow));
    } catch {
      /* fall through */
    }
  }
  let latest: JourneyJob | null = null;
  for (const j of memory.values()) {
    if (j.domain !== domain) continue;
    if (!latest || j.createdAt > latest.createdAt) latest = j;
  }
  return withStaleCheck(latest);
}

// The freshest completed map for a domain — used by the client report and
// the Excel export to fold the journey in when one exists.
export async function latestReadyJourney(
  domain: string,
  maxAgeMs = 7 * 24 * 60 * 60 * 1000
): Promise<JourneyMap | null> {
  const supabase = db();
  if (supabase) {
    try {
      const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
      const { data } = await supabase
        .from("journeys")
        .select("payload")
        .eq("domain", domain)
        .eq("status", "ready")
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data?.payload) return data.payload as JourneyMap;
    } catch {
      /* fall through */
    }
  }
  let latest: JourneyJob | null = null;
  for (const j of memory.values()) {
    if (j.domain !== domain || j.status !== "ready" || !j.payload) continue;
    if (Date.now() - new Date(j.createdAt).getTime() > maxAgeMs) continue;
    if (!latest || j.createdAt > latest.createdAt) latest = j;
  }
  return latest?.payload ?? null;
}
