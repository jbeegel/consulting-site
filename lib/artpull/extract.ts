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
- Dates as YYYY-MM-DD. Quantities as integers. Unknown or unreadable fields are null; never guess a path.
- Put anything you are unsure about in notes, and set path_confidence between 0 and 1 for the frontside path.
Return only the JSON object.`;

const nullableString = { type: ["string", "null"] };
const nullableInt = { type: ["integer", "null"] };

const SCHEMA = {
  type: "object",
  properties: {
    work_order_number: nullableString,
    work_order_date: nullableString,
    customer: nullableString,
    sales_order: nullableString,
    assembly: nullableString,
    client_sku: nullableString,
    description: nullableString,
    qty_required: nullableInt,
    frontside_file_path: nullableString,
    backside_file_name: nullableString,
    backside_file_path: nullableString,
    royalty_code: nullableString,
    royalty_agency: nullableString,
    needs_by: nullableString,
    do_not_ship_til: nullableString,
    upc: nullableString,
    components: {
      type: "array",
      items: {
        type: "object",
        properties: { item: { type: "string" }, description: nullableString, qty: nullableInt },
        required: ["item", "description", "qty"],
        additionalProperties: false,
      },
    },
    notes: { type: "array", items: { type: "string" } },
    path_confidence: { type: "number" },
  },
  required: [
    "work_order_number", "work_order_date", "customer", "sales_order", "assembly", "client_sku", "description",
    "qty_required", "frontside_file_path", "backside_file_name", "backside_file_path", "royalty_code", "royalty_agency",
    "needs_by", "do_not_ship_til", "upc", "components", "notes", "path_confidence",
  ],
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
  let t: Traveler;
  try { t = JSON.parse(text) as Traveler; }
  catch { throw new Error("The reader's answer was not valid JSON. Try again."); }
  t.components ??= [];
  t.notes ??= [];
  t.path_confidence = typeof t.path_confidence === "number" ? t.path_confidence : 0.5;
  return { traveler: t, usage: { input: res.usage.input_tokens, output: res.usage.output_tokens }, model: MODEL };
}
