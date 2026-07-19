// Lead capture. POST { name?, email, website?, interest?, message?, source? }
// Writes to Supabase `leads`; never fails the visitor — if storage is down
// or unconfigured, we still 200 (the mailto fallback is shown client-side).

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const email = String(body.email ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }
  const supabase = db();
  let stored = false;
  if (supabase) {
    try {
      const { error } = await supabase.from("leads").insert({
        name: String(body.name ?? "").slice(0, 200) || null,
        email: email.slice(0, 320),
        website: String(body.website ?? "").slice(0, 300) || null,
        interest: String(body.interest ?? "").slice(0, 100) || null,
        message: String(body.message ?? "").slice(0, 4000) || null,
        source: String(body.source ?? "homepage").slice(0, 100),
      });
      stored = !error;
    } catch {
      stored = false;
    }
  }
  return NextResponse.json({ ok: true, stored });
}
