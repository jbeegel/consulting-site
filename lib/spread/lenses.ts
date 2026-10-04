// Lenses — the things YOU have noticed, made permanent.
//
// Every reseller accumulates private pattern knowledge that no general appraiser has: "anything marked
// Occupied Japan moves", "bank giveaways always sell", "the sign guys pay silly money". That knowledge
// is worth more than any model's priors because it came from your own sell-through, and until now it
// lived in your head and got applied only when you happened to remember it.
//
// A LENS is one such observation, written once and then applied to every single lot forever. It does
// three jobs, and the middle one is the important one:
//
//   1. It raises triage priority for lots whose words hint at the pattern.
//   2. It tells the APPRAISER what to look for in the photographs — this is where the value is, because
//      a lens fires on things the title never mentions. "Made in Occupied Japan" is stamped on the
//      BOTTOM of the figurine; no auctioneer types that, and no keyword search finds it. The only way
//      to catch it is to have told the model to turn the thing over and read the base.
//   3. It contributes search terms to hunt mode.
//
// Built-in lenses ship switched off except the ones the user named, and CUSTOM INSTRUCTIONS are free
// text appended verbatim — the escape hatch for a hunch that has not yet earned a toggle.
import type { Lens, Lot, Watchlist } from "./types";
import { normalizeText } from "./playbook";

const phraseIn = (hay: string, phrase: string): boolean => {
  const words = normalizeText(phrase).trim().split(" ").filter(Boolean);
  return words.length > 0 && words.every((w) => hay.includes(` ${w} `));
};

/**
 * The starter set. Each `prompt` is the payload: a specific, physical instruction about what to look at,
 * not a category name. "Check ceramics" is useless; "turn it over and read the backstamp, and treat
 * 'Made in Occupied Japan' as a hard 1945-1952 date" is actionable.
 */
export const BUILTIN_LENSES: Omit<Lens, "enabled">[] = [
  {
    id: "hunting-grounds",
    name: "Hunting grounds",
    hint: "The advertising-and-smalls families where the spread lives, and the rule for when one is actionable",
    builtin: true,
    keywords: [
      "advertising", "thermometer", "bank", "still bank", "banthrico", "oil can", "oiler", "grease", "texaco", "shell", "gulf", "sinclair",
      "mobil", "esso", "sunoco", "pennzoil", "quaker state", "brewery", "beer", "hamm's", "schlitz", "pabst", "coca cola", "coke", "pepsi",
      "hires", "orange crush", "nugrape", "rc cola", "dr pepper", "7up", "moxie", "nehi", "mascot", "reddy kilowatt", "mr peanut", "planters",
      "lighter", "scripto", "zippo", "decanter", "jim beam", "ezra brooks", "wild turkey", "postal", "post office", "mailbox", "emblem",
      "hood ornament", "script", "badge", "champion", "spark plug", "autolite", "ac delco", "clock", "pam clock", "paperweight", "letter opener",
      "blotter", "pocket mirror", "singer", "sewing", "tin", "tobacco tin", "coffee tin", "spice tin", "pharmacy", "drug store", "ex-lax",
      "rinconada", "hagen renaker", "beswick", "goebel", "josef originals", "lefton", "napco", "fenton", "mosser", "boyd", "viking", "blenko",
      "uranium", "carnival glass", "west german", "studio pottery", "diner", "hotel", "motel", "railroad", "john deere", "international harvester",
      "ski-doo", "arctic cat", "polaris", "johnson", "evinrude", "mercury outboard", "padlock", "salesman sample", "neon", "lighted sign",
      "motion sign", "promo car", "amt", "dealer", "dealership", "token", "watch fob", "key fob", "keychain", "matchbook", "door push", "push plate",
      "display", "counter display", "sealed", "nos", "florida", "miami", "boca", "delray", "citrus", "airline", "pan am", "eastern airlines",
      "cruise", "world's fair", "cereal premium", "chalkware", "lucite", "tire gauge", "goodyear", "firestone", "michelin", "kodak", "rca", "zenith",
      "bell system", "western electric", "ibm", "caterpillar", "mack", "kenworth", "peterbilt", "ice cream", "dairy", "gumball", "vending",
    ],
    queries: [
      "misc advertising", "advertising lot", "oil cans", "old tins", "desk items", "dresser items", "small metal items", "old store items",
      "assorted advertising", "garage collectibles", "contents of shelf", "contents of cabinet", "advertising thermometer", "still bank lot",
      "beer sign", "soda sign", "gas station", "service station", "mascot figure", "decanter lot", "emblems lot", "spark plug display",
      "advertising clock", "salesman sample", "hotel ashtray", "railroad lot", "florida advertising",
    ],
    prompt:
      "HUNTING GROUNDS. The families below are where undervalued lots recur: a recognisable niche with recent sold "
      + "activity, a poor auction description, a low opening price, and an easy, searchable resale. Treat them as "
      + "places to LOOK, not as targets in themselves: an item in one of these families becomes actionable only "
      + "when recent SOLD evidence supports the demand and the acquisition price leaves a large spread. "
      + "Prioritise exact-match sold comps, repeated transactions, compact and shippable pieces, under-described "
      + "lots, and mixed lots that decompose into several individually searchable items. Penalise large or "
      + "fragile objects, uncertain reproductions, condition problems, high shipping, and any value resting on "
      + "asking prices.\n"
      + "The strongest families, in order: (1) advertising and promotional BANKS — Banthrico, local bank and "
      + "insurance giveaways, building-shaped, calendar, mascot, cast-metal, ceramic, and banks built around a real "
      + "post-office box door; (2) advertising THERMOMETERS — bottle-shaped soda (NuGrape, Hires, Orange Crush, "
      + "Sun Crest, RC/Royal Crown, Canada Dry), porcelain automotive and oil (Prestone, Quaker State), pharmacy "
      + "(Ex-Lax), beer, feed and farm; exact size, working tube, porcelain vs tin, embossing and original paint "
      + "decide the price, and sizes sell 5-10x apart; (3) PETROLIANA — oil cans, handy oilers, long-spout cans, "
      + "quart and pint cans, grease tins, snowmobile, outboard and 2-cycle oil, household and sewing-machine oilers "
      + "(Singer, 3-In-One), pump plates, glass oil bottles, branded spouts and funnels, service-station desk items; "
      + "Texaco, Shell, Gulf, Quaker State, Pennzoil, Esso, Standard, D-X, Sunoco, Mobil, Union 76, Kendall, "
      + "Valvoline, Castrol, Bardahl, John Deere, Sears/Allstate; (4) BREWERIANA — Hamm's Bear material above all "
      + "(early ceramic and Red Wing variants, working motion signs), brewery banks and mascots, motion and lighted "
      + "signs, tap knobs, trays, chalkware, regional breweries; (5) SODA — thermometers, trays, clocks, bottle and "
      + "tin signs, push bars, menu boards, carriers, banks, mascots, regional bottlers; (6) advertising MASCOTS and "
      + "character figures — Reddy Kilowatt, Hamm's Bear, Mr. Peanut/Planters, oil, tire, gas, soda, insurance and "
      + "utility mascots in vinyl, ceramic, rubber, chalkware or translucent plastic; (7) POSTAL — post-office box "
      + "doors and door banks, railway mail, postal scales and locks, often buried in 'metal box' lots; (8) small "
      + "AUTOMOTIVE advertising — emblems, scripts, hood ornaments, dealer badges, spark-plug displays (oversized "
      + "Champion, AC, Autolite), PAM and other advertising clocks, dealership promos, AMT promo cars, tire and "
      + "battery brands; (9) branded DESK and office smalls — paperweights, perpetual calendars, letter openers, "
      + "blotters, pen stands, lighters (Scripto VU, Zippo advertising), ashtrays only with a strong brand; "
      + "(10) LOCAL-BUSINESS advertising, strongest when the business is gone, the town is named, and the object "
      + "is displayable — and for South Florida specifically: Miami hotels, Boca/Delray businesses, old Florida "
      + "banks, airlines, citrus, tourism, motels, race tracks, cruise lines, defunct retailers.\n"
      + "Also worth a close look: liquor decanters and tax-stamp bottles (Ezra Brooks, Wild Turkey/Austin Nichols, "
      + "racing and wildlife themes); tins with strong graphics and obsolete brands; pharmacy and patent-medicine "
      + "advertising; food, coffee and tea brands; identifiable ceramic animals (Rinconada, Hagen-Renaker, Beswick, "
      + "Royal Doulton, Goebel, Josef Originals, Lefton, Napco, Freeman-McFarlin); art-glass smalls (Fenton, Mosser, "
      + "Boyd, Viking, Blenko, uranium and carnival glass); signed studio, West German and Japanese pottery smalls; "
      + "diner, hotel, motel, airline, cruise-line and railroad objects; farm, snowmobile, marine and fishing "
      + "advertising; locks and salesman samples; motion and illuminated advertising (working examples step up "
      + "sharply); sealed or unopened old product; tokens, watch fobs, key fobs and advertising pocket knives in "
      + "junk-drawer lots; promotional models and cereal premiums.\n"
      + "When a vague mixed lot contains three or more of the above, treat it as a decomposition opportunity and "
      + "inventory it piece by piece.",
  },
  {
    id: "occupied-japan",
    name: "Occupied Japan",
    hint: "Marks dating a piece to 1945–1952 exactly",
    builtin: true,
    keywords: ["occupied japan", "japan", "made in japan", "nippon", "figurine", "porcelain", "bisque", "toby", "lusterware"],
    queries: ["occupied japan", "made in occupied japan figurine"],
    prompt:
      "OCCUPIED JAPAN: on any ceramic, porcelain, bisque, metal or celluloid piece, look at the BASE and the "
      + "back. Read the country mark exactly and quote it. \"Made in Occupied Japan\" or \"Occupied Japan\" was "
      + "legally required only between 1945 and 1952, so the mark is a hard seven-year date stamp and a "
      + "collector category in its own right — it reliably outsells the same object marked only \"Japan\". "
      + "Distinguish carefully: plain \"Japan\" (pre-1921 or post-1952), \"Nippon\" (pre-1921), \"Made in Japan\" "
      + "(broad). Note whether the mark is stamped, incised, or a paper label (labels are often lost, so an "
      + "intact one adds value). Figurines, toby jugs, salt and pepper sets, lustreware tea sets, celluloid "
      + "toys and small metal novelties are the common forms.",
  },
  {
    id: "bank-objects",
    name: "Bank & financial objects",
    hint: "Anything a bank printed its name on",
    builtin: true,
    keywords: ["bank", "savings", "trust company", "national bank", "building and loan", "still bank", "coin bank", "passbook", "teller"],
    queries: ["bank advertising", "still bank", "savings bank premium"],
    prompt:
      "BANK OBJECTS: read any imprint naming a bank, trust company, building-and-loan or insurance agency, "
      + "and quote the institution and its TOWN AND STATE — the town is most of the value, because the buyer "
      + "is usually a local-history collector, and a defunct small-town bank beats a surviving national one. "
      + "Forms to watch for: cast-iron and pot-metal still banks, coin registers, passbooks, calendars, "
      + "blotters, thermometers, rulers, letter openers, pocket mirrors, paperweights, advertising mirrors. "
      + "Date it where you can: no \"Member FDIC\" suggests pre-1933; a two or three digit phone exchange is "
      + "pre-war. Flag reproduction cast-iron banks — check casting seams and whether paint wear sits where "
      + "handling would actually put it.",
  },
  {
    id: "advertising-signs",
    name: "Vintage advertising signs",
    hint: "Porcelain, tin and painted signage",
    builtin: true,
    keywords: ["sign", "tin sign", "porcelain sign", "advertising", "gas", "oil", "soda", "beer", "feed", "seed", "dealer"],
    queries: ["porcelain advertising sign", "vintage tin advertising sign", "antique advertising sign"],
    prompt:
      "ADVERTISING SIGNS: identify the brand, the substrate (porcelain enamel, embossed tin, lithographed "
      + "tin, cardboard, neon, painted wood) and the maker's mark along the bottom edge, and quote any date "
      + "code. Porcelain outperforms tin; embossed outperforms flat; grommets, shelf brackets and die-cut "
      + "shapes all add. Gas and oil, soda, beer, feed and seed, and farm-implement dealer signs lead the "
      + "market. REPRODUCTIONS DOMINATE THIS CATEGORY — treat as suspect any sign with uniform gloss, no "
      + "edge chipping, artificially even \"rust\", modern screen-print dot patterns, or wording like "
      + "\"vintage style\". Say plainly when a photo cannot settle authenticity, and lower confidence when so.",
  },
  {
    id: "marks-and-backstamps",
    name: "Marks & backstamps",
    hint: "Turn everything over and read the bottom",
    builtin: true,
    keywords: ["pottery", "porcelain", "china", "vase", "figurine", "crock", "stoneware", "art glass"],
    queries: [],
    prompt:
      "MARKS: for every ceramic, glass or metal object, explicitly look for and transcribe the mark on the "
      + "base — maker, pattern name or number, country of origin, and any date or factory code. Quote the "
      + "mark verbatim rather than summarising it, and say so when the base is not photographed, because an "
      + "unphotographed base is the single most common reason a valuable piece gets sold as junk. Names worth "
      + "flagging on sight: Roseville, Weller, Rookwood, McCoy, Hull, Van Briggle, Fulper, Newcomb, Grueby, "
      + "Wedgwood, Moorcroft, Royal Doulton, Meissen, KPM, Limoges, Nippon, Satsuma, Fenton, Northwood, "
      + "Steuben, Loetz, Tiffany, Quezal, Durand.",
  },
  {
    id: "silver-marks",
    name: "Silver & gold marks",
    hint: "Sterling, coin silver, karat marks",
    builtin: true,
    keywords: ["silver", "sterling", "silverplate", "flatware", "gold", "karat", "jewelry", "ring", "chain"],
    queries: ["sterling silver lot", "coin silver antique"],
    prompt:
      "PRECIOUS METAL MARKS: inspect every metal item for \"STERLING\", \".925\", \"COIN\", \"900\", a lion "
      + "passant or other hallmark, or karat marks (10K, 14K, 18K, 585, 750). Distinguish solid silver from "
      + "PLATE — \"EPNS\", \"quadruple plate\", \"silver on copper\" and \"A1\" all mean plate, which is worth "
      + "a small fraction. For solid silver, estimate weight from the form and note that scrap value sets a "
      + "hard floor under the piece regardless of style. Say when the mark is illegible or absent from the "
      + "photos rather than assuming either way.",
  },
  {
    id: "early-plastics",
    name: "Bakelite & celluloid",
    hint: "Early plastics that collectors chase",
    builtin: true,
    keywords: ["bakelite", "catalin", "celluloid", "lucite", "bangle", "poker chips", "napkin ring", "flatware handle"],
    queries: ["bakelite lot", "celluloid antique lot"],
    prompt:
      "EARLY PLASTICS: look for Bakelite and Catalin (dense, warm to the touch, colours gone butterscotch or "
      + "deep amber with age, seams absent, no mould lines) and celluloid (thin, light, often ivory-imitating "
      + "grain). Bangles, dress clips, poker chips, napkin rings, flatware handles, radio cases, buttons and "
      + "pipe stems are the usual forms; carved or laminated pieces sell for multiples of plain ones. Note "
      + "that the hot-water and Simichrome tests cannot be done from a photo, so flag what would need "
      + "confirming in hand and keep confidence honest.",
  },
  {
    id: "railroadiana",
    name: "Railroadiana & industrial",
    hint: "Line-marked hardware and lanterns",
    builtin: true,
    keywords: ["railroad", "railway", "lantern", "switch key", "adlake", "handlan", "dressel", "caboose", "telegraph"],
    queries: ["railroad lantern", "railroad switch key", "railroadiana lot"],
    prompt:
      "RAILROADIANA: read any cast or stamped railroad initials (PRR, NYC, B&O, ATSF, GTW, PM…) and the "
      + "maker (Adlake, Handlan, Dressel, Armspear). Marked hardware sells to collectors of that specific "
      + "road; unmarked hardware is just hardware. Lanterns: note the globe colour, whether the globe is "
      + "marked, and whether frame and globe match. Short-line and defunct roads beat the big systems. "
      + "Reproduction keys and re-stamped marks exist — say when a photo cannot settle it.",
  },
  {
    id: "mcm-labels",
    name: "Mid-century furniture labels",
    hint: "The paper label under the seat",
    builtin: true,
    keywords: ["chair", "table", "credenza", "lamp", "teak", "walnut", "danish", "mid century", "modern"],
    queries: ["danish modern", "mid century modern lot"],
    prompt:
      "MID-CENTURY LABELS: check the underside of any furniture, lamp or small case piece for a paper label, "
      + "branded stamp or metal tag. Herman Miller, Knoll, Eames, Dunbar, Heywood-Wakefield, Lane Acclaim, "
      + "Broyhill Brasilia, Danish Control (\"Made in Denmark\"), and any \"designed by\" attribution move the "
      + "price by an order of magnitude versus a lookalike. Note wood (teak, rosewood, walnut) and whether "
      + "veneer is intact. Say explicitly when the underside is not photographed.",
  },
  {
    id: "militaria-marks",
    name: "Militaria with unit marks",
    hint: "Maker, date and unit stamps",
    builtin: true,
    keywords: ["military", "army", "navy", "usmc", "wwii", "ww2", "wwi", "medal", "insignia", "helmet", "canteen", "bayonet"],
    queries: ["wwii militaria lot", "military insignia lot"],
    prompt:
      "MILITARIA MARKS: transcribe maker stamps, dates, contract numbers, unit designations and inspector "
      + "marks — a dated, maker-marked, unit-marked piece is worth many times an unmarked equivalent. Note "
      + "theatre and period. Named groupings (items traceable to one soldier) carry a large premium. Flag "
      + "reproduction risk on anything German-marked, and be plain about the fact that photos rarely settle "
      + "authenticity in this category.",
  },
  {
    id: "native-southwest",
    name: "Native American & Southwest",
    hint: "Hallmarks, weave, and legal cautions",
    builtin: true,
    keywords: ["navajo", "zuni", "hopi", "pueblo", "turquoise", "squash blossom", "kachina", "basket", "rug", "pottery"],
    queries: ["navajo jewelry lot", "native american pottery"],
    prompt:
      "NATIVE AMERICAN & SOUTHWEST: look for artist hallmarks or signatures on silver and pottery, and note "
      + "construction — hand-stamped versus cast, natural versus stabilised or block turquoise, coil-built "
      + "versus slip-cast pottery, and weave count on textiles. Attribute to a named maker or pueblo only "
      + "with visible evidence. Note that the Indian Arts and Crafts Act restricts how such items may be "
      + "described and sold, so recommend cautious, evidence-only wording in any listing.",
  },
];

export function defaultWatchlist(now = Date.now() / 1000): Watchlist {
  // The three the user named start on; the rest are there to switch on when they become relevant.
  const ON = new Set(["hunting-grounds", "occupied-japan", "bank-objects", "advertising-signs"]);
  return {
    lenses: BUILTIN_LENSES.map((l) => ({ ...l, enabled: ON.has(l.id) })),
    custom_instructions: "",
    updated_at: now,
  };
}

/** Merge stored state over the built-ins, so new built-in lenses appear without wiping user edits. */
export function mergeWatchlist(stored: Partial<Watchlist> | null, now = Date.now() / 1000): Watchlist {
  const base = defaultWatchlist(now);
  if (!stored) return base;
  const byId = new Map((stored.lenses ?? []).map((l) => [l.id, l]));
  const merged: Lens[] = base.lenses.map((b) => {
    const s = byId.get(b.id);
    // Built-in text is code, not data: always take the current prompt, keep only the user's toggle.
    return s ? { ...b, enabled: s.enabled !== false } : b;
  });
  // Anything the user added by hand that is not a built-in.
  for (const s of stored.lenses ?? []) {
    if (!merged.some((m) => m.id === s.id)) {
      merged.push({
        id: s.id, name: s.name ?? s.id, hint: s.hint ?? "", builtin: false,
        keywords: s.keywords ?? [], queries: s.queries ?? [], prompt: s.prompt ?? "",
        enabled: s.enabled !== false,
      });
    }
  }
  return {
    lenses: merged,
    custom_instructions: (stored.custom_instructions ?? "").slice(0, 4000),
    updated_at: stored.updated_at ?? now,
  };
}

export const enabledLenses = (w: Watchlist): Lens[] => w.lenses.filter((l) => l.enabled && l.prompt.trim());

/**
 * The block appended to every appraisal prompt. This is what makes a lens fire on things the title
 * never mentions: the model is told to turn objects over and read bases whether or not anything in the
 * listing suggested it should.
 */
export function watchlistPrompt(w: Watchlist | null): string {
  if (!w) return "";
  const on = enabledLenses(w);
  const custom = (w.custom_instructions ?? "").trim();
  if (!on.length && !custom) return "";

  const parts = [
    "WHAT THIS BUYER IS HUNTING. Apply all of the following to every lot, whether or not the title or "
    + "description mentions them — these patterns are precisely the ones auctioneers miss, so they will "
    + "almost never be named in the listing. If one applies, say so explicitly in `value_drivers` and let "
    + "it inform the estimate and the listing title.",
  ];
  for (const l of on) parts.push(`- ${l.prompt}`);
  if (custom) {
    parts.push("BUYER'S OWN STANDING INSTRUCTIONS (their words, from their own sales experience — weigh "
      + "these heavily, they come from someone watching their own sell-through):\n" + custom);
  }
  return parts.join("\n");
}

/** Which lenses a lot's WORDS hint at. Photos can fire a lens the words never suggested; this is only triage. */
export function matchedLenses(lot: Lot, w: Watchlist | null): Lens[] {
  if (!w) return [];
  const hay = normalizeText(`${lot.title ?? ""} ${lot.description ?? ""} ${lot.category_path ?? ""}`);
  return enabledLenses(w).filter((l) => (l.keywords ?? []).some((k) => phraseIn(hay, k)));
}

/** Triage weight from lens keyword hits, capped so one lens cannot dominate the queue. */
export function lensBoost(lot: Lot, w: Watchlist | null, weight = 1): number {
  const hits = matchedLenses(lot, w).length;
  return hits ? Math.min(2, 0.8 * hits) * weight : 0;
}

/** Search terms contributed by enabled lenses, for hunt mode. */
export function lensQueries(w: Watchlist | null): string[] {
  if (!w) return [];
  return [...new Set(enabledLenses(w).flatMap((l) => l.queries ?? []))];
}
