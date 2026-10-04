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
  // ---------------------------------------------------------------- the hunting taxonomy's top families
  {
    name: "Advertising and promotional banks",
    family: "Advertising banks",
    queries: ["vintage advertising bank", "banthrico bank", "promotional coin bank", "post office door bank", "cast metal advertising bank"],
    must_any: ["advertising bank", "banthrico", "coin bank", "still bank", "promotional bank", "post office box door", "po box door bank", "mailbox bank", "savings bank"],
    negative: ["reproduction", "piggy bank modern", "power bank", "blood bank", "food bank", "bank statement", "bank of america card"],
    ship_cost: 9,
    ebay_category: "Collectibles > Banks, Registers & Vending > Banks",
    rationale:
      "Banthrico, local banks, insurance agents, breweries, bottlers and oil companies all gave away banks. Small, "
      + "searchable, and bought by three pools at once: the brand collector, the still-bank collector and the "
      + "local-history buyer. A bank built around a real post-office box door adds a fourth. Usually catalogued "
      + "as 'metal box' or 'coin bank'.",
    tells: [
      "Read the imprint: the business, its town and state, and whether it still exists",
      "Banthrico is marked on the base; its building and vehicle shapes are the strong ones",
      "A real post-office box door (brass, with a combination or key lock) beats a cast copy",
      "Mascot and figural banks (Reddy Kilowatt, bears, tires, gas pumps, bottles) cross into character collecting",
      "Original key or working combination adds; repaints and replaced traps subtract",
    ],
    risks: ["Reproduction cast-iron banks are everywhere: check casting seams and wear placement", "Pot-metal corrosion and missing traps"],
    origin: "seed",
    confidence: 0.5,
  },
  {
    name: "Petroliana oil cans and oilers",
    family: "Petroliana",
    queries: ["vintage oil can", "handy oiler advertising", "long spout oil can", "vintage grease tin", "outboard oil can vintage", "snowmobile oil can"],
    must_any: ["oil can", "oiler", "grease tin", "grease can", "quart can", "pint can", "motor oil", "outboard oil", "2 cycle", "two cycle", "oil bottle", "pump plate"],
    negative: ["reproduction", "modern", "empty plastic", "watering can", "garden"],
    ship_cost: 12,
    ebay_category: "Collectibles > Advertising > Gas & Oil",
    rationale:
      "Every brand that ever sold lubricant put it in a lithographed can, and the cans survive in garages and "
      + "estate box lots. Obsolete brands, snowmobile and outboard oils, household oilers (Singer, 3-In-One) and "
      + "service-station desk items each have their own collector base. Texaco, Shell, Gulf, Quaker State, Pennzoil, "
      + "Esso, Standard, D-X, Sunoco, Mobil, Union 76, Kendall, Valvoline, Castrol, Bardahl, John Deere, Sears/Allstate.",
    tells: ["Graphics strength and obsolete brand first", "Full, sealed or NOS cans step up", "Dents, rust and fading on the display side matter most", "Small oilers and grease tins ship cheaply; full quart cans do not"],
    risks: ["Leaking or full cans cannot ship by air", "Common brands in poor condition are worth a few dollars"],
    origin: "seed",
    confidence: 0.5,
  },
  {
    name: "Breweriana and Hamm's Bear",
    family: "Breweriana",
    queries: ["hamm's bear", "vintage beer sign", "brewery advertising lot", "beer motion sign", "tap knob lot", "chalkware beer"],
    must_any: ["hamm's", "hamms", "beer sign", "brewery", "tap knob", "tap handle", "beer tray", "beer thermometer", "breweriana", "schlitz", "pabst", "blatz", "stroh", "falstaff", "grain belt", "olympia beer"],
    negative: ["reproduction", "neon modern", "bud light modern", "home brew kit"],
    ship_cost: 12,
    ebay_category: "Collectibles > Breweriana, Beer",
    rationale:
      "Hamm's Bear material is the standout: early ceramic and Red Wing figures and working motion signs sell for "
      + "hundreds, and they appear in box lots described as 'bear figurine' or 'beer sign'. Regional defunct "
      + "breweries have loyal local collectors.",
    tells: ["Hamm's Bear: ceramic vs vinyl, Red Wing marks on the base, generation of the figure", "Motion and lighted signs: does it work; original motor and lens", "Tap knobs with enamel inserts and regional breweries", "Chalkware mascots with original paint"],
    risks: ["Motion signs often need motors; price as non-working unless shown running", "Reproduction Hamm's pieces exist"],
    origin: "seed",
    confidence: 0.5,
  },
  {
    name: "Advertising mascots and character figures",
    family: "Advertising ephemera",
    queries: ["reddy kilowatt", "advertising mascot figure", "mr peanut bank", "vintage advertising figure", "tire company mascot", "oil company mascot"],
    must_any: ["reddy kilowatt", "mr peanut", "mr. peanut", "planters peanut", "mascot", "advertising figure", "advertising statue", "bibendum", "michelin man", "big boy", "speedy alka", "elsie the cow", "poppin fresh"],
    negative: ["reproduction", "modern funko", "pop vinyl", "plush modern"],
    ship_cost: 10,
    ebay_category: "Collectibles > Advertising",
    rationale:
      "Brand collector plus character collector plus advertising buyer: three pools for one object. Reddy "
      + "Kilowatt (utility companies), Mr. Peanut, oil and tire mascots, insurance and utility figures in vinyl, "
      + "ceramic, rubber, chalkware or translucent plastic. Often sold as 'vintage figurine'.",
    tells: ["Name the character and the company that issued it", "Material and era: early ceramic and painted metal beat later vinyl", "Scripto VU lighters and other Reddy Kilowatt crossover pieces", "Counter-display sizes step up sharply"],
    risks: ["Repaints and reproductions on the famous characters", "Missing parts (hats, signs, bases)"],
    origin: "seed",
    confidence: 0.5,
  },
  {
    name: "Small automotive advertising: emblems, spark plugs, clocks",
    family: "Automobilia",
    queries: ["vintage car emblem lot", "hood ornament lot", "dealer badge vintage", "champion spark plug display", "pam advertising clock", "amt promo car", "dealership promotional"],
    must_any: ["emblem", "emblems", "hood ornament", "trunk script", "dealer badge", "dealership", "spark plug", "champion", "autolite", "pam clock", "advertising clock", "promo car", "promotional model", "license plate topper"],
    negative: ["reproduction", "modern", "diecast lot modern", "hot wheels"],
    ship_cost: 9,
    ebay_category: "Collectibles > Transportation > Automobilia",
    rationale:
      "Boards of emblems and 'misc car parts' lots hide dozens of individually searchable $10-50 pieces; "
      + "oversized Champion and AC spark-plug displays and PAM-style advertising clocks turn up in $5 mixed lots "
      + "and sell for $100-class money. Dealer promos and AMT models have year/colour collectors.",
    tells: ["Read every script and emblem: make, model and year", "Spark-plug displays: oversized models and counter cabinets", "Clocks: working, original dial and crystal, maker (PAM, Pam Clock Co., Telechron)", "Promo cars: unusual colours and dealership stamps"],
    risks: ["Reproduction emblems and clock housings", "Clocks need working movements to reach the top of the range"],
    origin: "seed",
    confidence: 0.45,
  },
  {
    name: "Postal and post-office memorabilia",
    family: "Postal",
    queries: ["post office box door", "postal bank", "railway mail", "postal scale vintage", "post office lock"],
    must_any: ["post office", "postal", "po box door", "p.o. box", "mailbox bank", "railway mail", "rpo", "letter box", "stamp dispenser"],
    negative: ["reproduction", "modern mailbox", "usps uniform modern"],
    ship_cost: 10,
    ebay_category: "Collectibles > Historical Memorabilia > Postal",
    rationale: "Dedicated collectors, and the objects are almost always buried in 'bank', 'wood box' or 'metal box' lots.",
    tells: ["Real brass box doors with eagle, combination or key locks and door numbers", "Railway mail and RPO pieces", "Postal scales with maker and date"],
    risks: ["Cast reproduction doors mounted on new wood"],
    origin: "seed",
    confidence: 0.45,
  },
  {
    name: "Identifiable ceramic animals and art-glass smalls",
    family: "Decorative smalls",
    queries: ["rinconada", "hagen renaker", "beswick animal", "josef originals", "fenton glass animal", "mosser glass", "uranium glass lot", "west german pottery"],
    must_any: ["rinconada", "hagen renaker", "hagen-renaker", "beswick", "royal doulton", "goebel", "josef originals", "lefton", "napco", "freeman mcfarlin", "fenton", "mosser", "boyd glass", "viking glass", "blenko", "uranium glass", "carnival glass", "west german", "studio pottery", "fat lava"],
    negative: ["reproduction", "resin", "modern decor", "home interiors"],
    ship_cost: 9,
    ebay_category: "Collectibles > Decorative Collectibles",
    rationale:
      "The decomposition setup: a cheap lot of 'figurines' or 'glass' where the maker is on the base and each "
      + "animal is individually searchable. Small, colourful, easy to photograph and post.",
    tells: ["Turn each piece over and read the mark: Rinconada incised, Hagen-Renaker paper labels, Beswick and Doulton backstamps", "Uranium glass fluoresces; carnival glass colour and pattern decide", "Rare colours and discontinued moulds are the money"],
    risks: ["Chips, repairs and crazing", "Generic unmarked decor is worth nothing — identify or discard"],
    origin: "seed",
    confidence: 0.45,
  },
  {
    name: "Historic-date newspapers and event paper",
    family: "Event-driven paper",
    queries: ["vintage newspaper lot", "historic newspaper", "kennedy assassination newspaper", "war ends newspaper", "moon landing newspaper", "pearl harbor newspaper"],
    must_any: ["newspaper", "newspapers", "front page", "extra edition", "headline"],
    negative: ["reprint", "reproduction", "replica", "facsimile", "commemorative reprint", "modern"],
    ship_cost: 8,
    ebay_category: "Collectibles > Historical Memorabilia",
    rationale:
      "Papers from the day of a famous event — JFK, V-J Day, Pearl Harbor, the moon landing, a title win — sell "
      + "fast and sell again every anniversary, and arrive in estate lots as 'old newspapers'. Flat, light, cheap "
      + "to post in a rigid mailer.",
    tells: ["The date and the headline are the whole value; read them", "City of publication and a local angle add", "Complete issues beat single pages; original folds and toning are fine, water damage is not", "Reprints (often on glossier paper, with later copyright lines) are the main trap"],
    risks: ["Reprint editions of famous front pages are common", "Brittle paper does not survive handling"],
    origin: "seed",
    confidence: 0.5,
  },
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
    tells: [
      "Named town and state", "Porcelain or embossed tin beats printed masonite", "Farm implement, seed and brewery imprints lead",
      "Thermometers: EXACT dimensions decide the price (NuGrape 16-17in, Hires 28-29in, Orange Crush 29in, Prestone 36in sell in different brackets)",
      "Working tube, original paint, maker mark, mounting holes intact; chips and restoration drop a bracket",
      "Bottle-shaped soda thermometers and porcelain oil/automotive examples lead; small 10-18in ones ship easily",
    ],
    risks: ["Warping and paint loss", "Long items cost more to ship than people expect", "Reproduction tin thermometers are common for the famous soda brands"],
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
