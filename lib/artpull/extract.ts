// Read a photographed/scanned NetSuite Work Order traveler into structured fields with Claude vision.
import Anthropic from "@anthropic-ai/sdk";
import type { Traveler } from "./types";

const MODEL = process.env.ARTPULL_MODEL || "claude-sonnet-5-5";

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
- Put anything you are unsure about in notes, and set path_confidence between 0 and 1 for the frontside path.`;

const TOOL = {
  name: "traveler",
  description: "The structured content of one work-order traveler.",
  input_schema: {
    type: "object" as const,
    properties: {
      work_order_number: { type: ["string", "null"] },
      work_order_date: { type: ["string", "null"] },
      customer: { type: ["string", "null"] },
      sales_order: { type: ["string", "null"] },
      assembly: { type: ["string", "null"] },
      client_sku: { type: ["string", "null"] },
      description: { type: ["string", "null"] },
      qty_required: { type: ["integer", "null"] },
      frontside_file_path: { type: ["string", "null"] },
      backside_file_name: { type: ["string", "null"] },
      backside_file_path: { type: ["string", "null"] },
      royalty_code: { type: ["string", "null"] },
      royalty_agency: { type: ["string", "null"] },
      needs_by: { type: ["string", "null"] },
      do_not_ship_til: { type: ["string", "null"] },
      upc: { type: ["string", "null"] },
      components: {
        type: "array",
        items: { type: "object", properties: { item: { type: "string" }, description: { type: ["string", "null"] }, qty: { type: ["integer", "null"] } }, required: ["item"] },
      },
      notes: { type: "array", items: { type: "string" } },
      path_confidence: { type: "number" },
    },
    required: ["work_order_number", "assembly", "frontside_file_path", "components", "notes", "path_confidence"],
  },
};

export async function extractTraveler(imageBase64: string, mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"): Promise<{ traveler: Traveler; usage: { input: number; output: number }; model: string }> {
  const client = new Anthropic({ timeout: 90_000, maxRetries: 1 });
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: "tool", name: "traveler" },
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
        { type: "text", text: "Read this traveler." },
      ],
    }],
  });
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("No structured result from the reader");
  const t = block.input as Traveler;
  t.components ??= [];
  t.notes ??= [];
  t.path_confidence = typeof t.path_confidence === "number" ? t.path_confidence : 0.5;
  return { traveler: t, usage: { input: res.usage.input_tokens, output: res.usage.output_tokens }, model: MODEL };
}
