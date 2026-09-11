// The starter playbook.
//
// These are hunting instructions, not market data. Every seed ships with queries, the words that mean
// "wrong thing", and what to look for in a photo — and with its price and volume fields deliberately
// EMPTY. Numbers here would be numbers I made up, and a fabricated median is worse than no median: it
// would produce a confident max_bid with nothing behind it. The discovery pass (discovery.ts) fills
// them from real eBay sold data on first run, and `researched_at` stays null until it does.
//
// The weighting is deliberate. Small printed-and-stamped advertising — the letter opener that cost $1
// and sold for $30 in three hours — has the profile that makes this whole tool work: it is worthless to
// the auctioneer (it goes in a box lot), specific enough that a collector searches for it by name,
// cheap to ship, hard to fake, and impossible to confuse with anything else once you can read the
// imprint. Bank and insurance giveaways are the densest seam of it, because every small-town bank in
// America spent a century printing its name on things and giving them away.
import type { Thesis } from "./types";

type Seed = Omit<Partial<Thesis>, "name"> & { name: string };

export const SEED_THESES: Seed[] = [
  // ---------------------------------------------------------------- advertising ephemera
  {
    name: "Advertising letter openers",
    family: "Advertising ephemera",
    queries: ["antique advertising letter opener", "vintage advertising letter opener metal", "bank advertising letter opener"],
    must_any: ["letter opener", "letter openers", "envelope opener"],
    negative: ["sterling", "reproduction", "replica", "modern", "resin", "plastic handle set"],
    ship_cost: 5,
    ebay_category: "Collectibles > Advertising",
    rationale:
      "Pre-1940 businesses handed these out by the thousand: banks, insurance agents, hardware stores, "
      + "feed mills, funeral homes. They survive because they are metal and sit in a drawer. Auctioneers "
      + "dump them in smalls boxes at a dollar; collectors of a specific town, trade or company search for "
      + "them by the imprint. Flat, light, nearly unbreakable, so shipping is a stamp and a rigid mailer.",
    tells: [
      "Read the imprint: company, town and state are the whole value — a named small town beats a generic slogan",
      "Celluloid or enamel handles beat plain stamped steel",
      "Figural handles (animals, tools, mascots, the product itself) sell for multiples of a plain blade",
      "Pre-1930 typography, a patent date, or a phone exchange of 2-3 digits all date it early",
      "Auto, oil, brewery, firearms and undertaker imprints have their own collector bases",
    ],
    risks: ["Common brass blanks with no imprint are worth little", "Bends and deep pitting kill it", "Later reproductions exist for famous brands"],
    origin: "seed",
    confidence: 0.5,
  },
  {
    name: "Bank advertising giveaways",
    family: "Bank & financial memorabilia",
    queries: ["antique bank advertising giveaway", "vintage bank advertising premium", "savings bank advertising item"],
    must_any: ["bank advertising", "savings bank", "trust company", "national bank", "state bank", "building and loan"],
    negative: ["piggy bank modern", "reproduction", "bank of america card", "power bank", "blood bank", "food bank", "bank statement"],
    ship_cost: 6,
    ebay_category: "Collectibles > Advertising",
    rationale:
      "Every small-town bank printed its name on something and gave it away: still banks, calendars, "
      + "blotters, thermometers, rulers, letter openers, pocket mirrors, paperweights. Local historical "
      + "interest plus advertising collectors plus the specific sub-collectors of whatever the object is. "
      + "Cheap in estate boxes because the bank is long gone and the object looks like junk.",
    tells: [
      "The bank's town and state, and whether the bank still exists — defunct small-town banks are more collectable, not less",
      "A charter number or 'Member FDIC' absence suggests pre-1933",
      "Still banks (non-mechanical coin banks) in cast iron or pot metal carry their own collector market",
      "Anything with a date, a calendar or a celluloid surface dates itself",
    ],
    risks: ["Cast-iron still bank reproductions are everywhere — check casting seams and paint wear", "Common 1970s-80s giveaways are worth little"],
    origin: "seed",
    confidence: 0.45,
  },
  {
    name: "Celluloid advertising pocket mirrors",
    family: "Advertising ephemera",
    queries: ["antique celluloid advertising pocket mirror", "vintage advertising pocket mirror celluloid"],
    must_any: ["pocket mirror", "celluloid mirror", "advertising mirror"],
    negative: ["compact modern", "reproduction", "repro", "hand mirror vanity"],
    ship_cost: 5,
    ebay_category: "Collectibles > Advertising",
    rationale:
      "1900-1920 celluloid pocket mirrors are small, colourful, dated by their graphics and heavily "
      + "collected. They routinely hide in jewellery-box and smalls lots.",
    tells: ["Sharp lithography and no celluloid cracking", "Maker's mark on the rim (Whitehead & Hoag, Bastian Bros, Parisian Novelty)", "Pretty-girl, brewery, tobacco and auto subjects lead"],
    risks: ["Reproductions are common and usually feel too light and too glossy", "Celluloid shrinkage cracks are terminal"],
    origin: "seed",
    confidence: 0.45,
  },
  {
    name: "Advertising thermometers and rulers",
    family: "Advertising ephemera",
    queries: ["vintage advertising thermometer metal", "antique advertising wooden ruler", "advertising yardstick vintage"],
    must_any: ["advertising thermometer", "advertising ruler", "advertising yardstick", "yardstick"],
    negative: ["digital", "reproduction", "modern", "plastic school ruler"],
    ship_cost: 9,
    ebay_category: "Collectibles > Advertising",
    rationale:
      "Hardware stores, feed mills, banks and implement dealers gave these away. Yardsticks in particular "
      + "are near-worthless to an auctioneer, sell steadily to sign-and-advertising collectors, and ship "
      + "cheaply in a triangular tube.",
    tells: ["Named town and state", "Porcelain or embossed tin beats printed masonite", "Farm implement, seed and brewery imprints lead"],
    risks: ["Warping and paint loss", "Long items cost more to ship than people expect"],
    origin: "seed",
    confidence: 0.4,
  },
  {
    name: "Advertising paperweights and desk smalls",
    family: "Advertising ephemera",
    queries: ["antique advertising paperweight cast iron", "vintage advertising paperweight glass", "advertising desk clip vintage"],
    must_any: ["advertising paperweight", "paperweight advertising", "figural paperweight", "advertising inkwell", "desk clip"],
    negative: ["art glass modern", "murano", "reproduction", "paperweight lot of"],
    ship_cost: 9,
    ebay_category: "Collectibles > Advertising",
    rationale: "Heavy, survivable, imprinted with a company and a town, and usually mixed into a box of desk junk.",
    tells: ["Figural shapes (the product in miniature) beat plain discs", "Glass mirror-back paperweights show a photo of the factory", "Foundry and machinery company weights are strong"],
    risks: ["Heavier shipping eats the margin on cheap examples"],
    origin: "seed",
    confidence: 0.4,
  },
  {
    name: "Local advertising signs, tins and blotters",
    family: "Advertising ephemera",
    queries: ["antique advertising ink blotter", "vintage small advertising tin", "antique advertising sign small tin"],
    must_any: ["ink blotter", "advertising blotter", "advertising tin", "tin sign", "porcelain sign"],
    negative: ["reproduction", "repro", "modern man cave", "vintage style", "new old stock decal"],
    ship_cost: 7,
    ebay_category: "Collectibles > Advertising",
    rationale:
      "Paper blotters and small tins are the cheapest entry into advertising collecting and the easiest "
      + "to ship. Reproduction risk is real, which is exactly why photo-reading matters.",
    tells: ["Genuine age toning on paper; period typography", "Tins: seams, lithography wear, no modern barcode or copyright line"],
    risks: ["The reproduction market for tin signs is enormous — treat any 'vintage style' wording as disqualifying"],
    origin: "seed",
    confidence: 0.35,
  },

  // ---------------------------------------------------------------- bank & financial paper
  {
    name: "Obsolete bank notes and scrip",
    family: "Bank & financial memorabilia",
    queries: ["obsolete bank note broken bank", "antique bank scrip note", "depression scrip note"],
    must_any: ["obsolete note", "broken bank note", "bank scrip", "depression scrip", "obsolete currency"],
    negative: ["copy", "reproduction", "facsimile", "replica", "novelty million dollar"],
    ship_cost: 4,
    ebay_category: "Coins & Paper Money > Paper Money",
    rationale:
      "Pre-1866 state bank notes and Depression-era scrip turn up in paper lots and old desks. Town-specific, "
      + "catalogued (Haxby numbers), and they ship in an envelope.",
    tells: ["Town and state, denomination, signatures present", "Vignette quality and whether it is a remainder (unsigned) or issued", "Haxby or Whitman catalogue numbers on the holder"],
    risks: ["Modern facsimiles are common and usually say 'copy' somewhere on the face", "Grading matters enormously"],
    origin: "seed",
    confidence: 0.4,
  },
  {
    name: "Antique stock and bond certificates",
    family: "Bank & financial memorabilia",
    queries: ["antique stock certificate railroad", "vintage bond certificate mining", "scripophily stock certificate"],
    must_any: ["stock certificate", "bond certificate", "scripophily"],
    negative: ["reproduction", "replica", "blank modern", "certificate of deposit", "gift certificate"],
    ship_cost: 5,
    ebay_category: "Collectibles > Paper > Stocks & Bonds",
    rationale:
      "Railroad, mining and early-tech certificates have an established collector market (scripophily) and "
      + "come out of estates in bundles. Flat, light, and the vignette engraving does the selling.",
    tells: ["Company, state and date", "Engraved vignettes (ABNCo, American Bank Note) beat plain printing", "Autographs of known industrialists are the jackpot", "Cancellation holes reduce but do not kill value"],
    risks: ["Common 1960s-80s certificates are near-worthless", "Condition and folds matter"],
    origin: "seed",
    confidence: 0.4,
  },
  {
    name: "Cast iron and figural still banks",
    family: "Bank & financial memorabilia",
    queries: ["antique cast iron still bank", "figural still bank antique", "antique coin bank cast iron"],
    must_any: ["still bank", "cast iron bank", "coin bank", "penny bank"],
    negative: ["reproduction", "repro", "modern", "piggy bank ceramic new", "power bank", "bank bag"],
    ship_cost: 12,
    ebay_category: "Collectibles > Banks",
    rationale: "A deep, old, catalogued collector market (Moore numbers) with a long history of things surfacing in farm and estate sales.",
    tells: ["Casting crispness and seam fit", "Original paint wear in the right places, not uniform", "Japanned or gold-painted surfaces", "Weight feels right for period iron"],
    risks: ["Reproductions are extremely common — a sharp, heavy, perfectly-painted example is a red flag, not a bonus", "Shipping cost is real"],
    origin: "seed",
    confidence: 0.35,
  },

  // ---------------------------------------------------------------- adjacent cheap-in / fast-out smalls
  {
    name: "Advertising and figural pinback buttons",
    family: "Advertising ephemera",
    queries: ["antique celluloid pinback button advertising", "vintage political pinback button"],
    must_any: ["pinback", "pin back button", "celluloid button", "campaign button"],
    negative: ["reproduction", "repro", "modern", "button lot of 100", "sewing buttons"],
    ship_cost: 4,
    ebay_category: "Collectibles > Pinbacks",
    rationale: "Weightless to ship, catalogued, and they hide in jars and junk drawers in every estate sale.",
    tells: ["Union bug and maker's name on the curl", "Named candidate, year and locality", "Celluloid vs. lithographed tin"],
    risks: ["The 1972 Kleenex reproduction set floods the political market", "Foxing and rust under the celluloid"],
    origin: "seed",
    confidence: 0.4,
  },
  {
    name: "Railroadiana smalls",
    family: "Transport & industrial",
    queries: ["antique railroad lantern globe", "railroad switch key antique", "railroad paperweight advertising"],
    must_any: ["railroad", "railway", "switch key", "lantern globe"],
    negative: ["reproduction", "repro", "model train", "lionel", "ho scale", "toy"],
    ship_cost: 10,
    ebay_category: "Collectibles > Transportation > Railroadiana",
    rationale: "Line-marked hardware has a devoted collector base that buys by railroad name, and small pieces ship easily.",
    tells: ["Railroad initials cast or stamped into the piece", "Adlake, Handlan, Dressel and Armspear markings", "Short-line and defunct roads beat the big ones"],
    risks: ["Reproduction keys and markings are common", "Unmarked hardware is just hardware"],
    origin: "seed",
    confidence: 0.35,
  },
  {
    name: "Fraternal and society regalia",
    family: "Advertising ephemera",
    queries: ["antique masonic medal fob", "odd fellows antique badge", "fraternal ribbon badge antique"],
    must_any: ["masonic", "odd fellows", "knights of pythias", "shriner", "fraternal", "watch fob"],
    negative: ["reproduction", "modern", "costume jewelry lot"],
    ship_cost: 5,
    ebay_category: "Collectibles > Fraternal Organizations",
    rationale: "Lodge material turns up constantly in estates, sells to a steady niche, and the enamel and gold-fill pieces carry real metal value on top.",
    tells: ["Gold-filled or 10k marks", "Named lodge and town", "Enamel condition", "Dated presentation engraving"],
    risks: ["Most plain lodge pins are low value", "Check for solder repairs"],
    origin: "seed",
    confidence: 0.35,
  },
];

/** The seed pack as full Thesis objects. `normalize` is `normalizeThesis` bound to your config. */
export function seedTheses<T>(normalize: (seed: Seed) => T): T[] {
  return SEED_THESES.map(normalize);
}
