// Demo library: real path shapes observed on the floor, so the flow can be rehearsed without a Dropbox token.
import type { Traveler } from "./types";

export const DEMO_FILES: { path: string; size: number; modified: string }[] = [
  { path: "/TFG Team Folder/CUSTOM ORDERS/FANATICS/DROP SHIP/XAVIER UNIVERSITY/CM102/XU-FAN-CM102-GRAY.eps", size: 812_344, modified: "2022-09-14T15:02:00Z" },
  { path: "/TFG Team Folder/CUSTOM ORDERS/FANATICS/DROP SHIP/XAVIER UNIVERSITY/CM102/XU-FAN-CM102-GRAY.psd", size: 40_100_000, modified: "2022-09-14T15:01:00Z" },
  { path: "/TFG Team Folder/CUSTOM ORDERS/FANATICS/DROP SHIP/XAVIER UNIVERSITY/CM102/XU-FAN-CM102-GRAY.jpg", size: 166_700, modified: "2022-09-14T15:03:00Z" },
  { path: "/TFG Team Folder/CUSTOM ORDERS/FANATICS/DROP SHIP/XAVIER UNIVERSITY/CM102/XU-FAN-CM102-GRAY.pdf", size: 442_000, modified: "2022-09-14T15:03:30Z" },
  { path: "/TFG Team Folder/AMAZON/Dropbox Downloads/XU-FAN-CM102-GRAY.jpg", size: 345_800, modified: "2022-11-02T18:20:00Z" },
  { path: "/TFG Team Folder/CUSTOM ORDERS/FANATICS/DROP SHIP/KENT STATE/RSST2/KES-FSB-PRIM-WDMK-15.eps", size: 1_204_000, modified: "2023-02-01T12:00:00Z" },
  { path: "/TFG Team Folder/CUSTOM ORDERS/FANATICS/DROP SHIP/ARIZONA/RSST2/ALUM/AZ-FAN-RSST2-15-ALUM.eps", size: 998_000, modified: "2023-03-11T12:00:00Z" },
  { path: "/TFG Team Folder/CUSTOM ORDERS/FANATICS/DROP SHIP/ARIZONA/RSST2/AZ-FAN-RSST2-15.eps", size: 990_000, modified: "2023-03-11T11:50:00Z" },
  { path: "/TFG Team Folder/CUSTOM ORDERS/FANATICS/DROP SHIP/INDIANA/OWALA24FS/IU-FAN-OWALA24FS-PRIM.eps", size: 1_020_000, modified: "2026-09-02T14:00:00Z" },
  { path: "/TFG Team Folder/CUSTOM ORDERS/FANATICS/DROP SHIP/OHIO STATE/CM102/OSU-FAN-CM102-WDMK-13.eps", size: 1_100_000, modified: "2024-05-20T14:00:00Z" },
];

export const SAMPLE_TRAVELER: Traveler = {
  work_order_number: "475071",
  work_order_date: "2026-10-05",
  customer: "11957-059 Kansas Sampler Corporate : Kansas Sampler - Store 059 - Fairview Park",
  sales_order: "EDI253161",
  assembly: "XU-RH-CM102-GRAY",
  client_sku: "703929858515",
  description: "Xavier 11oz Ceramic Mug - Gray",
  qty_required: 12,
  frontside_file_path: "TFG Team Folder/CUSTOM ORDERS/FANATICS/DROP SHIP/XAVIER UNIVERSITY/CM102/XU-FAN-CM102-GRAY.eps",
  backside_file_name: null,
  backside_file_path: null,
  royalty_code: "XAV",
  royalty_agency: "70600 CLC College Licensing",
  needs_by: "2026-11-30",
  do_not_ship_til: "2026-11-02",
  upc: "703929858515",
  components: [
    { item: "CM102-GRAY", description: "Ceramic Mug Gray", qty: 12 },
    { item: "PRINTCM", description: "Ceramic Mug Printing", qty: 12 },
  ],
  notes: ["Sample traveler built from a photographed work order; values illustrative."],
  path_confidence: 0.97,
};
