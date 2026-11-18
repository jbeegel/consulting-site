// Minimal Dropbox v2 client. Token comes from the request header (pasted in the UI) or DROPBOX_ACCESS_TOKEN.
// Team spaces: paths like "/TFG Team Folder/..." live under the team root, so we set Dropbox-API-Path-Root.

import { accessFromRefresh, oauthConfigured, refreshFromCookie } from "./oauth";

export type DbxCtx = { token: string; pathRoot: string | null; account: string | null; team: boolean };

type Entry = { ".tag": "file" | "folder" | "deleted"; name: string; path_display?: string; path_lower?: string; size?: number; server_modified?: string; id?: string };

const API = "https://api.dropboxapi.com/2";
const CONTENT = "https://content.dropboxapi.com/2";

/** Resolve a Dropbox access token for this request: pasted header, then env, then the OAuth refresh-token cookie. */
export async function tokenFrom(req: Request): Promise<string | null> {
  const h = req.headers.get("x-dropbox-token");
  if (h && h.trim()) return h.trim();
  const e = process.env.DROPBOX_ACCESS_TOKEN;
  if (e && e.trim()) return e.trim();
  if (oauthConfigured()) {
    const refresh = refreshFromCookie(req);
    if (refresh) return accessFromRefresh(refresh);
  }
  return null;
}

async function rpc<T>(ctx: DbxCtx, path: string, body: unknown): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${ctx.token}`, "Content-Type": "application/json" };
  if (ctx.pathRoot) headers["Dropbox-API-Path-Root"] = ctx.pathRoot;
  const r = await fetch(`${API}/${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`Dropbox ${path} ${r.status}: ${text.slice(0, 300)}`);
  return text ? (JSON.parse(text) as T) : ({} as T);
}

/** Resolve the account and, for Dropbox Business team spaces, the root namespace to address team folders. */
export async function connect(token: string): Promise<DbxCtx> {
  const ctx: DbxCtx = { token, pathRoot: null, account: null, team: false };
  const r = await fetch(`${API}/users/get_current_account`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Dropbox token rejected (${r.status}): ${(await r.text()).slice(0, 200)}`);
  const acct = (await r.json()) as { name?: { display_name?: string }; email?: string; root_info?: { ".tag": string; root_namespace_id?: string } };
  ctx.account = acct.name?.display_name ?? acct.email ?? "connected";
  if (acct.root_info?.[".tag"] === "team" && acct.root_info.root_namespace_id) {
    ctx.team = true;
    ctx.pathRoot = JSON.stringify({ ".tag": "root", root: acct.root_info.root_namespace_id });
  }
  return ctx;
}

export async function getMetadata(ctx: DbxCtx, path: string): Promise<Entry | null> {
  try { return await rpc<Entry>(ctx, "files/get_metadata", { path }); }
  catch (e) { if (String(e).includes("not_found")) return null; throw e; }
}

export async function search(ctx: DbxCtx, query: string, pathPrefix?: string, max = 25): Promise<Entry[]> {
  const options: Record<string, unknown> = { max_results: max, file_status: "active", filename_only: true };
  if (pathPrefix) options.path = pathPrefix;
  const r = await rpc<{ matches: { metadata: { metadata: Entry } }[] }>(ctx, "files/search_v2", { query, options });
  return (r.matches ?? []).map((m) => m.metadata.metadata).filter((e) => e[".tag"] === "file");
}

export async function listFolder(ctx: DbxCtx, folder: string): Promise<Entry[]> {
  const r = await rpc<{ entries: Entry[] }>(ctx, "files/list_folder", { path: folder, limit: 200 });
  return (r.entries ?? []).filter((e) => e[".tag"] === "file");
}

export async function temporaryLink(ctx: DbxCtx, path: string): Promise<string | null> {
  try { const r = await rpc<{ link: string }>(ctx, "files/get_temporary_link", { path }); return r.link; }
  catch { return null; }
}

export async function ensureFolder(ctx: DbxCtx, path: string): Promise<void> {
  try { await rpc(ctx, "files/create_folder_v2", { path, autorename: false }); }
  catch (e) { if (!String(e).includes("conflict")) throw e; }
}

export async function copyTo(ctx: DbxCtx, from: string, to: string): Promise<string> {
  const r = await rpc<{ metadata: Entry }>(ctx, "files/copy_v2", { from_path: from, to_path: to, autorename: true });
  return r.metadata.path_display ?? to;
}

export async function uploadBytes(ctx: DbxCtx, path: string, body: Uint8Array | string): Promise<string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${ctx.token}`,
    "Content-Type": "application/octet-stream",
    "Dropbox-API-Arg": JSON.stringify({ path, mode: "overwrite", mute: true }),
  };
  if (ctx.pathRoot) headers["Dropbox-API-Path-Root"] = ctx.pathRoot;
  const r = await fetch(`${CONTENT}/files/upload`, { method: "POST", headers, body: body as BodyInit });
  if (!r.ok) throw new Error(`Dropbox upload ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const m = (await r.json()) as Entry;
  return m.path_display ?? path;
}

export async function uploadText(ctx: DbxCtx, path: string, text: string): Promise<string> {
  return uploadBytes(ctx, path, text);
}

export type { Entry as DbxEntry };
