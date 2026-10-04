// Mystery lots — where the auctioneer didn't look, so nobody else has either.
//
// THE EDGE IS INFORMATION ASYMMETRY, AND IT IS LARGEST EXACTLY WHERE DESCRIPTION EFFORT WAS LOWEST.
//
// A lot titled "Milwaukee M18 hammer drill" is priced by a room full of people who can all read. A lot
// titled "MISC" with six photographs is priced by whoever can be bothered to squint at the thumbnails —
// and almost nobody can, because it is tedious, it is one of four hundred lots, and the reward for
// getting it right is a $3 box. That tedium is the moat. A model that reads every photograph carefully,
// every time, at four hundred lots an hour, is on the right side of it.
//
// So this module answers one question: HOW BLIND IS THIS LISTING? Not "is it valuable" — that comes
// later, from the photos. Blindness is measured from the gap between what the auctioneer SHOWED and what
// they SAID:
//
//   photos are what an auctioneer always provides (they have to photograph the pallet anyway)
//   words are what they provide only when they know, or care, what the thing is
//
// Many photos and few words is the signature of "I photographed a box and moved on". That is the buy
// signal. Few photos and few words is just a thin listing, and a lot with a long specific title is
// already priced by the crowd however cheap it looks.
//
// A high mystery score is NOT a prediction of value. It is a prediction that the price does not yet
// reflect the contents, which is a different and more useful thing.
import type { Lot, MysteryEconomics, MysteryRead, Score, Valuation } from "./types";
import type { Config } from "./config";

/** The words auctioneers use when they have not catalogued something. */
const MYSTERY_WORDS = /\b(misc|miscellaneous|assorted|assortment|sundry|sundries|various|unsorted|unknown|unidentified|mystery|grab bag|junk drawer|junk lot|odds and ends|this and that|bric.?a.?brac|knic ?knac\w*|knick ?knack\w*|smalls|treasure|as found|as is lot|estate lot|contents of|content of|box lot|box of|tote of|tote lot|crate of|crate lot|shelf lot|table lot|tray lot|flat of|flat lot|bin of|bucket of|bag of|group lot|group of|collection of|lot of|assorted lot|dealer lot|resale lot|storage unit)\b/gi;

/** Words that carry no information about what a thing is. Removed before counting "informative" words. */
const FILLER = new Set(("a an the and or of for with in on at to from by is are this that these those "
  + "new old used nice good great large small big little vtg vintage antique lot lots set sets pair pairs "
  + "piece pieces pcs pc item items thing things approx approximately incl including plus more other "
  + "misc miscellaneous assorted assortment various sundry unsorted unknown box boxes tote crate tray flat "
  + "bin bucket bag shelf table group collection contents content estate as found condition see photos "
  + "photo pics pictures shown all everything you get here").split(" "));

/** A token that looks like a brand, a model number or a proper noun: evidence the lot WAS catalogued. */
const SPECIFIC = /^(?:[A-Z][a-z]{2,}|[A-Z]{2,}|[A-Za-z]{1,4}[-]?\d{2,}[A-Za-z]?|\d{4})$/;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Search terms that surface uncatalogued lots on an auction site. Used by hunt mode. */
export const MYSTERY_QUERIES = [
  "misc", "miscellaneous lot", "assorted lot", "box lot", "shelf lot", "contents of drawer",
  "junk drawer", "knick knacks", "smalls lot", "estate box lot", "unsorted lot", "grab bag",
  "misc advertising", "vintage collectibles", "garage lot", "small antiques", "advertising lot", "dresser items",
  "desk items", "old tins", "estate box", "garage collectibles", "small metal items", "vintage household",
  "old store items", "assorted advertising", "contents of shelf", "contents of cabinet",
];

/**
 * How blind is this listing? Returns a 0-1 score with the reasons that produced it.
 *
 * The weights are deliberately lopsided toward the photos-vs-words gap, because that is the signal the
 * crowd cannot cheaply act on. An explicit "MISC" in the title is the loudest single tell, but a lot
 * titled "Box" with nine photographs is the same opportunity wearing a different hat.
 */
export function readMystery(lot: Lot, c?: Pick<Config, "mysteryThreshold">): MysteryRead {
  const title = (lot.title ?? "").replace(/^\s*[A-Z0-9]{1,3}\)\s*/, ""); // drop the auctioneer's sort prefix
  const desc = (lot.description ?? "").trim();
  const photos = Math.max(lot.picture_count ?? 0, lot.pictures?.length ?? 0);
  const signals: string[] = [];
  let score = 0;

  const firstHit = title.match(MYSTERY_WORDS)?.[0] ?? null;
  if (firstHit) {
    score += 0.45;
    signals.push(`Title says "${firstHit.toLowerCase()}"`);
  }

  // Informative words: what is left after the filler that describes nothing.
  const tokens = title.split(/[^A-Za-z0-9'-]+/).filter(Boolean);
  const informative = tokens.filter((w) => w.length > 2 && !FILLER.has(w.toLowerCase()));
  if (informative.length <= 2) {
    score += 0.2;
    signals.push(informative.length ? `Only ${informative.length} descriptive word(s) in the title` : "Title describes nothing");
  } else if (informative.length <= 4) {
    score += 0.1;
  }

  // A brand or model number means somebody looked it up; that knowledge is already in the price.
  const hasSpecific = tokens.some((t) => SPECIFIC.test(t));
  if (!hasSpecific) {
    score += 0.12;
    signals.push("No brand or model named");
  }

  // The core signal: they photographed it but did not describe it.
  if (photos >= 2 && informative.length <= 5) {
    const gap = clamp((photos - 1) / 6, 0, 1) * 0.25;
    score += gap;
    signals.push(`${photos} photos against ${informative.length} descriptive word(s) — photographed but not catalogued`);
  } else if (photos === 0) {
    // No photos is not opportunity, it is a blind bid. Nothing to read.
    score -= 0.3;
    signals.push("No photos: nothing to read");
  }

  const descWords = desc ? desc.split(/\s+/).length : 0;
  if (descWords <= 12 && firstHit) {
    score += 0.08;
    signals.push(descWords ? "Description barely longer than the title" : "No description at all");
  }

  const opening = lot.min_bid || lot.high_bid || 0;
  if (opening > 0 && opening <= 10) {
    score += 0.08;
    signals.push(`Opens at $${Math.round(opening)}`);
  }

  score = clamp(Math.round(score * 100) / 100, 0, 1);
  const threshold = c?.mysteryThreshold ?? 0.45;
  const isMystery = score >= threshold && photos > 0;

  const reason = !photos
    ? "No photos, so there is nothing to identify."
    : isMystery
    ? `Uncatalogued: ${signals.slice(0, 2).join("; ").toLowerCase()}. Whatever is in the photos is not in the price.`
    : signals.length
    ? signals[0]
    : "Listing is specific enough that the crowd can price it.";

  return { is_mystery: isMystery, score, signals, photos, informative_words: informative.length, reason };
}

/** Extra triage weight for a blind listing, so mystery lots compete for valuation calls on purpose. */
export function mysteryBoost(lot: Lot, c: Config): number {
  if (!c.mystery || !c.vision) return 0; // reading photos is the whole method; without vision, skip
  const m = readMystery(lot, c);
  if (!m.is_mystery) return 0;
  return c.mysteryWeight * m.score;
}

/**
 * What the photo read actually found. The headline is not the lot's total value but the SINGLE BEST
 * ITEM: you pay $3 for the box because one thing in it is worth $40, and the rest is packing material.
 * A lot whose value is spread thinly across twenty $2 objects is a worse trade at the same total,
 * because you have to list twenty things.
 */
export function mysteryEconomics(lot: Lot, val: Valuation | null, sc: Score, c: Config): MysteryEconomics | null {
  if (!c.mystery) return null;
  const read = readMystery(lot, c);
  if (!read.is_mystery) return null;

  const items = (val?.items ?? []).filter((i) => i && i.name);
  const mid = (i: { est_low: number; est_high: number }) => ((+i.est_low || 0) + (+i.est_high || 0)) / 2;
  const sorted = [...items].sort((a, b) => mid(b) - mid(a));
  const best = sorted[0] ?? null;
  const identified = items.reduce((a, i) => a + mid(i), 0);
  const bestMid = best ? mid(best) : 0;
  const bestNet = bestMid > 0 ? bestMid * (1 - c.resaleFee) - c.resaleShipping - c.packagingCost : 0;
  const cost = sc.landed_cost;

  return {
    read,
    items_identified: items.length,
    identified_value: Math.round(identified * 100) / 100,
    best_item: best ? { name: best.name, maker_or_mark: best.maker_or_mark ?? "", est_low: +best.est_low || 0, est_high: +best.est_high || 0, confidence: +best.confidence || 0, note: best.note ?? "" } : null,
    best_item_net: Math.round(bestNet * 100) / 100,
    /** The multiple on the best single item alone — the number that justifies buying a box of junk. */
    best_item_multiple: cost > 0 && bestNet > 0 ? Math.round((bestNet / cost) * 100) / 100 : null,
    /** Share of the lot's value carried by its best piece. High means one thing matters. */
    concentration: identified > 0 && bestMid > 0 ? Math.round((bestMid / identified) * 100) / 100 : null,
    standout: val?.standout_item ?? "",
  };
}

/** The sentence the dossier leads with for a mystery lot. */
export function mysteryVerdict(m: MysteryEconomics, c: Config): string {
  if (!m.items_identified) {
    return `${m.read.reason} Nothing identified yet — this lot has not been through a photo read.`;
  }
  const best = m.best_item;
  if (!best || m.best_item_net <= 0) {
    return `Photos show ${m.items_identified} distinct item(s), none of them worth listing individually.`;
  }
  const mult = m.best_item_multiple;
  const lead = `${best.name}${best.maker_or_mark && best.maker_or_mark !== "unmarked" ? ` (${best.maker_or_mark})` : ""}`;
  const concentrated = m.concentration !== null && m.concentration >= 0.6;
  return `${m.items_identified} items identified; the one that matters is ${lead}, worth about $${Math.round((best.est_low + best.est_high) / 2)}`
    + `${mult ? ` — ${mult.toFixed(1)}x the whole lot's landed cost on its own` : ""}.`
    + (concentrated ? " Most of this lot's value is that single piece; the rest is packing material." : ` The other pieces add roughly $${Math.round(m.identified_value - (best.est_low + best.est_high) / 2)}.`);
}
