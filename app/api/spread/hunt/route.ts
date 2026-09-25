// Go looking: run the playbook's own search terms against HiBid rather than waiting for a match to
// float past in a broad scan.
import { NextResponse } from "next/server";
import { authorized, deny } from "@/lib/spread/auth";
import { config } from "@/lib/spread/config";
import { Scanner } from "@/lib/spread/scanner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!authorized(req)) return deny();
  const body = (await req.json().catch(() => ({}))) as { max_theses?: number; ids?: string[] };
  const scanner = new Scanner();
  const all = await scanner.theses();
  const picked = body.ids?.length ? all.filter((t) => body.ids!.includes(t.id)) : undefined;
  const deadline = Date.now() + config.runBudgetMs;
  const { hunted, lots } = await scanner.hunt({ theses: picked, maxTheses: body.max_theses, deadline });
  return NextResponse.json({ hunted, lots_found: lots.length });
}
