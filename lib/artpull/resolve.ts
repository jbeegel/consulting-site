// Find the right art file for a traveler: exact path first, then filename search, then parsed-code search.
import type { ArtFile, ResolveResult, Sibling, Traveler } from "./types";
import { DEMO_FILES } from "./demo";
import { extOf, machineFor, normalizePath, parseCode, PREFERRED_EXT } from "./parse";
import { connect, getMetadata, listFolder, search, temporaryLink, type DbxCtx, type DbxEntry } from "./dropbox";

function toArt(e: { path: string; name: string; size: number | null; modified: string | null }, wanted: { path: string | null; base: string | null; school: string | null }): ArtFile {
  const reasons: string[] = [];
  let score = 0;
  const ext = extOf(e.name);
  const lowerPath = e.path.toLowerCase();
  const exact = !!wanted.path && lowerPath === wanted.path.toLowerCase();
  if (exact) { score += 100; reasons.push("Exact path from the traveler"); }
  if (wanted.base && e.name.toLowerCase().replace(/\.[a-z0-9]+$/, "") === wanted.base.toLowerCase()) { score += 40; reasons.push("Same file name"); }
  const pe = PREFERRED_EXT.indexOf(ext);
  if (pe >= 0) { score += 20 - pe * 2; if (pe <= 1) reasons.push("Vector master"); }
  if (lowerPath.includes("/custom orders/")) { score += 10; reasons.push("In CUSTOM ORDERS"); }
  if (lowerPath.includes("/amazon/") || lowerPath.includes("/downloads/")) { score -= 25; reasons.push("Copy in AMAZON / Downloads"); }
  if (wanted.school && lowerPath.includes(`/${wanted.school.toLowerCase()}`)) { score += 5; }
  return { path: e.path, name: e.name, size: e.size, modified: e.modified, ext, reasons, score, exact };
}

function fromEntry(e: DbxEntry) {
  return { path: e.path_display ?? e.path_lower ?? e.name, name: e.name, size: e.size ?? null, modified: e.server_modified ?? null };
}

export async function resolveArt(traveler: Partial<Traveler>, token: string | null, machineMap?: Record<string, string>): Promise<ResolveResult> {
  const warnings: string[] = [];
  const path = normalizePath(traveler.frontside_file_path);
  const base = path ? path.split("/").pop()!.replace(/\.[a-z0-9]+$/i, "") : null;
  const parsed = parseCode(base ?? traveler.assembly ?? null);
  const machine = machineFor(parsed, traveler.assembly ?? null, machineMap);
  const query = base ?? traveler.assembly ?? "";
  const wanted = { path, base, school: null as string | null };
  if (path) {
    const parts = path.split("/");
    wanted.school = parts.length >= 3 ? parts[parts.length - 3] : null; // .../SCHOOL/ITEM/file
  }

  let candidates: ArtFile[] = [];
  let siblings: Sibling[] = [];
  let preview: ResolveResult["preview"] = { kind: "none", url: null, from: null };

  if (!token) {
    const hits = DEMO_FILES.filter((f) => (path && f.path.toLowerCase() === path.toLowerCase()) || (base && f.path.toLowerCase().includes(base.toLowerCase())) || (parsed?.school && parsed.item && f.path.toUpperCase().includes(`${parsed.school}-`) && f.path.toUpperCase().includes(parsed.item)));
    candidates = hits.map((f) => toArt({ path: f.path, name: f.path.split("/").pop()!, size: f.size, modified: f.modified }, wanted));
    if (!candidates.length) warnings.push("Demo mode: nothing in the sample library matches. Connect Dropbox to search the real art folders.");
    else warnings.push("Demo mode: results come from a built-in sample library, not Dropbox.");
  } else {
    let ctx: DbxCtx;
    try { ctx = await connect(token); } catch (e) { throw new Error(String(e instanceof Error ? e.message : e)); }
    const seen = new Map<string, ArtFile>();
    const add = (e: DbxEntry) => { const a = toArt(fromEntry(e), wanted); seen.set(a.path.toLowerCase(), a); };
    if (path) {
      const m = await getMetadata(ctx, path);
      if (m && m[".tag"] === "file") add(m);
      else warnings.push("The exact path printed on the traveler was not found in Dropbox; showing the closest matches.");
    }
    if (base) (await search(ctx, base)).forEach(add);
    if (seen.size === 0 && parsed?.school && parsed.item) {
      const q = [parsed.school, parsed.item, parsed.design].filter(Boolean).join(" ");
      (await search(ctx, q)).forEach(add);
      if (seen.size) warnings.push(`No file named ${base ?? traveler.assembly}; these match the parsed code (${q}).`);
    }
    candidates = [...seen.values()];
    // Siblings of the best hit (same stem, other formats) give us a preview and show duplicates.
    const best = candidates.sort((a, b) => b.score - a.score)[0];
    if (best) {
      const folder = best.path.slice(0, best.path.lastIndexOf("/"));
      const stem = best.name.replace(/\.[a-z0-9]+$/i, "").toLowerCase();
      const entries = await listFolder(ctx, folder).catch(() => [] as DbxEntry[]);
      siblings = entries.filter((e) => e.name.toLowerCase().replace(/\.[a-z0-9]+$/, "") === stem).map((e) => ({ path: e.path_display ?? e.name, name: e.name, ext: extOf(e.name), size: e.size ?? null }));
      const img = siblings.find((s) => ["jpg", "jpeg", "png", "gif", "webp"].includes(s.ext));
      const pdf = siblings.find((s) => s.ext === "pdf");
      if (img) { const url = await temporaryLink(ctx, img.path); if (url) preview = { kind: "image", url, from: img.name }; }
      else if (pdf) { const url = await temporaryLink(ctx, pdf.path); if (url) preview = { kind: "pdf", url, from: pdf.name }; }
    }
    if (!candidates.length) warnings.push("Nothing found in Dropbox for this traveler. Check the path field or search manually.");
  }

  candidates.sort((a, b) => b.score - a.score);
  const primary = candidates[0] ?? null;
  if (primary && !primary.exact && path) warnings.push("Best match is not the exact printed path. Confirm before sending to press.");
  return { mode: token ? "dropbox" : "demo", query, primary, candidates, siblings, preview, parsed, machine, warnings };
}
