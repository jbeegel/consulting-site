import type { ParsedCode } from "./types";

/** Item-code families seen on the floor, mapped to the press that runs them. Editable in the UI. */
export const DEFAULT_MACHINES: Record<string, string> = {
  OWALA24FS: "Nocai (rotary)",
  OWALA: "Nocai (rotary)",
  FSB: "Nocai (rotary)",
  SSB24: "Nocai (rotary)",
  RSST2: "Inkcups X5 (flatbed)",
  CM102: "Inkcups X5 (flatbed)",
  PF4X6: "Inkcups X5 (flatbed)",
  JRNPN: "Inkcups X5 (flatbed)",
  PN102: "Inkcups X5 (flatbed)",
  SGM16: "Inkcups X5 (flatbed)",
};
export const MACHINES = ["Inkcups X5 (flatbed)", "Nocai (rotary)", "SunTax rotary 1", "SunTax rotary 2"];

const PROGRAMS = new Set(["FAN", "RH", "BNC", "AMZ", "FOL"]);
const ITEMS = ["OWALA24FS", "RSST2", "CM102", "PF4X6", "JRNPN", "PN102", "SGM16", "SSB24", "FSB"];

/** Parse `KES-RH-RSST2-15` / `AZ-FAN-RSST2-15-ALUM` / `XU-FAN-CM102-GRAY.eps` into its parts. */
export function parseCode(input: string | null | undefined): ParsedCode | null {
  if (!input) return null;
  const base = input.split("/").pop()!.replace(/\.[a-z0-9]+$/i, "").toUpperCase();
  const parts = base.split("-").filter(Boolean);
  if (parts.length < 2) return null;
  const out: ParsedCode = { school: parts[0], program: null, item: null, design: null, variant: null, raw: base };
  let i = 1;
  if (PROGRAMS.has(parts[i])) { out.program = parts[i]; i++; }
  const itemIdx = parts.findIndex((p, k) => k >= i && ITEMS.includes(p));
  if (itemIdx >= 0) { out.item = parts[itemIdx]; i = itemIdx + 1; }
  const rest = parts.slice(i);
  if (rest.length) {
    if (/^\d+$/.test(rest[0])) { out.design = rest[0]; out.variant = rest.slice(1).join("-") || null; }
    else out.variant = rest.join("-");
  }
  return out;
}

/** Route by the assembly code first (what is being made), and only then by the art filename, which can carry a
 *  different item prefix when a design is reused across products (e.g. KES-FSB-… art on a KES-RH-RSST2-15 tumbler). */
export function machineFor(code: ParsedCode | null, assembly: string | null, map: Record<string, string> = DEFAULT_MACHINES): string {
  const keys = Object.keys(map).sort((a, b) => b.length - a.length); // longest code wins (OWALA24FS before OWALA)
  for (const hay of [assembly?.toUpperCase() ?? "", code?.item?.toUpperCase() ?? ""]) {
    if (!hay) continue;
    for (const k of keys) if (hay.includes(k)) return map[k];
  }
  return MACHINES[0];
}

/** Normalise a path as printed on the traveler (it wraps and letter-spaces) into a Dropbox path. */
export function normalizePath(p: string | null | undefined): string | null {
  if (!p) return null;
  let s = p.replace(/\s*\n\s*/g, "").trim();
  // The traveler column letter-spaces long folder names ("C U S T O M  O R D E R S"); collapse single-letter runs.
  s = s.replace(/\b(?:[A-Za-z] ){2,}[A-Za-z]\b/g, (m) => m.replace(/ /g, ""));
  s = s.replace(/\s{2,}/g, " ").replace(/\s*\/\s*/g, "/");
  if (!s.startsWith("/")) s = "/" + s;
  return s;
}

export function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : "";
}
export const PREFERRED_EXT = ["eps", "ai", "pdf", "svg", "psd", "tif", "tiff", "png", "jpg", "jpeg"];
