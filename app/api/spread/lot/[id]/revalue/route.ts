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
  const v = await new Scanner().pipeline.valueLot(lot, true);
  return NextResponse.json(buildOpportunity(lot, v));
}
