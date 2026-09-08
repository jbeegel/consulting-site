import { NextResponse } from "next/server";
import { authorized, deny } from "@/lib/spread/auth";
import { config } from "@/lib/spread/config";
import { scoreLot } from "@/lib/spread/scoring";
import { getStore, summarizeCategories } from "@/lib/spread/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!authorized(req)) return deny();
  const store = getStore();
  const now = Date.now() / 1000;
  const lots = await store.lots({ endsAfter: now - 60 });
  const vals = await store.valuationsFor(lots.map((l) => l.id));
  return NextResponse.json(summarizeCategories(lots, (l) => {
    const v = vals.get(l.id);
    return v ? scoreLot(l, v, config, now).score : null;
  }));
}
