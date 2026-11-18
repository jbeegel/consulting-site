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

---

# Video observations (two of four clips reviewed, 18 Nov 2026)

Clips IMG_6590.MOV (74 s, press workstation) and IMG_6596.MOV (60 s, shipping bench) were reviewed frame by frame (one frame every three seconds plus full-resolution stills of key screens). IMG_6587.MOV and IMG_6593.MOV could not be retrieved yet. Audio transcripts are in the final section of this file.

## Clip 1: press workstation (IMG_6590)

- The operator picks up the next paper Work Order from the stack (`XU-RH-CM102-GRAY`, Xavier ceramic mug for Rally House, royalty agency CLC), reads the Frontside File Path, and types the filename into the Dropbox desktop app's search box on the RIP PC (search string visible: `xu-fan-cm102-gray.eps`).
- Dropbox returns the match; the operator opens it and a red Xavier "X" vector mark with a TM appears full-screen in a viewer, then is placed into the ColorPRINT Server job. The RIP preview shows other marks (Providence, Ohio State) already nested in magenta on the bed layout; the printer-control panel on the same monitor shows the platen grid with multiple positions.
- Sequence per work order observed: paper → read path → Dropbox search → open → add to nest/job → print. Roughly 30 to 60 seconds of screen work per traveler before any printing, all of it lookup and placement.
- Inkcups ink cartridges and sample tumblers under the cart; the color-to-number wall chart and a taped SOP sheet beside the monitor.

## Clip 2: shipping bench (IMG_6596)

- Hardware: an ASUS monitor and Dell PC, two corded handheld barcode scanners on stands, a Zebra industrial thermal label printer, a stack of printed packing slips, a small LCD readout (likely a bench scale display) at the far left, label rolls. A second monitor runs UPS WorldShip.
- NetSuite shows **Item Fulfillment 320023** for customer **13942 Von Maur** (Von Maur Distribution Center, 6565 N Brady Street, Davenport IA 52806), status PICKED, created from Sales Order #276531, with customer comments "A/P 563-388-3888 ext 2276 / SEE AC FOR ROUTING INSTRUCTIONS / Mail invoices". Lines: `IU-OWALA24FS-VERY VERY DARK` qty 3 and `IU-OWALA24FS-SKY MARSHMALLOW` qty 12 (Indiana University Owala FreeSip 24 oz), Location **Florida Warehouse**. Von Maur is a department-store chain, so retail accounts beyond campus stores and Rally House exist, and a retailer routing guide applies.
- Item Fulfillment subtabs visible: Items, Shipping, Packages, Relationships, Communication, System Information, Custom, **OzLINK**, **TrueCommerce**, Package Contents. TrueCommerce is therefore the EDI provider integrated into NetSuite.
- The **OzLINK Package Content Verification** window on the fulfillment shows the exact manual steps: UPC/Item No field with Add button (items were added via a "Manual Item Selection" dialog: Item Number, Order Quantity 3, Add To Box 3), Box Number 1 Open/Close, Box Type blank, Box Dimensions typed L 18 W 12 H 13, **Item Weight 0.00**, **Scale Weight 0.0**, **Scale Enabled unchecked**, Dunnage Weight blank, then a **Manual Weight Entry** dialog where the operator types Box Weight 17, Pack Remaining, Keep Box Open checked, Done.
- UPS WorldShip then opens ("Active Pickup Date: Wednesday, 18-Nov-2026") with the Ship To (Von Maur Distribution Center, Davenport IA 52806), Shipper TFG, UPS Ground, weight 17, reference fields, ready for Process Shipment. This is the documented OzLINK loop: NetSuite fulfillment → OzLINK pack → carrier software → tracking written back.
- NetSuite home dashboard on the same PC shows a saved report "Orders shipped today (dash report)" with TOTAL 2 at mid-morning (Sales Orders #277874 and #277884 dated 11/18/2026, entered by a sales rep "Brian Ma…"), plus shortcuts "Print Packing Slips" and "Fulfill Orders". Browser tabs include a shared `shipping@thefanaticgroup` mailbox.
- A printed packing slip with barcode and "Do Not Ship Till 10/22/2026" is handled alongside.

## Implications (consultant judgment)

1. **Why labels take 1 to 5 minutes is now specific**: item records carry no weight (Item Weight 0.00), no box type defaults exist, the scale is not enabled in OzLINK, items are added to the box by hand rather than scanned, box dimensions and weight are typed, and the shipment is then finished in WorldShip. Each of those is a configuration fix before any software is written: populate item weights and dimensions, define box types with tare weights, enable the USB scale in OzLINK, default a box type per assembly family (e.g. 12 × RSST2 = box type A), and let scan-to-verify replace manual item selection.
2. For single-line, fixed-quantity cartons (the Rally House 12-pack pattern) the entire pack step is deterministic and can be pre-filled or skipped by rule, leaving only label print.
3. **TrueCommerce** handles EDI for Rally House and Von Maur, so 856 ASNs and GS1-128 labels, if required by those retailers, likely already flow through it. Confirm what TrueCommerce generates today and whether OzLINK or WorldShip produces the retailer carton label.
4. **"Florida Warehouse"** as the fulfillment Location, combined with the `FL-WH-PROD` bin on travelers and the Deerfield Beach FL address in D&B, needs a direct question: is there a second physical site, or a legacy location name used for Edison inventory? It affects any inventory sync to Shopify.
5. The art-lookup clip confirms the staging design: the search string the operator types is exactly the filename in the Frontside File Path field, so a script can do the same lookup and place the file in a queue folder before the operator reaches the press.

---

# Video observations, clips 3 and 4 (IMG_6587, 35 s; IMG_6593, 33 s)

## Clip 3: press workstation, continued (IMG_6587)

- Same operator and traveler stack at the ColorPRINT/PCS workstation; the RIP preview shows a row of nested marks ready to print.
- Inbound master cartons on the floor beside the press carry supplier labels: "PO NO. 1002385 / ITEM & COLOR: CM102-GRAY / QTY: 24 PCS / G.W. 14.8 KGS / N.W. 13.2 KGS / MEASUREMENT: 45.2x30.7x35.6 CM" (and a second CM102 carton, PO 1002387). Blanks arrive in 24-unit master cartons with a PO number and item code printed on the box, so receiving against NetSuite purchase orders can be scan-based, and carton gross weights and dimensions exist on the box even though item weights are zero in NetSuite.
- Closing frames show the Inkcups flatbed bed under UV light with a cylindrical fixture holding a tumbler, i.e. rotary printing on the flatbed.

## Clip 4: production room walk-through (IMG_6593)

- The **Inkcups X5** flatbed is loaded with a jig of roughly 28 dark-green tumblers in rows, which confirms high-count ganging per bed cycle and explains the hand-built "Nest" jobs in the RIP. The machine sits on a wooden crate base on a dolly.
- Wire shelving along the wall holds blank inventory; stacked Fanatic Group shipping cartons; a blue bin; Gregg (black cap) walking the room.
- A **Nocai** UV printer (white cabinet, "Nocai" badge) with an operator seated in front of it, feeding **black Owala FreeSip bottles**. Open Owala master cartons with cell dividers sit beside it, labelled "24-OZ OWALA FREESIP / STAINLESS STEEL / COLOR: BLACK (VERY VERY DARK)" with carton barcodes. Two dozen printed black bottles stand lined up on the table.
- A large dark-grey industrial UV printer with an "ARTECH"-style nameplate (first letter stylised; exact brand to confirm) with a touchscreen, its own PC and monitor, more Owala cartons in front of it, and an employee in a Fanatic Group shirt at its station. A monitor on the right shows the machine's own job software.
- The press room therefore contains at least three UV printer brands (Inkcups X5 with ColorPRINT, Nocai, and the ARTECH-badged unit), each with its own RIP and input expectations. This is the concrete basis for Gregg's "each machine needs a different file type".
- Owala bottles are in active production, so the Owala line is already running on the Nocai and ARTECH machines rather than the Inkcups.

## Implications (consultant judgment)

1. The conversion matrix in the debrief should be rebuilt around these three RIPs rather than the generic laser and sublimation rows. Discovery item: for each machine, the RIP name and version, accepted input formats, hot-folder or job-ticket support, and whether the Owala cylinder templates are stored per machine.
2. Routing work orders to machines is itself a rule the staging job can apply: item family (RSST2, CM102, OWALA24FS, PF4x6, JRNPN) maps to a machine and jig, which determines the output format and the nest group.
3. The X5 jig count (about 28 positions) is the nesting unit; a nest builder that fills a jig from released work orders of the same blank and colorway is a direct throughput gain.
4. Supplier cartons carry PO number, item code, quantity and weights; scanning them at receiving can post NetSuite item receipts and populate the missing item weights and dimensions that the shipping step needs.

---

# Second pass: frame-by-frame review of all four clips at full resolution

Every frame (one per second, 202 frames) was extracted and the screen regions enlarged. Audio could not be transcribed in this environment. Details below are additive to the sections above.

## Press workstation (clips IMG_6590 and IMG_6587)

**The art lookup has more steps than first described.** The sequence actually observed:
1. Operator reads the filename from the traveler and types `xu-fan-cm102-gray.eps` into the Dropbox desktop search.
2. Dropbox returns **six matches for the same design**: `XU-FAN-CM102-GRAY.eps` (edited 4 years ago by Steven Cipparulo, in `TFG Team Folder/CUSTOM ORDERS/FANATICS/...`), a `.psd` of 40.1 MB, two `.jpg` renders, a `.pdf`, and another `.jpg` in `TFG Team Folder/AMAZON/Dropbox Downloads/...` edited by Alexandria Matthews. The operator picks the .eps.
3. Right-click → Open. The .eps opens in a **Chrome browser tab** as a preview (red Xavier X with TM, zoom 237%).
4. Chrome's Downloads popup appears (`XU-FAN-CM102-GRAY...`): the file is **downloaded to the local Downloads folder**.
5. In ColorPRINT Server, File → Open, navigate the Windows file dialog to Downloads, select the file.
6. The job layout shows a **jig template of empty placeholder rectangles** (rows of cells); the operator drops the mark into a cell. Other jobs ("Nest" files) combine several marks on one template.
7. Job list columns: Name, Status (Pending / Completed), Job Size, Copies, Color Mode (SPOT), Output Profile "X-Jet S1 ink CMYKWW 1200x600". The PCS 6 printer control panel on the same screen shows X/Y/Z axis offsets, "Use Independent Origin", and print settings.

Implications: the same design exists in multiple formats and folders already (eps, psd, jpg, pdf, plus an Amazon copy), so deduplication and a "which file is the master" rule matter as much as retrieval; the art files are mature (edited ~4 years ago); and the download-to-Downloads step means the RIP PC accumulates loose copies with no link back to the work order.

**Dropbox also holds royalty spreadsheets**: a search result shows `YALE Q2.xlsx` in `TFG Team Folder/Royalties/Q2`, so quarterly royalty reports are built per school in Excel and stored in Dropbox.

**Room details**: a wall-mounted security camera; a metal rack of printing jigs/fixture trays behind the operator; the Nocai machine (white, "Nocai" badge, green status light) directly behind the ColorPRINT station with its own keyboard and a UPS mousepad; a second operator working at the Nocai; blue nitrile gloves; a taped "POLICIES" sheet beside the color chart with rules about empty boxes, the prep area, not opening boxes without a knife, and keeping areas clean. The color chart (Color / # / Component) maps 22 colors: Black, Blue, Burgundy, Gold, Green, Navy, Oak, Orange, Pink, Purple, Red, Silver, White, Gray, MVNavy, Olive, Dove, Brown, Sunglow, Oasis, Jade, Saphire.

## Shipping bench (clip IMG_6596)

**Three shipping tools are in play, not one.** Browser tabs and bookmarks on the shipping PC: "Item Fulfillment - NetSuite", "**ShipRush Web Shipping**" (plus a ShipRush bookmark), "Inbox - shipping@thefanaticgr…" (shared Gmail), "Pi-hole raspberrypi", "Paychex Flex", "Sales Order #274353", "Fulfill Orders", OzLINK and "Pack" bookmarks, and UPS / USPS / FedEx icons. UPS WorldShip is the desktop app that OzLINK hands off to. ShipRush (also a Descartes product) appears to be used for some shipments, probably USPS/FedEx or parcels that WorldShip does not cover. Discovery item: which shipments go through ShipRush versus WorldShip, and why.

**Amazon is an active channel in NetSuite.** The dashboard's customer list shows `100226 AMAZON PARENT` and `100316 AMAZON PARENT`, so Amazon orders land in NetSuite under parent customer records (likely one per marketplace/account), separate from Shopify.

**Retail-compliance fields already exist on the fulfillment form.** The custom Item Fulfillment form carries a `UCC_LABEL` checkbox and a `PARTY CITY DEPT NAME` field, so GS1-128/UCC carton labels and department-store routing (Party City is or was a customer) have been handled before. Item lines carry `ROYALTY PERCENTAGE` and `ROYALTY CODE` columns, and `ON HAND` quantities by location. All lines show Location = "Florida Warehouse".

**The packing slip is printed with a Florida address.** Header: "301 Goolsby Blvd, Deerfield Beach FL 33442, P (732) 512-1544"; the return-address block repeats Deerfield Beach. Order # 276531, PO # 493421, Terms Net 30, Ship Via "See Admin", Ship ASAP (NOW): No, "Do Not Ship Till 10/22/2026", a barcode of the order number, and a Customer Return Form stub. Combined with the "Florida Warehouse" location and the `FL-WH-PROD` bin on travelers, the Florida address is embedded in NetSuite's company/location setup, whether or not goods physically ship from Florida. This must be asked directly.

**The OzLINK pack step, field by field.** Package Content Verification window: UPC/Item No (blank, with Add), Serial Number, Box Number 1 (Close/Open), Box Type (blank dropdown), Box Dimensions typed L 18 W 12 H 13, Item Weight 0.00, Scale Weight 0.0, Scale Enabled unchecked, Dunnage Weight blank. Items were added through "Manual Item Selection" (Item Number, Description, Order Quantity 3, Add To Box 3, OK), repeated for the 12-unit line. Then "Manual Weight Entry: Box Weight 17". Box Content Detail then lists Box 1: 12 SKY MARSHMALLOW, 3 VERY VERY DARK. OzLINK writes this to NetSuite's **Packages** subtab (Box 1, 17.0 lbs, Package Contents Description "IU-OWALA24FS-VERY VERY DARK (3) IU-OWALA24FS-SKY MARSHMALLOW (12)").

**UPS WorldShip then opens pre-filled**: Shipper account 4V819R, profile TFG; Ship To "Store 0017", Von Maur Distribution Center, 6565 N Brady Street, Davenport IA 52806; UPS Ground; Package 18 x 12 x 13 in; Weight 17 lb; Reference Number 1 = 276531 (the NetSuite order number), Reference Number 2 = 493421 (the customer PO); "Electronic Scale Activated" unchecked; Shipper's Cost Published $36.65, Negotiated $13.50; Pkg 1 of 1; "Process Shipment F10". So OzLINK does populate address, service, dims, weight and references into WorldShip; the human work is upstream in the pack dialog and in pressing Process Shipment.

**Hardware on the bench**: two Zebra desktop thermal label printers side by side (one with a handwritten sticky "271405290" on the monitor, likely a tracking or account number), two corded handheld scanners on stands, a bench scale whose display read "0.35" (connected to the PC but not enabled in OzLINK), thermal label rolls, a stack of packing slips, NetSuite shortcuts "Print Packing Slips" and "Fulfill Orders", and the "Orders shipped today" dashboard report showing TOTAL: 2 at about 10:30 AM, both created from sales orders entered by sales rep "Brian Ma…".

## Production room (clip IMG_6593)

No additional detail beyond the earlier section: Inkcups X5 with ~28-position jig of green tumblers, the Nocai printing black Owala FreeSip bottles from divided master cartons, and the large dark UV printer with an "ARTECH"-style nameplate, PC and touchscreen, with Owala cartons staged in front of it.

## Added implications (consultant judgment)

1. **Art finder must dedupe and pick a master.** Six files per design across CUSTOM ORDERS and AMAZON folders means the index needs a canonical-master rule (prefer .eps/.ai in the item's path; treat .psd/.jpg/.pdf as derivatives) and should surface all variants with their last-edited date and editor.
2. **Eliminate the browser-download hop.** Today's path copies the file into Downloads with no tie to the work order. The staging job should write files into a per-machine queue folder named by work order and ColorPRINT should open from there (or via hot folder if supported).
3. **Shipping stack rationalisation is a bigger question than OzLINK alone**: WorldShip, OzLINK and ShipRush coexist, UPS negotiated rates are already loaded, and a scale is present but disabled. The cheapest first step is still: item weights/dims, box types, enable the scale, scan-to-verify.
4. **Amazon is live in NetSuite** and should be included in the channel map and in any Shopify-to-NetSuite connector decision (Celigo and Pipe17 both cover Amazon as well as Shopify and TikTok Shop).
5. **GS1/UCC labels have been done before** (UCC_LABEL flag, Party City field), so retailer compliance for Rally House and Von Maur is likely configured in TrueCommerce already; confirm rather than rebuild.
6. **Royalty reporting is spreadsheet-per-school in Dropbox** (`Royalties/Q2/YALE Q2.xlsx`), even though royalty code and percentage are on every NetSuite line. This is a clean target for a SuiteQL report that generates each school's quarterly file.
7. **The Florida address question is now more pointed**: it appears on customer-facing packing slips and in NetSuite's location and bin names, not just in directories.

---

# Audio transcripts (Whisper small/medium, 18 Nov 2026 clips)

Machine transcription of the phone audio. Gregg narrates clips 1, 3 and 4; clip 2 is mostly the consultant and operator. Low-confidence segments are marked. Timestamps in seconds.

## IMG_6587 (press cart, 35 s) — Gregg walking the Dropbox folder tree
- 0–16: "Team folder. Custom orders. Fanatics. Dropship. Xavier. The item. And then here's the print files."
- 18–20: "He does every single… every [expletive] work order."
- 23–29: "And then he's gotta put in the quantity and put in the right template. Like that really probably can't change." (the consultant: "So you gotta try this part.")

Reading: Gregg is reciting the exact Dropbox path hierarchy that prints on the traveler (Team Folder → CUSTOM ORDERS → FANATICS → DROP SHIP → school → item → print files) and confirming the operator repeats the lookup for every work order; after the file is found, the operator still enters quantity and selects the jig template in the RIP.

## IMG_6590 (press workstation, 74 s) — operator and consultant on the ideal flow
- 14–17 (operator): "Yeah, we have to save it and then load it, now?"
- 18–23 (operator): "Yes, but if it was able to be scanned, it would always be in the downloads folder."
- 24–29: "It would pull it up right there. So somehow it could automatically…"
- 54–57: "So you can scan it, it would download it and then load it."
- 57–64 (operator): "I don't know if you're going to be able to integrate it to load directly in here, maybe you can. But this program is a little bit on the older side, so to speak."
- 64–73: "This program being ColorPRINT… Server 5.0, okay. And some of them are different versions, like this one's 5.1."

Reading: the operator independently describes the target design (scan traveler → file appears → load into RIP) and flags that ColorPRINT Server is old and that the shop runs mixed versions (5.0 and 5.1) across machines. Whether ColorPRINT can be driven by hot folder or job ticket is the open question.

## IMG_6593 (production room, 33 s) — Gregg on the machine fleet
- 0–6: "[Nocai]… the company's called Nocai, that's from China. This is gonna be our, like, going-forward machine."
- 6–14: "And then we have two of these machines over here called SunTax [as heard; nameplate reads "…ARTECH"], which are our original rotary set."
- 15–23: "We have them, we're going to use them, but when we add more they're going to be the Nocais."
- 24–28 (consultant): "So basically [Helix/X5, unclear] and Nocai, it sounds like."
- 29–30 (Gregg): "They all require different art [file types]."

Reading: the fleet is the Inkcups X5 flatbed, two original rotary UV printers of a brand heard as "SunTax" (spelling to confirm; the nameplate begins with a stylised letter and ends in "ARTECH"), and the Nocai, which is the standard for future purchases. The conversion matrix therefore needs three RIP targets today and should treat Nocai's input format as the long-term default.

## IMG_6596 (shipping bench, 60 s) — Gregg narrating the label process
- 0–10: "Here's the packing slip. Up here is the OzLINK connector, okay, and they scan it… for the load."
- 13–17: "Okay, so we're gonna pack it, and…"
- 19–26: "Let's just say this is a box that's 18 by 12 by 13. It fits all of these units."
- 27–29: "Then I got to put in the weight."
- 29–38: "Hit OK, hit Done… and then, let's just say this is going UPS. Yes, click UPS. Yes."
- 41–48: "And then process label, and then the labels spit out, and then they'll go find the box and they'll ship it out."
- 48–52: "Now this could happen over 500 times in a day."

Reading: Gregg's own description matches the screen capture step for step: scan packing slip → OzLINK pack dialog → type box dims → type weight → OK → Done → choose carrier → WorldShip Process Shipment → label prints → find box → ship. He puts the volume at "over 500 times in a day".
