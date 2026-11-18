// Put the chosen art where the press PC will see it: /PRINT QUEUE/<date>/<machine>/WO<n>_<file>, plus a sidecar
// with the job facts (qty, assembly, customer) so the operator never re-reads the paper.
import type { StageResult, Traveler } from "./types";
import { connect, copyTo, ensureFolder, uploadText } from "./dropbox";

function slug(s: string): string { return s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, ""); }

export async function stageArt(opts: { token: string | null; artPath: string; machine: string; traveler: Partial<Traveler>; queueRoot?: string }): Promise<StageResult> {
  const day = new Date().toISOString().slice(0, 10);
  const root = (opts.queueRoot?.trim() || "/TFG Team Folder/PRINT QUEUE").replace(/\/+$/, "");
  const folder = `${root}/${day}/${slug(opts.machine)}`;
  const file = opts.artPath.split("/").pop()!;
  const wo = opts.traveler.work_order_number ? `WO${opts.traveler.work_order_number}` : "WO";
  const dest = `${folder}/${wo}_${file}`;
  const sidecarPath = `${folder}/${wo}.txt`;
  const sidecar = [
    `Work order: ${opts.traveler.work_order_number ?? "?"}`,
    `Assembly:   ${opts.traveler.assembly ?? "?"}`,
    `Qty:        ${opts.traveler.qty_required ?? "?"}`,
    `Customer:   ${opts.traveler.customer ?? "?"}`,
    `Needs by:   ${opts.traveler.needs_by ?? "?"}`,
    `Art:        ${opts.artPath}`,
    `Machine:    ${opts.machine}`,
    `Staged:     ${new Date().toISOString()}`,
  ].join("\n");
  if (!opts.token) {
    return { mode: "demo", destination: dest, sidecar: sidecarPath, machine: opts.machine, at: new Date().toISOString() };
  }
  const ctx = await connect(opts.token);
  await ensureFolder(ctx, folder);
  const destination = await copyTo(ctx, opts.artPath, dest);
  const side = await uploadText(ctx, sidecarPath, sidecar).catch(() => null);
  return { mode: "dropbox", destination, sidecar: side, machine: opts.machine, at: new Date().toISOString() };
}
