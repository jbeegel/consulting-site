// Read a photographed/scanned NetSuite Work Order traveler into structured fields with Claude vision.
// Uses structured outputs (output_config.format); forced tool_choice is not supported on current models.
import Anthropic from "@anthropic-ai/sdk";
import type { Traveler } from "./types";

const MODEL = process.env.ARTPULL_MODEL || "claude-opus-5-5";

export function extractorConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const SYSTEM = `You read printed "Work Order" travelers from The Fanatic Group's NetSuite account (Edison, NJ).
Layout: header "Work Order" with a 1D barcode and the work order number under it, top right. Below: Customer, Assembly,
Customer Item No., Qty Required, Units, Client SKU. Then Created From (Sales Order #...), Sales Order Description,
Image Thumbnail, Frontside File Path, Backside File Name, Backside File Path. Then Royalty Code, Royalty Agency,
Needs By, Do Not Ship Till, UPC Code. Then component lines (Quantity Remaining / Item / Inventory Detail).

Rules:
- Transcribe the file paths EXACTLY, character for character, including case, hyphens, spaces inside folder names and
  the file extension. The path column is narrow: the text wraps across lines and long folder names are printed with
  letter-spacing (e.g. "C U S T O M  O R D E R S" means "CUSTOM ORDERS"). Rejoin wrapped lines with no added characters
  and collapse letter-spaced words. Folder separators are "/".
- Work order number is the digits printed under the barcode (6 digits), not the sales order number.
- Dates as YYYY-MM-DD. Quantities as integers (null if unreadable). Unknown or unreadable text fields are an empty
  string ""; never guess a path.
- Put anything you are unsure about in notes, and set path_confidence between 0 and 1 for the frontside path.
Return only the JSON object.`;

// Structured outputs allow at most 16 union-typed (nullable) fields, so text fields are plain strings
// ("" when unreadable) and only the two quantities are nullable. Empty strings become null below.
const str = { type: "string" };
const nullableInt = { type: ["integer", "null"] };

const STRING_FIELDS = [
  "work_order_number", "work_order_date", "customer", "sales_order", "assembly", "client_sku", "description",
  "frontside_file_path", "backside_file_name", "backside_file_path", "royalty_code", "royalty_agency",
  "needs_by", "do_not_ship_til", "upc",
] as const;

const SCHEMA = {
  type: "object",
  properties: {
    ...Object.fromEntries(STRING_FIELDS.map((k) => [k, str])),
    qty_required: nullableInt,
    components: {
      type: "array",
      items: {
        type: "object",
        properties: { item: str, description: str, qty: nullableInt },
        required: ["item", "description", "qty"],
        additionalProperties: false,
      },
    },
    notes: { type: "array", items: str },
    path_confidence: { type: "number" },
  },
  required: [...STRING_FIELDS, "qty_required", "components", "notes", "path_confidence"],
  additionalProperties: false,
};

export async function extractTraveler(imageBase64: string, mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"): Promise<{ traveler: Traveler; usage: { input: number; output: number }; model: string }> {
  const client = new Anthropic({ timeout: 90_000, maxRetries: 1 });
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
        { type: "text", text: "Read this traveler and return the JSON." },
      ],
    }],
  });
  if (res.stop_reason === "refusal") throw new Error("The reader declined this image. Try a clearer photo of just the paper.");
  const text = res.content.filter((b) => b.type === "text").map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  if (!text) throw new Error("The reader returned nothing. Try again with a sharper photo.");
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(text) as Record<string, unknown>; }
  catch { throw new Error("The reader's answer was not valid JSON. Try again."); }
  for (const k of STRING_FIELDS) { const v = raw[k]; raw[k] = typeof v === "string" && v.trim() ? v.trim() : null; }
  if (Array.isArray(raw.components)) {
    raw.components = (raw.components as { item: string; description?: string; qty?: number | null }[])
      .filter((c) => c && typeof c.item === "string" && c.item.trim())
      .map((c) => ({ item: c.item.trim(), description: c.description && c.description.trim() ? c.description.trim() : null, qty: typeof c.qty === "number" ? c.qty : null }));
  }
  const t = raw as unknown as Traveler;
  t.components ??= [];
  t.notes ??= [];
  t.path_confidence = typeof t.path_confidence === "number" ? t.path_confidence : 0.5;
  return { traveler: t, usage: { input: res.usage.input_tokens, output: res.usage.output_tokens }, model: MODEL };
}
