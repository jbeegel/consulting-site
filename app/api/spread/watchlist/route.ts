// The watchlist: which lenses are switched on, and the buyer's own standing instructions.
//
// Reading merges stored toggles over the built-in lens definitions, so a lens whose prompt was improved
// in code reaches every user without anyone re-saving anything.
import { NextResponse } from "next/server";
import { authorized, deny } from "@/lib/spread/auth";
import { config } from "@/lib/spread/config";
import { MYSTERY_QUERIES } from "@/lib/spread/mystery";
import { lensQueries, watchlistPrompt } from "@/lib/spread/lenses";
import { Scanner } from "@/lib/spread/scanner";
import type { Lens, Watchlist } from "@/lib/spread/types";

export const dynamic = "force-dynamic";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

export async function GET(req: Request) {
  if (!authorized(req)) return deny();
  const w = await new Scanner().watchlist(true);
  return NextResponse.json({
    watchlist: w,
    // What the appraiser will actually be told, verbatim — no hidden prompt.
    prompt_preview: watchlistPrompt(w),
    hunt_queries: lensQueries(w),
    mystery: {
      enabled: config.mystery && config.vision,
      threshold: config.mysteryThreshold,
      per_run: config.mysteryPerRun,
      max_images: config.mysteryMaxImages,
      queries: MYSTERY_QUERIES.slice(0, config.mysteryHuntQueries),
    },
  });
}

/**
 * Save toggles, custom instructions, or a hand-written lens. A partial body is fine: anything absent
 * keeps its current value, so the UI can send just the one switch that changed.
 */
export async function POST(req: Request) {
  if (!authorized(req)) return deny();
  const body = (await req.json().catch(() => ({}))) as {
    lenses?: { id: string; enabled?: boolean }[];
    custom_instructions?: string;
    add?: Partial<Lens> & { name?: string };
    remove?: string;
  };
  const scanner = new Scanner();
  const current = await scanner.watchlist(true);
  const next: Watchlist = { ...current, lenses: current.lenses.map((l) => ({ ...l })) };

  if (Array.isArray(body.lenses)) {
    const want = new Map(body.lenses.map((l) => [l.id, l.enabled !== false]));
    for (const l of next.lenses) if (want.has(l.id)) l.enabled = want.get(l.id)!;
  }
  if (typeof body.custom_instructions === "string") next.custom_instructions = body.custom_instructions.slice(0, 4000);

  if (body.add?.name || body.add?.prompt) {
    const name = (body.add.name ?? "Custom lens").slice(0, 80);
    const id = body.add.id ?? slug(name) ?? `lens-${Date.now()}`;
    const lens: Lens = {
      id, name, hint: (body.add.hint ?? "").slice(0, 140), builtin: false,
      keywords: (body.add.keywords ?? []).map(String).slice(0, 30),
      queries: (body.add.queries ?? []).map(String).slice(0, 8),
      prompt: (body.add.prompt ?? "").slice(0, 2000),
      enabled: body.add.enabled !== false,
    };
    if (!lens.prompt.trim()) return NextResponse.json({ detail: "a lens needs a prompt: say what to look for" }, { status: 400 });
    const at = next.lenses.findIndex((l) => l.id === lens.id);
    if (at >= 0) next.lenses[at] = { ...next.lenses[at], ...lens };
    else next.lenses.push(lens);
  }
  if (body.remove) {
    const target = next.lenses.find((l) => l.id === body.remove);
    // A built-in can be switched off but never deleted: it is code, and it would reappear on the next read.
    if (target?.builtin) target.enabled = false;
    else next.lenses = next.lenses.filter((l) => l.id !== body.remove);
  }

  const saved = await scanner.saveWatchlist(next);
  return NextResponse.json({ watchlist: saved, prompt_preview: watchlistPrompt(saved) });
}
