// The playbook: the niches we hunt, their measured numbers, and the bid ceiling each one implies.
import { NextResponse } from "next/server";
import { authorized, deny } from "@/lib/spread/auth";
import { config } from "@/lib/spread/config";
import { normalizeThesis, refreshThesis } from "@/lib/spread/playbook";
import { Scanner } from "@/lib/spread/scanner";
import { getStore } from "@/lib/spread/store";
import type { Thesis } from "@/lib/spread/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!authorized(req)) return deny();
  const theses = await new Scanner().theses();
  return NextResponse.json({
    theses: theses.sort((a, b) => (b.max_bid ?? 0) - (a.max_bid ?? 0) || a.name.localeCompare(b.name)),
    settings: {
      target_monthly_roi: config.targetMonthlyRoi,
      min_buy_multiple: config.minBuyMultiple,
      research_ttl_days: config.researchTtlDays,
      hunt_per_run: config.huntPerRun,
    },
  });
}

/** Create or edit a thesis by hand. Partial bodies are fine; derived fields are always recomputed. */
export async function POST(req: Request) {
  if (!authorized(req)) return deny();
  const body = (await req.json().catch(() => ({}))) as Partial<Thesis> & { name?: string };
  const scanner = new Scanner();
  const existing = await scanner.theses();
  const prev = body.id ? existing.find((t) => t.id === body.id) : undefined;
  if (!prev && !body.name) return NextResponse.json({ detail: "name required for a new thesis" }, { status: 400 });
  const merged = prev ? refreshThesis({ ...prev, ...body } as Thesis, config) : normalizeThesis({ ...body, name: body.name! }, config);
  await scanner.saveTheses([merged]);
  return NextResponse.json({ thesis: merged });
}

export async function DELETE(req: Request) {
  if (!authorized(req)) return deny();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ detail: "id required" }, { status: 400 });
  await getStore().deleteThesis(id);
  return NextResponse.json({ deleted: id });
}
