import { NextResponse } from "next/server";
import { authorized, deny } from "@/lib/spread/auth";
import { Scanner } from "@/lib/spread/scanner";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  if (!authorized(req)) return deny();
  const body = (await req.json().catch(() => ({}))) as { ids?: number[] };
  const ids = (body.ids ?? []).map(Number).filter(Number.isFinite).slice(0, 60);
  try {
    const n = await new Scanner().refreshMany(ids);
    return NextResponse.json({ refreshed: n });
  } catch (e) {
    return NextResponse.json({ detail: `HiBid refresh failed: ${e instanceof Error ? e.message : e}` }, { status: 502 });
  }
}
