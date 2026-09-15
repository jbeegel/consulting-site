import { NextResponse } from "next/server";
import { authorized, deny } from "@/lib/spread/auth";
import { buildOpportunity, Scanner } from "@/lib/spread/scanner";
import { getStore } from "@/lib/spread/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!authorized(req)) return deny();
  const id = Number((await params).id);
  const lot = await getStore().getLot(id);
  if (!lot) return NextResponse.json({ detail: "unknown lot" }, { status: 404 });
  const scanner = new Scanner();
  // Load the watchlist first: it is what injects the buyer's lenses and standing instructions into the
  // appraisal prompt, and a manual revalue is exactly when those matter most.
  const watchlist = await scanner.watchlist().catch(() => null);
  const v = await scanner.pipeline.valueLot(lot, true);
  const theses = await scanner.theses().catch(() => []);
  return NextResponse.json(buildOpportunity(lot, v, undefined, Date.now() / 1000, {}, theses, watchlist));
}
