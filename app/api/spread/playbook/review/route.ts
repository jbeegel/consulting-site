// Grade the playbook against what you actually bought and sold, and propose new theses from your wins.
import { NextResponse } from "next/server";
import { authorized, deny } from "@/lib/spread/auth";
import { Scanner } from "@/lib/spread/scanner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!authorized(req)) return deny();
  const scanner = new Scanner();
  const { theses, proposed } = await scanner.playbookReview();
  const accept = new URL(req.url).searchParams.get("accept") === "true";
  if (accept && proposed.length) await scanner.saveTheses(proposed);
  return NextResponse.json({ theses, proposed, accepted: accept ? proposed.length : 0 });
}
