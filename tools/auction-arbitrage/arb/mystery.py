"""Mystery lots -- where the auctioneer didn't look, so nobody else has either.

THE EDGE IS INFORMATION ASYMMETRY, AND IT IS LARGEST EXACTLY WHERE DESCRIPTION EFFORT WAS LOWEST.

A lot titled "Milwaukee M18 hammer drill" is priced by a room full of people who can all read. A lot
titled "MISC" with six photographs is priced by whoever can be bothered to squint at the thumbnails --
and almost nobody can, because it is tedious, it is one of four hundred lots, and the reward for getting
it right is a $3 box. That tedium is the moat. A model that reads every photograph carefully, every
time, at four hundred lots an hour, is on the right side of it.

So this module answers one question: HOW BLIND IS THIS LISTING? Not "is it valuable" -- that comes
later, from the photos. Blindness is measured from the gap between what the auctioneer SHOWED and what
they SAID:

    photos are what an auctioneer always provides (they have to photograph the pallet anyway)
    words are what they provide only when they know, or care, what the thing is

Many photos and few words is the signature of "I photographed a box and moved on". That is the buy
signal. Few photos and few words is just a thin listing, and a lot with a long specific title is already
priced by the crowd however cheap it looks.

A high mystery score is NOT a prediction of value. It is a prediction that the price does not yet
reflect the contents, which is a different and more useful thing.

Mirrors lib/spread/mystery.ts.
"""
from __future__ import annotations

import re
from typing import Any

from .config import Settings

#: The words auctioneers use when they have not catalogued something.
MYSTERY_WORDS = re.compile(
    r"\b(misc|miscellaneous|assorted|assortment|sundry|sundries|various|unsorted|unknown|unidentified"
    r"|mystery|grab bag|junk drawer|junk lot|odds and ends|this and that|bric.?a.?brac|knic ?knac\w*"
    r"|knick ?knack\w*|smalls|treasure|as found|as is lot|estate lot|contents of|content of|box lot"
    r"|box of|tote of|tote lot|crate of|crate lot|shelf lot|table lot|tray lot|flat of|flat lot|bin of"
    r"|bucket of|bag of|group lot|group of|collection of|lot of|assorted lot|dealer lot|resale lot"
    r"|storage unit)\b",
    re.I,
)

#: Words that carry no information about what a thing is. Removed before counting "informative" words.
FILLER = set(
    "a an the and or of for with in on at to from by is are this that these those "
    "new old used nice good great large small big little vtg vintage antique lot lots set sets pair pairs "
    "piece pieces pcs pc item items thing things approx approximately incl including plus more other "
    "misc miscellaneous assorted assortment various sundry unsorted unknown box boxes tote crate tray flat "
    "bin bucket bag shelf table group collection contents content estate as found condition see photos "
    "photo pics pictures shown all everything you get here".split()
)

#: A token that looks like a brand, a model number or a proper noun: evidence the lot WAS catalogued.
SPECIFIC = re.compile(r"^(?:[A-Z][a-z]{2,}|[A-Z]{2,}|[A-Za-z]{1,4}-?\d{2,}[A-Za-z]?|\d{4})$")

#: Search terms that surface uncatalogued lots on an auction site. Used by hunt mode.
MYSTERY_QUERIES = [
    "misc", "miscellaneous lot", "assorted lot", "box lot", "shelf lot", "contents of drawer",
    "junk drawer", "knick knacks", "smalls lot", "estate box lot", "unsorted lot", "grab bag",
]

_PREFIX = re.compile(r"^\s*[A-Z0-9]{1,3}\)\s*")


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def read_mystery(lot: dict[str, Any], s: Settings | None = None) -> dict[str, Any]:
    """How blind is this listing? Returns a 0-1 score with the reasons that produced it.

    The weights are deliberately lopsided toward the photos-vs-words gap, because that is the signal the
    crowd cannot cheaply act on. An explicit "MISC" in the title is the loudest single tell, but a lot
    titled "Box" with nine photographs is the same opportunity wearing a different hat.
    """
    title = _PREFIX.sub("", lot.get("title") or "")  # drop the auctioneer's sort prefix
    desc = (lot.get("description") or "").strip()
    photos = max(int(lot.get("picture_count") or 0), len(lot.get("pictures") or []))
    signals: list[str] = []
    score = 0.0

    hit = MYSTERY_WORDS.search(title)
    if hit:
        score += 0.45
        signals.append(f'Title says "{hit.group(0).lower()}"')

    # Informative words: what is left after the filler that describes nothing.
    tokens = [t for t in re.split(r"[^A-Za-z0-9'-]+", title) if t]
    informative = [w for w in tokens if len(w) > 2 and w.lower() not in FILLER]
    if len(informative) <= 2:
        score += 0.2
        signals.append(f"Only {len(informative)} descriptive word(s) in the title" if informative
                       else "Title describes nothing")
    elif len(informative) <= 4:
        score += 0.1

    # A brand or model number means somebody looked it up; that knowledge is already in the price.
    if not any(SPECIFIC.match(t) for t in tokens):
        score += 0.12
        signals.append("No brand or model named")

    # The core signal: they photographed it but did not describe it.
    if photos >= 2 and len(informative) <= 5:
        score += _clamp((photos - 1) / 6, 0, 1) * 0.25
        signals.append(f"{photos} photos against {len(informative)} descriptive word(s) "
                       "-- photographed but not catalogued")
    elif photos == 0:
        # No photos is not opportunity, it is a blind bid. Nothing to read.
        score -= 0.3
        signals.append("No photos: nothing to read")

    desc_words = len(desc.split()) if desc else 0
    if desc_words <= 12 and hit:
        score += 0.08
        signals.append("Description barely longer than the title" if desc_words else "No description at all")

    opening = lot.get("min_bid") or lot.get("high_bid") or 0
    if 0 < opening <= 10:
        score += 0.08
        signals.append(f"Opens at ${round(opening)}")

    score = _clamp(round(score, 2), 0, 1)
    threshold = s.mystery_threshold if s else 0.45
    is_mystery = score >= threshold and photos > 0

    if not photos:
        reason = "No photos, so there is nothing to identify."
    elif is_mystery:
        reason = (f"Uncatalogued: {'; '.join(signals[:2]).lower()}. "
                  "Whatever is in the photos is not in the price.")
    elif signals:
        reason = signals[0]
    else:
        reason = "Listing is specific enough that the crowd can price it."

    return {"is_mystery": is_mystery, "score": score, "signals": signals, "photos": photos,
            "informative_words": len(informative), "reason": reason}


def mystery_boost(lot: dict[str, Any], s: Settings) -> float:
    """Extra triage weight for a blind listing, so mystery lots compete for valuation calls on purpose."""
    if not s.mystery or not s.vision:  # reading photos is the whole method; without vision, skip
        return 0.0
    m = read_mystery(lot, s)
    return s.mystery_weight * m["score"] if m["is_mystery"] else 0.0


def mystery_economics(lot: dict[str, Any], val: dict[str, Any] | None, sc: dict[str, Any],
                      s: Settings) -> dict[str, Any] | None:
    """What the photo read actually found.

    The headline is not the lot's total value but the SINGLE BEST ITEM: you pay $3 for the box because
    one thing in it is worth $40, and the rest is packing material. A lot whose value is spread thinly
    across twenty $2 objects is a worse trade at the same total, because you have to list twenty things.
    """
    if not s.mystery:
        return None
    read = read_mystery(lot, s)
    if not read["is_mystery"]:
        return None

    items = [i for i in ((val or {}).get("items") or []) if i and i.get("name")]
    def mid(i: dict[str, Any]) -> float:
        return ((float(i.get("est_low") or 0)) + (float(i.get("est_high") or 0))) / 2
    best = max(items, key=mid) if items else None
    identified = sum(mid(i) for i in items)
    best_mid = mid(best) if best else 0.0
    best_net = best_mid * (1 - s.resale_fee) - s.resale_shipping - s.packaging_cost if best_mid > 0 else 0.0
    cost = sc.get("landed_cost") or 0

    return {
        "read": read,
        "items_identified": len(items),
        "identified_value": round(identified, 2),
        "best_item": ({"name": best["name"], "maker_or_mark": best.get("maker_or_mark") or "",
                       "est_low": float(best.get("est_low") or 0), "est_high": float(best.get("est_high") or 0),
                       "confidence": float(best.get("confidence") or 0), "note": best.get("note") or ""}
                      if best else None),
        "best_item_net": round(best_net, 2),
        # The multiple on the best single item alone -- the number that justifies buying a box of junk.
        "best_item_multiple": round(best_net / cost, 2) if cost > 0 and best_net > 0 else None,
        # Share of the lot's value carried by its best piece. High means one thing matters.
        "concentration": round(best_mid / identified, 2) if identified > 0 and best_mid > 0 else None,
        "standout": (val or {}).get("standout_item") or "",
    }


def mystery_verdict(m: dict[str, Any], s: Settings) -> str:
    """The sentence the dossier leads with for a mystery lot."""
    if not m["items_identified"]:
        return f"{m['read']['reason']} Nothing identified yet -- this lot has not been through a photo read."
    best = m["best_item"]
    if not best or m["best_item_net"] <= 0:
        return (f"Photos show {m['items_identified']} distinct item(s), none of them worth listing "
                "individually.")
    mark = best.get("maker_or_mark") or ""
    lead = best["name"] + (f" ({mark})" if mark and mark != "unmarked" else "")
    mid = round((best["est_low"] + best["est_high"]) / 2)
    mult = m["best_item_multiple"]
    out = (f"{m['items_identified']} items identified; the one that matters is {lead}, worth about ${mid}"
           + (f" -- {mult:.1f}x the whole lot's landed cost on its own" if mult else "") + ".")
    if m["concentration"] is not None and m["concentration"] >= 0.6:
        return out + " Most of this lot's value is that single piece; the rest is packing material."
    return out + f" The other pieces add roughly ${round(m['identified_value'] - mid)}."
