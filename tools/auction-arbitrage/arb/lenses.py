"""Lenses -- the things YOU have noticed, made permanent.

Every reseller accumulates private pattern knowledge that no general appraiser has: "anything marked
Occupied Japan moves", "bank giveaways always sell", "the sign guys pay silly money". That knowledge is
worth more than any model's priors because it came from your own sell-through, and until now it lived in
your head and got applied only when you happened to remember it.

A LENS is one such observation, written once and then applied to every single lot forever. It does three
jobs, and the middle one is the important one:

    1. It raises triage priority for lots whose words hint at the pattern.
    2. It tells the APPRAISER what to look for in the photographs -- this is where the value is, because
       a lens fires on things the title never mentions. "Made in Occupied Japan" is stamped on the BOTTOM
       of the figurine; no auctioneer types that, and no keyword search finds it. The only way to catch
       it is to have told the model to turn the thing over and read the base.
    3. It contributes search terms to hunt mode.

Built-in lenses ship switched off except the ones the user named, and CUSTOM INSTRUCTIONS are free text
appended verbatim -- the escape hatch for a hunch that has not yet earned a toggle.

The BUILTIN_LENSES block below is GENERATED from lib/spread/lenses.ts by scripts/sync-lenses.py; edit the
TypeScript and re-run that script rather than editing the prose here.
"""
from __future__ import annotations

import time
from typing import Any

from .playbook import normalize_text

BUILTIN_LENSES: list[dict[str, Any]] = [
    {
        "id": "occupied-japan",
        "name": "Occupied Japan",
        "hint": "Marks dating a piece to 1945–1952 exactly",
        "keywords": [
            "occupied japan",
            "japan",
            "made in japan",
            "nippon",
            "figurine",
            "porcelain",
            "bisque",
            "toby",
            "lusterware"
        ],
        "queries": [
            "occupied japan",
            "made in occupied japan figurine"
        ],
        "prompt": "OCCUPIED JAPAN: on any ceramic, porcelain, bisque, metal or celluloid piece, look at the BASE and the back. Read the country mark exactly and quote it. \"Made in Occupied Japan\" or \"Occupied Japan\" was legally required only between 1945 and 1952, so the mark is a hard seven-year date stamp and a collector category in its own right — it reliably outsells the same object marked only \"Japan\". Distinguish carefully: plain \"Japan\" (pre-1921 or post-1952), \"Nippon\" (pre-1921), \"Made in Japan\" (broad). Note whether the mark is stamped, incised, or a paper label (labels are often lost, so an intact one adds value). Figurines, toby jugs, salt and pepper sets, lustreware tea sets, celluloid toys and small metal novelties are the common forms."
    },
    {
        "id": "bank-objects",
        "name": "Bank & financial objects",
        "hint": "Anything a bank printed its name on",
        "keywords": [
            "bank",
            "savings",
            "trust company",
            "national bank",
            "building and loan",
            "still bank",
            "coin bank",
            "passbook",
            "teller"
        ],
        "queries": [
            "bank advertising",
            "still bank",
            "savings bank premium"
        ],
        "prompt": "BANK OBJECTS: read any imprint naming a bank, trust company, building-and-loan or insurance agency, and quote the institution and its TOWN AND STATE — the town is most of the value, because the buyer is usually a local-history collector, and a defunct small-town bank beats a surviving national one. Forms to watch for: cast-iron and pot-metal still banks, coin registers, passbooks, calendars, blotters, thermometers, rulers, letter openers, pocket mirrors, paperweights, advertising mirrors. Date it where you can: no \"Member FDIC\" suggests pre-1933; a two or three digit phone exchange is pre-war. Flag reproduction cast-iron banks — check casting seams and whether paint wear sits where handling would actually put it."
    },
    {
        "id": "advertising-signs",
        "name": "Vintage advertising signs",
        "hint": "Porcelain, tin and painted signage",
        "keywords": [
            "sign",
            "tin sign",
            "porcelain sign",
            "advertising",
            "gas",
            "oil",
            "soda",
            "beer",
            "feed",
            "seed",
            "dealer"
        ],
        "queries": [
            "porcelain advertising sign",
            "vintage tin advertising sign",
            "antique advertising sign"
        ],
        "prompt": "ADVERTISING SIGNS: identify the brand, the substrate (porcelain enamel, embossed tin, lithographed tin, cardboard, neon, painted wood) and the maker's mark along the bottom edge, and quote any date code. Porcelain outperforms tin; embossed outperforms flat; grommets, shelf brackets and die-cut shapes all add. Gas and oil, soda, beer, feed and seed, and farm-implement dealer signs lead the market. REPRODUCTIONS DOMINATE THIS CATEGORY — treat as suspect any sign with uniform gloss, no edge chipping, artificially even \"rust\", modern screen-print dot patterns, or wording like \"vintage style\". Say plainly when a photo cannot settle authenticity, and lower confidence when so."
    },
    {
        "id": "marks-and-backstamps",
        "name": "Marks & backstamps",
        "hint": "Turn everything over and read the bottom",
        "keywords": [
            "pottery",
            "porcelain",
            "china",
            "vase",
            "figurine",
            "crock",
            "stoneware",
            "art glass"
        ],
        "queries": [],
        "prompt": "MARKS: for every ceramic, glass or metal object, explicitly look for and transcribe the mark on the base — maker, pattern name or number, country of origin, and any date or factory code. Quote the mark verbatim rather than summarising it, and say so when the base is not photographed, because an unphotographed base is the single most common reason a valuable piece gets sold as junk. Names worth flagging on sight: Roseville, Weller, Rookwood, McCoy, Hull, Van Briggle, Fulper, Newcomb, Grueby, Wedgwood, Moorcroft, Royal Doulton, Meissen, KPM, Limoges, Nippon, Satsuma, Fenton, Northwood, Steuben, Loetz, Tiffany, Quezal, Durand."
    },
    {
        "id": "silver-marks",
        "name": "Silver & gold marks",
        "hint": "Sterling, coin silver, karat marks",
        "keywords": [
            "silver",
            "sterling",
            "silverplate",
            "flatware",
            "gold",
            "karat",
            "jewelry",
            "ring",
            "chain"
        ],
        "queries": [
            "sterling silver lot",
            "coin silver antique"
        ],
        "prompt": "PRECIOUS METAL MARKS: inspect every metal item for \"STERLING\", \".925\", \"COIN\", \"900\", a lion passant or other hallmark, or karat marks (10K, 14K, 18K, 585, 750). Distinguish solid silver from PLATE — \"EPNS\", \"quadruple plate\", \"silver on copper\" and \"A1\" all mean plate, which is worth a small fraction. For solid silver, estimate weight from the form and note that scrap value sets a hard floor under the piece regardless of style. Say when the mark is illegible or absent from the photos rather than assuming either way."
    },
    {
        "id": "early-plastics",
        "name": "Bakelite & celluloid",
        "hint": "Early plastics that collectors chase",
        "keywords": [
            "bakelite",
            "catalin",
            "celluloid",
            "lucite",
            "bangle",
            "poker chips",
            "napkin ring",
            "flatware handle"
        ],
        "queries": [
            "bakelite lot",
            "celluloid antique lot"
        ],
        "prompt": "EARLY PLASTICS: look for Bakelite and Catalin (dense, warm to the touch, colours gone butterscotch or deep amber with age, seams absent, no mould lines) and celluloid (thin, light, often ivory-imitating grain). Bangles, dress clips, poker chips, napkin rings, flatware handles, radio cases, buttons and pipe stems are the usual forms; carved or laminated pieces sell for multiples of plain ones. Note that the hot-water and Simichrome tests cannot be done from a photo, so flag what would need confirming in hand and keep confidence honest."
    },
    {
        "id": "railroadiana",
        "name": "Railroadiana & industrial",
        "hint": "Line-marked hardware and lanterns",
        "keywords": [
            "railroad",
            "railway",
            "lantern",
            "switch key",
            "adlake",
            "handlan",
            "dressel",
            "caboose",
            "telegraph"
        ],
        "queries": [
            "railroad lantern",
            "railroad switch key",
            "railroadiana lot"
        ],
        "prompt": "RAILROADIANA: read any cast or stamped railroad initials (PRR, NYC, B&O, ATSF, GTW, PM…) and the maker (Adlake, Handlan, Dressel, Armspear). Marked hardware sells to collectors of that specific road; unmarked hardware is just hardware. Lanterns: note the globe colour, whether the globe is marked, and whether frame and globe match. Short-line and defunct roads beat the big systems. Reproduction keys and re-stamped marks exist — say when a photo cannot settle it."
    },
    {
        "id": "mcm-labels",
        "name": "Mid-century furniture labels",
        "hint": "The paper label under the seat",
        "keywords": [
            "chair",
            "table",
            "credenza",
            "lamp",
            "teak",
            "walnut",
            "danish",
            "mid century",
            "modern"
        ],
        "queries": [
            "danish modern",
            "mid century modern lot"
        ],
        "prompt": "MID-CENTURY LABELS: check the underside of any furniture, lamp or small case piece for a paper label, branded stamp or metal tag. Herman Miller, Knoll, Eames, Dunbar, Heywood-Wakefield, Lane Acclaim, Broyhill Brasilia, Danish Control (\"Made in Denmark\"), and any \"designed by\" attribution move the price by an order of magnitude versus a lookalike. Note wood (teak, rosewood, walnut) and whether veneer is intact. Say explicitly when the underside is not photographed."
    },
    {
        "id": "militaria-marks",
        "name": "Militaria with unit marks",
        "hint": "Maker, date and unit stamps",
        "keywords": [
            "military",
            "army",
            "navy",
            "usmc",
            "wwii",
            "ww2",
            "wwi",
            "medal",
            "insignia",
            "helmet",
            "canteen",
            "bayonet"
        ],
        "queries": [
            "wwii militaria lot",
            "military insignia lot"
        ],
        "prompt": "MILITARIA MARKS: transcribe maker stamps, dates, contract numbers, unit designations and inspector marks — a dated, maker-marked, unit-marked piece is worth many times an unmarked equivalent. Note theatre and period. Named groupings (items traceable to one soldier) carry a large premium. Flag reproduction risk on anything German-marked, and be plain about the fact that photos rarely settle authenticity in this category."
    },
    {
        "id": "native-southwest",
        "name": "Native American & Southwest",
        "hint": "Hallmarks, weave, and legal cautions",
        "keywords": [
            "navajo",
            "zuni",
            "hopi",
            "pueblo",
            "turquoise",
            "squash blossom",
            "kachina",
            "basket",
            "rug",
            "pottery"
        ],
        "queries": [
            "navajo jewelry lot",
            "native american pottery"
        ],
        "prompt": "NATIVE AMERICAN & SOUTHWEST: look for artist hallmarks or signatures on silver and pottery, and note construction — hand-stamped versus cast, natural versus stabilised or block turquoise, coil-built versus slip-cast pottery, and weave count on textiles. Attribute to a named maker or pueblo only with visible evidence. Note that the Indian Arts and Crafts Act restricts how such items may be described and sold, so recommend cautious, evidence-only wording in any listing."
    }
]
# --- end lenses ---

#: The three the user named start on; the rest are there to switch on when they become relevant.
DEFAULT_ON = {"occupied-japan", "bank-objects", "advertising-signs"}


def _phrase_in(hay: str, phrase: str) -> bool:
    words = [w for w in normalize_text(phrase).strip().split(" ") if w]
    return bool(words) and all(f" {w} " in hay for w in words)


def default_watchlist(now: float | None = None) -> dict[str, Any]:
    return {
        "lenses": [{**l, "builtin": True, "enabled": l["id"] in DEFAULT_ON} for l in BUILTIN_LENSES],
        "custom_instructions": "",
        "updated_at": now if now is not None else time.time(),
    }


def merge_watchlist(stored: dict[str, Any] | None, now: float | None = None) -> dict[str, Any]:
    """Merge stored state over the built-ins, so new built-in lenses appear without wiping user edits."""
    base = default_watchlist(now)
    if not stored:
        return base
    by_id = {l.get("id"): l for l in (stored.get("lenses") or []) if l.get("id")}
    merged: list[dict[str, Any]] = []
    for b in base["lenses"]:
        s = by_id.get(b["id"])
        # Built-in text is code, not data: always take the current prompt, keep only the user's toggle.
        merged.append({**b, "enabled": s.get("enabled") is not False} if s else b)
    seen = {m["id"] for m in merged}
    for s in stored.get("lenses") or []:
        if s.get("id") and s["id"] not in seen:
            merged.append({
                "id": s["id"], "name": s.get("name") or s["id"], "hint": s.get("hint") or "",
                "builtin": False, "keywords": s.get("keywords") or [], "queries": s.get("queries") or [],
                "prompt": s.get("prompt") or "", "enabled": s.get("enabled") is not False,
            })
    return {
        "lenses": merged,
        "custom_instructions": (stored.get("custom_instructions") or "")[:4000],
        "updated_at": stored.get("updated_at") or base["updated_at"],
    }


def enabled_lenses(w: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not w:
        return []
    return [l for l in w.get("lenses") or [] if l.get("enabled") and (l.get("prompt") or "").strip()]


def watchlist_prompt(w: dict[str, Any] | None) -> str:
    """The block appended to every appraisal prompt.

    This is what makes a lens fire on things the title never mentions: the model is told to turn objects
    over and read bases whether or not anything in the listing suggested it should.
    """
    if not w:
        return ""
    on = enabled_lenses(w)
    custom = (w.get("custom_instructions") or "").strip()
    if not on and not custom:
        return ""
    parts = [
        "WHAT THIS BUYER IS HUNTING. Apply all of the following to every lot, whether or not the title or "
        "description mentions them \u2014 these patterns are precisely the ones auctioneers miss, so they will "
        "almost never be named in the listing. If one applies, say so explicitly in `value_drivers` and let "
        "it inform the estimate and the listing title."
    ]
    parts += [f"- {l['prompt']}" for l in on]
    if custom:
        parts.append("BUYER'S OWN STANDING INSTRUCTIONS (their words, from their own sales experience \u2014 weigh "
                     "these heavily, they come from someone watching their own sell-through):\n" + custom)
    return "\n".join(parts)


def matched_lenses(lot: dict[str, Any], w: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Which lenses a lot's WORDS hint at. Photos can fire a lens the words never suggested; this is
    only triage."""
    hay = normalize_text(f"{lot.get('title') or ''} {lot.get('description') or ''} "
                         f"{lot.get('category_path') or ''}")
    return [l for l in enabled_lenses(w) if any(_phrase_in(hay, k) for k in (l.get("keywords") or []))]


def lens_boost(lot: dict[str, Any], w: dict[str, Any] | None, weight: float = 1.0) -> float:
    """Triage weight from lens keyword hits, capped so one lens cannot dominate the queue."""
    hits = len(matched_lenses(lot, w))
    return min(2.0, 0.8 * hits) * weight if hits else 0.0


def lens_queries(w: dict[str, Any] | None) -> list[str]:
    """Search terms contributed by enabled lenses, for hunt mode."""
    out: list[str] = []
    for l in enabled_lenses(w):
        for q in l.get("queries") or []:
            if q not in out:
                out.append(q)
    return out
