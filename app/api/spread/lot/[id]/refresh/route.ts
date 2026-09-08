import { NextResponse } from "next/server";
import { authorized, deny } from "@/lib/spread/auth";
import { buildOpportunity, Scanner } from "@/lib/spread/scanner";
import { getStore } from "@/lib/spread/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!authorized(req)) return deny();
  const id = Number((await params).id);
  try {
    const lot = await new Scanner().refreshLot(id);
    if (!lot) return NextResponse.json({ detail: "unknown lot" }, { status: 404 });
    return NextResponse.json(buildOpportunity(lot, await getStore().getValuation(id)));
  } catch (e) {
    return NextResponse.json({ detail: `HiBid refresh failed: ${e instanceof Error ? e.message : e}` }, { status: 502 });
  }
}
