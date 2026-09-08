import { NextResponse } from "next/server";
import { authorized, deny } from "@/lib/spread/auth";
import { buildOpportunity, Scanner } from "@/lib/spread/scanner";
import { getStore } from "@/lib/spread/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!authorized(req)) return deny();
  const id = Number((await params).id);
  const store = getStore();
  let lot = await store.getLot(id);
  if (!lot) return NextResponse.json({ detail: "unknown lot" }, { status: 404 });
  if (new URL(req.url).searchParams.get("enrich") && !lot.pictures) {
    try {
      lot = (await new Scanner().enrichLot(id)) ?? lot;
    } catch (e) {
      console.warn("enrich failed", e);
    }
  }
  return NextResponse.json(buildOpportunity(lot, await store.getValuation(id)));
}
