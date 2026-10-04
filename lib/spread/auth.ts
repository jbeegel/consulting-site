// Who is calling. Every /api/spread route is gated by a key in `x-spread-key`:
//   - a per-person key from spread_users (hashed; the key itself is shown once at creation), or
//   - the legacy SPREAD_PASSWORD, which counts as the owner.
// The cron route also accepts `Authorization: Bearer <CRON_SECRET>` (what Vercel Cron sends).
// With neither a password nor any user configured the API is open — fine for local dev, not for prod.
import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { config } from "./config";
import { getStore } from "./store";
import type { User } from "./types";

export const OWNER_ID = "owner";

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function newKey(prefix = "sh"): string {
  return `${prefix}_${randomBytes(18).toString("base64url")}`;
}

/** The owner pseudo-user for the shared password, so every ledger row has a person behind it. */
export function ownerUser(): User {
  return {
    id: OWNER_ID, name: "Owner", role: "owner", key_hash: "", email: config.alertEmail ?? null, share_pct: 0, daily_budget_usd: 1e9,
    bidder_numbers: [], ebay: null, active: true, created_at: 0, last_seen_at: null, last_nudged_at: null,
  };
}

/** Resolve the caller to a person, or null when the key matches nobody. */
export async function identify(req: Request): Promise<User | null> {
  const key = req.headers.get("x-spread-key");
  if (!key) return null;
  if (config.password && key === config.password) {
    // The owner's real record (eBay link, bidder numbers) lives in the users table under OWNER_ID.
    const stored = await getStore().getUser(OWNER_ID).catch(() => null);
    return stored ? { ...stored, role: "owner", active: true } : ownerUser();
  }
  const u = await getStore().userByKeyHash(hashKey(key)).catch(() => null);
  return u && u.active ? u : null;
}

export async function authorized(req: Request, { cron = false } = {}): Promise<boolean> {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (config.cronSecret && bearer === config.cronSecret) return true;
  if (await identify(req)) return true;
  return !config.password && !(cron && config.cronSecret);
}

/** The person behind the request when the API is open (no password configured): the owner. */
export async function caller(req: Request): Promise<User | null> {
  const u = await identify(req);
  if (u) return u;
  return !config.password ? ownerUser() : null;
}

/** Everything about a person except what would let someone impersonate them. */
export function publicUser(u: User) {
  const { key_hash: _k, ebay, ...rest } = u;
  void _k;
  return { ...rest, ebay_linked: !!ebay, ebay_linked_at: ebay?.linked_at ?? null };
}

export function deny(): NextResponse {
  return NextResponse.json({ error: "unauthorized: set the Spread Hunter password" }, { status: 401 });
}

export function forbid(): NextResponse {
  return NextResponse.json({ error: "owner only" }, { status: 403 });
}
