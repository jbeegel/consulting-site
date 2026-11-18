# Meeting notes: Gregg Solomon, The Fanatic Group (18 Nov 2026)

Raw notes taken by the consultant during the in-person meeting, lightly cleaned for spelling. Photos and video of the facility were also taken and will be added separately. These are first-hand statements from the owner and should be treated as the authoritative description of the current workflow, superseding inferences in the earlier research notes.

## Systems named
- **NetSuite** is the ERP / order system of record.
- **Shopify** is the D2C storefront. **TikTok Shop** orders flow into Shopify.
- **OzLINK** (Oz Development) is the API/integration used to communicate shipping with NetSuite.
- **Dropbox** holds the art library ("a million art files").
- Multiple decoration **machines**, each requiring a different art file type (one needs Illustrator, one needs PDF, etc.).
- People: Gregg (owner, releases work orders to production), Steve (art department / pre-press queue).

## Current order-to-ship workflow as described
1. **Order entry is manual.** When someone orders from the site, the order has to be manually entered into NetSuite. Small accounts and web orders are all manually entered. Gregg explicitly wants a flow of Shopify into NetSuite, and TikTok orders (which flow into Shopify) need to flow into the system too.
2. **Every step in an order is manually approved in NetSuite.**
3. **Every sales line is a work order** that Gregg personally releases into production after approval.
4. **Art path per order:** order comes in → goes to art department in NetSuite → lands in Steve's queue → Steve does the required art → goes to licensing for approval → goes to customer for approval → once both approved, it is ready for production and follows the path.
5. **Art files:** ~1,000,000 files in Dropbox. X machines, each requires a different art file type. Artist must locate the right file and produce the right format for the machine.
6. **Shipping labels are manual.** Once all items in an order are created/built, someone manually enters the data to create the shipping label. There could be **500 shipments a day**, taking **1 to 5 minutes each**. This runs through NetSuite + OzLINK.

## The "life-changing" ask (Gregg's words, paraphrased)
Scan the piece of paper (the work order / traveler) and have the system extract the needed info to pull the correct art file itself.

## Implied quantification
- Label step alone: 500/day × 1–5 min = roughly 8 to 40 labor-hours per day at peak.
- Owner is a single point of release for every work order (every sales line), so throughput is capped by Gregg's availability.
- Web/TikTok order volume unknown; all of it is re-keyed today.

## Open questions raised by the notes
- Why are labels still manual with OzLINK in place (missing item weights/dims, no packing step, labels created in carrier software, OzLINK only writing tracking back)?
- Which NetSuite edition/modules (Manufacturing WIP & Routings? Advanced Manufacturing?), and is the approval chain a native preference or a custom SuiteFlow?
- Is there any Shopify–NetSuite connector installed and disabled, or none at all?
- How are travelers printed today (NetSuite Advanced PDF template? by hand?) and do they carry a barcode?
- Art file naming conventions and folder structure in Dropbox; which machines and which formats exactly.
