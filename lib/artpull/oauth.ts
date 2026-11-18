// Durable Dropbox connection: OAuth with offline access gives a refresh token that does not expire. We keep it in an
// encrypted, httpOnly cookie on the browser that connected (press PC, Gregg's phone), and mint short-lived access
// tokens from it on demand. Needs DROPBOX_APP_KEY and DROPBOX_APP_SECRET; without them the paste-a-token path is used.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const COOKIE = "artpull_dbx";
const STATE_COOKIE = "artpull_dbx_state";

export function oauthConfigured(): boolean {
  return Boolean(process.env.DROPBOX_APP_KEY && process.env.DROPBOX_APP_SECRET);
}

function key(): Buffer {
  return createHash("sha256").update(`artpull:${process.env.DROPBOX_APP_SECRET ?? ""}`).digest();
}
export function seal(text: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64url");
}
export function open(blob: string): string | null {
  try {
    const b = Buffer.from(blob, "base64url");
    const d = createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
  } catch { return null; }
}

export function redirectUri(req: Request): string {
  const u = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? u.host;
  return `${proto}://${host}/api/artpull/dropbox/callback`;
}

export function authorizeUrl(req: Request, state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.DROPBOX_APP_KEY!,
    response_type: "code",
    token_access_type: "offline",
    redirect_uri: redirectUri(req),
    state,
  });
  return `https://www.dropbox.com/oauth2/authorize?${p}`;
}

export { STATE_COOKIE };

export async function exchangeCode(req: Request, code: string): Promise<{ refresh_token: string; access_token: string; expires_in: number; account_id?: string }> {
  const body = new URLSearchParams({ code, grant_type: "authorization_code", redirect_uri: redirectUri(req), client_id: process.env.DROPBOX_APP_KEY!, client_secret: process.env.DROPBOX_APP_SECRET! });
  const r = await fetch("https://api.dropboxapi.com/oauth2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!r.ok) throw new Error(`Dropbox token exchange ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()) as { refresh_token: string; access_token: string; expires_in: number; account_id?: string };
}

// Access tokens minted from a refresh token are cached in memory per instance; a cold start just mints again.
const cache = new Map<string, { token: string; exp: number }>();
export async function accessFromRefresh(refresh: string): Promise<string> {
  const hit = cache.get(refresh);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh, client_id: process.env.DROPBOX_APP_KEY!, client_secret: process.env.DROPBOX_APP_SECRET! });
  const r = await fetch("https://api.dropboxapi.com/oauth2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!r.ok) throw new Error(`Dropbox refresh ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { access_token: string; expires_in: number };
  cache.set(refresh, { token: j.access_token, exp: Date.now() + j.expires_in * 1000 });
  return j.access_token;
}

export function cookieValue(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

/** The refresh token stored for this browser, if it connected through OAuth. */
export function refreshFromCookie(req: Request): string | null {
  const c = cookieValue(req, COOKIE);
  return c ? open(c) : null;
}
