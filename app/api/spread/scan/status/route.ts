import { NextResponse } from "next/server";
import { authorized, deny } from "@/lib/spread/auth";
import { getStore } from "@/lib/spread/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!authorized(req)) return deny();
  const store = getStore();
  const [running, last, stats] = await Promise.all([store.runningScan(), store.lastScan(), store.stats()]);
  const s = running ?? last;
  return NextResponse.json({
    status: {
      running: !!running, phase: running ? (running.lots_seen ? "valuing" : "pulling") : s?.status === "error" ? "error" : s ? "done" : "idle",
      lots_seen: s?.lots_seen ?? 0, lots_valued: s?.lots_valued ?? 0, lots_to_value: s?.params?.max_value ?? null,
      started_at: s?.started_at ?? null, finished_at: s?.finished_at ?? null, message: s?.message ?? "",
      error: s?.status === "error" ? s.message : "", scan_id: s?.id ?? null, trigger: s?.trigger ?? null,
    },
    last_scan: last, stats,
  });
}
