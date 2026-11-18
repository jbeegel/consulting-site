# Shop-floor photo observations (18 Nov 2026)

Eight photos taken by the consultant at The Fanatic Group's Edison NJ facility during the meeting. Photos are retained by the consultant and are not stored in this repository (they show an employee and customer order data). These are first-hand observations and supersede earlier inferences.

## 1. The NetSuite Work Order traveler (three examples photographed)

Printed one page per work order, titled "Work Order", with the Fanatic Group logo and address. Fields present on the form:

- **1D barcode at top right** with the work order number printed under it (475071 dated 10/5/2026; 472597 dated 9/21/2026). So the traveler already carries a machine-readable WO identifier.
- Customer: "11957-059 Kansas Sampler Corporate : Kansas Sampler - Store 059 - Fairview Park" and "11957-354 Kansas Sampler Corporate : Kansas Sampler - Store 273 - Gilbert Gateway". Kansas Sampler Enterprises is the parent of **Rally House**; each Rally House store is a sub-customer record. Quantity 12 EACH per work order, i.e. store-level replenishment.
- Created From: "Sales Order #EDI253161" / "#EDI251078". These B2B orders arrive via **EDI** and already create sales orders and work orders in NetSuite automatically. Manual entry is therefore for web/TikTok and small accounts, as Gregg said.
- Assembly: `KES-RH-RSST2-15` (Kent State, Rally House, 18oz soft-touch tumbler, design 15) and `AZ-RH-RSST2-15-ALUM` (Arizona, Rally House, design 15, Alumni variant). Client SKU: 12-digit UPC (703929858515, 844036096206). Sales Order Description e.g. "Arizona 18oz Soft Touch Tumbler - Navy".
- **Image Thumbnail**: a small product render is printed on the traveler.
- **Frontside File Path**: `TFG Team Folder/CUSTOM ORDERS/FANATICS/DROP SHIP/KENT STATE/RSST2/KES-FSB-PRIM-WDMK-15.eps` and `TFG Team Folder/CUSTOM ORDERS/FANATICS/DROP SHIP/ARIZONA/RSST2/ALUM/AZ-FAN-RSST2-15-ALUM.eps`. Also columns for **Backside File Name** and **Backside File Path**. So the Dropbox path of the art file is already a field on the NetSuite item/assembly and already prints on paper.
- Royalty Code (KES, ARZ), Royalty Agency ("1000007 Affinity Licensed Product", "70600 CLC College Licensing"), Needs By, Do Not Ship Til, UPC Code. Royalty attribution is already structured data in NetSuite.
- Components: `PRINTRSST` "Rubber Stainless Steel Printing" (a service/labor item) and `RSST2-NAVY` "18oz Stainless Tumbler Soft Touch Finish - Navy" qty 12; Inventory Detail `FL-WH-PROD (9160)` (bin). Assembly Required: No.
- Naming inconsistency observed: assembly KES-RH-RSST2-15 points to a file named KES-FSB-PRIM-WDMK-15.eps (FSB = frosted sport bottle naming) inside the RSST2 folder; design "15" appears to be reused across item types. The path field may therefore be stale or reused and must be validated, not trusted blindly.
- Handwritten list on the wall next to the NetSuite laptop: "GENERIC / PRICING BARCODE / ALUMNI / GRAND MA / GRAND PA / MOM / DAD" (the affinity-variant set), plus notes "PB40X" and a Spanish note about PDFs.

## 2. The print workstation

- Monitor 1 runs **ColorPRINT Server 5.0** (RIP). Job list shows queue entries such as `GS-PN102-MSN-14`, `GS-PN102-SSN-11`, `GS-FAN-PF4x6-BLACK`, `PNC-FAN-PF4x6-BLACK`, `GS-FAN-JRNPN-RED`, `TROY-FAN-JRNPN-14`, `VT-FAN-JRNPN-GRAY`, `BNC-CM102-WDMK-MSCT-13`, `ECC-CM102-DESIGN1-BLUE`, `Nest11-18_1`, `Nest11-18_2`, `CLRK-SGM16-ATH-01`. Status columns Pending/Completed, media "X-Jet S1 ink CMYKWW 1200x600", color mode SPOT_WHITE/CMYK layers. Preview pane shows Providence and Ohio State marks rendered in magenta (spot-white/preview channel).
- File naming convention inferred from the queue and Dropbox: `{SCHOOL}-{PROGRAM}-{ITEM}-{DESIGN}-{COLOR or VARIANT}` where PROGRAM is `FAN` (Fanatic stock/D2C) or `RH` (Rally House) etc., ITEM codes include RSST2 (18oz tumbler), CM102 (ceramic mug), PN102 (pen), PF4x6 (photo frame), JRNPN (journal/pen), SGM16, FSB.
- **Dropbox desktop app** is open beside the RIP: recent files `XU-FAN-CM102-GRAY.eps` (viewed 2 min ago, folder CM102), `Nest11-18_2.prt` (added 7 min ago, Documents), `TUL-FAN-CM102-GREEN.eps`, `EMU-FAN-CM102-GREEN.eps`, `CLRK-SGM16-ATH-01.prt`. Operators search Dropbox by filename from the RIP PC, open .eps masters, and the RIP saves .prt job files. "Nest" jobs combine several work orders' marks on one bed; nesting is done by hand.
- Monitor 2 runs a printer control panel ("PCS 6", "XS-3096") with Job/Calibration tabs, X/Y/Z axis offsets, media thickness, print mode "Vellum", print order "W W * K C M Y", UV lamp settings, multi-platen/vacuum. This is a UV flatbed controller.
- A paper stack of Work Orders sits on the keyboard tray; the operator holds the traveler and reads the file path off it to find the file. One visible traveler: `XU-RH-CM102-GRAY`, Ceramic Mug Gray, royalty agency "70600 CLC College Licensing".
- Wall chart maps product colors to numbers (Black, Blue, Burgundy, Gold, Green, Navy, Oak, Orange, Pink, Purple, Red, Silver, White, Gray, MVNavy, Olive, Dove, Brown, Sunglow, Oasis, Jade, Saphire, numbered 1 to 22).
- A UPS-branded mousepad on the shipping bench, consistent with UPS WorldShip on site.

## 3. Machines

- An **Inkcups X5** UV flatbed printer (green cabinet with X5 badge) is confirmed.
- A second UV machine with a generic controller (Ready, X/Y/Z, N1/N2 negative-pressure readouts, Purge/Test/Abort/Pause) sits next to a monitor showing an Auburn mark in a RIP/preview; consistent with a second Inkcups unit (likely a Helix-class rotary for tumblers, to confirm).
- Shelf of finished samples: Panthers, Alabama, Minnesota "DAD", and others.

## 4. NetSuite on the floor

- NetSuite is used in a browser on an HP laptop on a wire shelf next to the shipping area, showing a sales order list; the Fanatic logo is set as the account logo.

## Implications (consultant judgment)

1. The identification half of Gregg's "scan the paper and pull the art" ask is already solved on paper: the traveler has a barcode and prints the Dropbox path. What is missing is software that turns the scan into the file. No OCR and no AI search is needed for the common path.
2. The art index is still needed, but as validation and fallback: to catch stale/wrong paths, missing backside files, and to find candidates when the field is empty.
3. Nesting and queue building in ColorPRINT are manual and are a second automation target (group released work orders by machine, item and colorway into nest jobs).
4. EDI from Rally House is already automated; the 500-a-day label volume is store-level drop shipments of 12-unit work orders, which makes batch label generation and any Rally House ASN/label compliance the key shipping questions.
5. Royalty code and agency are already fields on items/work orders, so a royalty report can be generated from NetSuite data without new data capture.
