// Art Pull — scan a NetSuite work-order traveler, find the art in Dropbox, stage it for the press.

export type Traveler = {
  work_order_number: string | null;
  work_order_date: string | null;
  customer: string | null;
  sales_order: string | null;
  assembly: string | null;
  client_sku: string | null;
  description: string | null;
  qty_required: number | null;
  frontside_file_path: string | null;
  backside_file_name: string | null;
  backside_file_path: string | null;
  royalty_code: string | null;
  royalty_agency: string | null;
  needs_by: string | null;
  do_not_ship_til: string | null;
  upc: string | null;
  components: { item: string; description: string | null; qty: number | null }[];
  /** Anything the reader was unsure about, in plain words. */
  notes: string[];
  /** 0..1, the reader's own confidence that the file path was transcribed exactly. */
  path_confidence: number;
};

export type ArtFile = {
  path: string; // Dropbox path_display
  name: string;
  size: number | null;
  modified: string | null; // ISO
  ext: string;
  /** Why this candidate ranks where it does. */
  reasons: string[];
  score: number;
  exact: boolean;
};

export type Sibling = { path: string; name: string; ext: string; size: number | null; previewUrl?: string | null };

export type ResolveResult = {
  mode: "dropbox" | "demo";
  query: string;
  primary: ArtFile | null;
  candidates: ArtFile[];
  siblings: Sibling[];
  preview: { kind: "image" | "pdf" | "none"; url: string | null; from: string | null };
  parsed: ParsedCode | null;
  machine: string;
  warnings: string[];
};

export type ParsedCode = {
  school: string | null;
  program: string | null;
  item: string | null;
  design: string | null;
  variant: string | null;
  raw: string;
};

export type StageResult = {
  mode: "dropbox" | "demo";
  destination: string;
  sidecar: string | null;
  machine: string;
  at: string;
};
