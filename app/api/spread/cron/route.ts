// Scheduled scan. Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET` (daily on Hobby;
// the GitHub Actions workflow in .github/workflows/spread-cron.yml calls it every 15 minutes).
import { NextResponse } from "next/server";
import { authorized, deny } from "@/lib/spread/auth";
import { config } from "@/lib/spread/config";
import { Scanner } from "@/lib/spread/scanner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function run(req: Request) {
  if (!authorized(req, { cron: true })) return deny();
  const scanner = new Scanner();
  const result = await scanner.scan({
    status: config.cronStatus, hours: config.cronHours, max_pages: config.cronMaxPages,
    search_text: config.cronSearch, category: config.cronCategory, value: true, trigger: "cron",
  });
  return NextResponse.json(result, { status: result.error && result.error !== "scan already running" ? 500 : 200 });
}
export const GET = run;
export const POST = run;
