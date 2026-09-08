import { NextResponse } from "next/server";
import { authorized, deny } from "@/lib/spread/auth";
import { Scanner } from "@/lib/spread/scanner";
import type { ScanParams } from "@/lib/spread/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // a scan values several lots with web search; each takes 10–60s

export async function POST(req: Request) {
  if (!authorized(req)) return deny();
  const body = (await req.json().catch(() => ({}))) as Partial<ScanParams>;
  const params: ScanParams = {
    status: body.status || "OPEN", hours: body.hours ?? 24, category: body.category ?? null,
    search_text: body.search_text ?? null, zip: body.zip ?? null, miles: body.miles ?? null,
    max_pages: Math.min(20, body.max_pages ?? 5), max_value: body.max_value ?? undefined,
    value: body.value !== false, trigger: "manual",
  };
  const scanner = new Scanner();
  const result = await scanner.scan(params);
  const status = result.error === "scan already running" ? 409 : 200;
  return NextResponse.json({ started: status === 200, result }, { status });
}
