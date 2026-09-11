"""Demo data: realistic-looking lots + valuations so the dashboard can be explored without scanning.

Everything here is synthetic (titles are real product types with typical secondary-market ranges,
bids and auctions are invented). Never mistake it for live data — the UI labels it DEMO.
"""
from __future__ import annotations

import random
import time
from typing import Any

from .valuation.base import title_key

# title, category path, resale low, resale high, demand, drivers, risks, authenticity_risk, auctioneer_estimate
CATALOG: list[tuple] = [
    ("DeWalt DCD996 20V MAX XR Brushless Hammer Drill, tool only", "Tools > Power Tools", 85, 130, "high", ["XR brushless line holds value", "Tool-only units sell fast to contractors"], ["Battery not included; verify chuck runs true"], False, ""),
    ("Milwaukee M18 FUEL 2767-20 1/2\" High Torque Impact Wrench", "Tools > Power Tools", 170, 240, "high", ["Top-selling impact wrench on the used market"], ["Check anvil for wear"], False, "$100 - $200"),
    ("Makita XT505 18V LXT 5-Piece Combo Kit with 2 batteries", "Tools > Power Tools", 220, 320, "high", ["Complete kit with batteries", "Makita LXT ecosystem"], ["Battery health unknown"], False, ""),
    ("Snap-on 1/2\" Drive Socket Set, 24pc SAE, in case", "Tools > Hand Tools", 350, 520, "high", ["Snap-on brand premium", "Complete sets command more"], ["Confirm no missing sockets"], False, "$150 - $300"),
    ("Stihl MS 271 Farm Boss Chainsaw 20\" bar", "Lawn & Garden > Chainsaws", 240, 360, "high", ["Popular homeowner/farm model"], ["Compression untested"], False, ""),
    ("Honda EU2200i Inverter Generator", "Equipment > Generators", 650, 900, "high", ["Honda inverter generators are the reference standard"], ["Hours unknown; check for stale fuel"], False, "$400 - $600"),
    ("Toro TimeCutter SS4225 42\" Zero Turn Mower", "Lawn & Garden > Mowers", 1400, 2200, "medium", ["Zero-turns sell well in spring/summer"], ["Deck condition, hydro pumps"], False, ""),
    ("EGO Power+ 56V 21\" Self-Propelled Mower w/ 7.5Ah battery", "Lawn & Garden > Mowers", 280, 420, "high", ["Battery included is the value driver"], ["Battery cycle count"], False, ""),
    ("Ryobi ONE+ 18V 6-Tool Combo Kit", "Tools > Power Tools", 130, 200, "medium", ["Entry-level, sells reliably"], ["Low margin category"], False, ""),
    ("Craftsman 3-Drawer Portable Tool Chest w/ misc hand tools", "Tools > Tool Storage", 70, 140, "medium", ["Contents add value"], ["Heavy; local sale only"], False, ""),
    ("Rolex Datejust 36 ref 16233 two-tone, jubilee bracelet", "Jewelry & Watches > Watches", 4800, 6800, "high", ["Classic reference with steady demand"], ["Authenticity/box & papers", "Aftermarket dial or bracelet"], True, "$3,000 - $5,000"),
    ("Omega Seamaster Professional 300M 2531.80 automatic", "Jewelry & Watches > Watches", 2200, 3000, "high", ["Bond Seamaster, strong collector base"], ["Service history", "Authenticity"], True, ""),
    ("Seiko SKX007 Diver automatic, Jubilee bracelet", "Jewelry & Watches > Watches", 220, 340, "high", ["Discontinued cult diver"], ["Mods common, check originality"], False, ""),
    ("1 oz American Gold Eagle coin 2019 BU", "Coins & Currency > Gold", 2450, 2600, "high", ["Tracks spot gold"], ["Counterfeits exist; verify weight/dimensions"], True, ""),
    ("Lot of 5 Morgan Silver Dollars, mixed dates 1880-1921, circulated", "Coins & Currency > Silver", 160, 220, "high", ["Silver content floor"], ["Cleaned or damaged coins reduce value"], False, "$100 - $150"),
    ("Gorham Sterling Silver Flatware Set, Chantilly, 62 pieces", "Antiques > Silver", 1400, 2200, "medium", ["Scrap value alone ~$1,200+", "Chantilly is a sought pattern"], ["Monograms reduce value", "Weigh to confirm"], False, "$800 - $1,200"),
    ("Herman Miller Aeron Chair Size B, fully loaded, graphite", "Furniture > Office", 420, 700, "high", ["Perennial demand from remote workers"], ["Mesh tears, worn arm pads"], False, "$100 - $200"),
    ("Eames Lounge Chair & Ottoman, Herman Miller, black leather", "Furniture > Mid-Century", 3200, 5000, "high", ["Authentic HM label multiplies value"], ["Replicas abound; check label & shock mounts"], True, "$1,000 - $2,000"),
    ("Knoll Barcelona Chair, chrome frame, cognac leather", "Furniture > Mid-Century", 1200, 2500, "medium", ["Knoll-signed frames are the premium"], ["Unsigned replicas ~$300"], True, ""),
    ("Vitamix 5200 Blender with 64oz container", "Housewares > Small Appliances", 140, 220, "high", ["Vitamix refurb market is deep"], ["Container cloudiness"], False, ""),
    ("KitchenAid Artisan 5-Qt Stand Mixer, Empire Red", "Housewares > Small Appliances", 150, 240, "high", ["Popular color", "Attachments included add value"], ["Gear grinding"], False, ""),
    ("Dyson V11 Torque Drive Cordless Vacuum", "Housewares > Vacuums", 180, 280, "high", ["Cordless Dyson resale is strong"], ["Battery degradation"], False, ""),
    ("Le Creuset 7.25 Qt Round Dutch Oven, Flame", "Housewares > Cookware", 180, 260, "high", ["Iconic color", "Lifetime cookware"], ["Chips in enamel"], False, ""),
    ("Vintage Pyrex Butterprint Cinderella Mixing Bowl Set, 4pc", "Collectibles > Glass", 90, 160, "medium", ["Complete sets are scarce"], ["Dishwasher fading kills value"], False, ""),
    ("Fenton Hobnail Milk Glass Vase 8\"", "Collectibles > Glass", 15, 35, "low", [], ["Common; slow seller"], False, ""),
    ("Louis Vuitton Neverfull MM Monogram tote", "Fashion > Handbags", 900, 1300, "high", ["Best-selling LV silhouette"], ["Counterfeits are rampant; needs authentication", "Date code"], True, "$300 - $500"),
    ("Coach leather shoulder bag, black, vintage 1990s", "Fashion > Handbags", 45, 90, "medium", ["Vintage Coach revival"], ["Creed patch condition"], False, ""),
    ("Bose QuietComfort 35 II Wireless Headphones", "Electronics > Audio", 75, 120, "high", ["Still popular despite age"], ["Ear pad wear, battery"], False, ""),
    ("Sonos Play:5 Gen 2 speaker, white", "Electronics > Audio", 220, 320, "medium", ["Sonos ecosystem lock-in"], ["Only S2 compatible"], False, ""),
    ("Apple iPad 9th Gen 64GB Wi-Fi Space Gray", "Electronics > Tablets", 140, 200, "high", ["Commodity item, sells same day"], ["Activation lock", "Battery health"], False, ""),
    ("Apple MacBook Air M1 2020 8GB/256GB", "Electronics > Computers", 380, 520, "high", ["M1 Air is the used-laptop default"], ["Activation lock", "Screen/keyboard"], False, "$200 - $400"),
    ("Nintendo Switch OLED console with dock, white", "Electronics > Video Games", 210, 280, "high", ["Perennial demand"], ["Joy-Con drift"], False, ""),
    ("Sony PlayStation 5 Disc Edition with controller", "Electronics > Video Games", 330, 420, "high", ["Fast seller"], ["Banned console risk"], False, ""),
    ("LEGO Star Wars 75192 UCS Millennium Falcon, sealed", "Toys > LEGO", 650, 850, "high", ["Retired-ish UCS set, sealed premium"], ["Box damage; resealed fakes"], True, "$200 - $400"),
    ("Pokemon Base Set Unlimited Charizard 4/102, ungraded, played", "Collectibles > Trading Cards", 150, 350, "high", ["Grail card even in played condition"], ["Condition drives 10x swings; counterfeit risk"], True, ""),
    ("Canon EOS Rebel T7 DSLR w/ 18-55mm kit lens", "Electronics > Cameras", 280, 380, "high", ["Entry DSLR demand"], ["Shutter count"], False, ""),
    ("Nikon D750 body only", "Electronics > Cameras", 450, 650, "medium", ["Full-frame at bargain prices"], ["Shutter count; recall serials"], False, ""),
    ("DJI Mini 3 Pro drone with RC controller and Fly More kit", "Electronics > Drones", 480, 650, "high", ["Fly More kit adds batteries"], ["Crash history; gimbal"], False, ""),
    ("Garmin Fenix 6 Pro GPS watch", "Electronics > Wearables", 180, 260, "medium", ["Fenix line ages well"], ["Battery"], False, ""),
    ("Meta Quest 3 128GB VR headset", "Electronics > Video Games", 280, 380, "high", ["Current-gen headset"], ["Lens scratches; account lock"], False, ""),
    ("Samsung 65\" QN90B Neo QLED 4K TV", "Electronics > TVs", 500, 750, "medium", ["High-end panel"], ["Local pickup only; panel damage"], False, ""),
    ("Weber Genesis II E-335 3-burner gas grill", "Outdoor > Grills", 350, 550, "medium", ["Weber holds value"], ["Rust on burners"], False, ""),
    ("Yeti Tundra 45 Hard Cooler, tan", "Outdoor > Coolers", 180, 250, "high", ["Yeti brand demand"], ["Counterfeits exist"], False, ""),
    ("Traeger Pro 575 Wood Pellet Grill", "Outdoor > Grills", 300, 450, "medium", ["WiFi model"], ["Auger/controller issues"], False, ""),
    ("Trek Marlin 7 Mountain Bike, size M, 2022", "Sporting Goods > Bicycles", 400, 600, "high", ["Popular entry hardtail"], ["Drivetrain wear"], False, ""),
    ("Peloton Bike (original) with shoes and mat", "Sporting Goods > Fitness", 350, 600, "medium", ["Subscription needed; demand softened"], ["Heavy, local only"], False, ""),
    ("Gibson Les Paul Standard 2019, Bourbon Burst, w/ case", "Musical Instruments > Guitars", 1800, 2400, "high", ["Gibson USA with case"], ["Headstock repair history"], True, "$1,000 - $1,500"),
    ("Fender Player Stratocaster, Sunburst, MIM", "Musical Instruments > Guitars", 480, 650, "high", ["The default used Strat"], ["Fret wear"], False, ""),
    ("Roland TD-17KV Electronic Drum Kit", "Musical Instruments > Drums", 800, 1100, "medium", ["Mesh heads, popular module"], ["Missing cables/pads"], False, ""),
    ("Signed Michael Jordan Bulls jersey, no COA", "Collectibles > Sports Memorabilia", 150, 2500, "low", ["If authentic, four figures"], ["Without JSA/PSA/UDA it is nearly unsellable at full value"], True, "$500 - $1,000"),
    ("Original oil on canvas landscape, signed illegibly, 24x36 framed", "Art > Paintings", 40, 150, "low", [], ["Unattributed art is slow and unpredictable"], False, "$200 - $400"),
    ("Box lot of assorted kitchen utensils and gadgets", "Housewares > Misc", 10, 25, "low", [], ["Junk lot"], False, ""),
    ("Shelf lot of misc hardware, nails, screws, brackets", "Tools > Misc", 10, 30, "low", [], ["Not worth the trip"], False, ""),
    ("John Deere 1025R Sub-Compact Tractor with loader, 210 hrs", "Equipment > Tractors", 13000, 17000, "high", ["Loader included", "Low hours"], ["Verify hours and hydraulics"], False, "$8,000 - $12,000"),
    ("Caterpillar 259D3 Compact Track Loader, 1,850 hrs", "Equipment > Heavy Equipment", 38000, 48000, "medium", ["Cat dealer support"], ["Undercarriage wear ~$8k"], False, ""),
    ("Lodge Cast Iron 5-piece Cookware Set", "Housewares > Cookware", 45, 75, "medium", [], ["Low margin"], False, ""),
    ("Bulova Accutron Spaceview 1960s tuning-fork watch", "Jewelry & Watches > Watches", 350, 600, "medium", ["Collector favourite"], ["Non-running movements common"], False, ""),
    ("Vintage Schwinn Stingray Krate bicycle, Orange Krate, 1970", "Sporting Goods > Bicycles", 900, 1800, "medium", ["Krates are blue-chip collectibles"], ["Reproduction parts reduce value"], False, "$300 - $600"),
    ("Tiffany & Co sterling silver Return to Tiffany heart tag bracelet", "Jewelry & Watches > Jewelry", 180, 280, "high", ["Brand demand"], ["Counterfeits; check hallmarks"], True, ""),
    ("Sony WH-1000XM4 Wireless Headphones", "Electronics > Audio", 120, 180, "high", [], ["Headband cracks"], False, ""),
    # Penny lots: the $1-$3 buys that resell for $20-$50 (the real bread and butter)
    ("G) Strike Three By Clair Bee A Chip Hilton", "Books > Antiquarian & Collectible", 20, 45, "medium", ["Chip Hilton series has a devoted collector base", "Dust jacket present"], ["Ex-library or torn jacket cuts value in half"], False, ""),
    ("G) vintage occupied JAPAN antique knic knacs", "Collectibles > Decorative", 18, 40, "medium", ["'Occupied Japan' mark (1947-52) is actively collected", "Sold as a lot of three"], ["Chips and repairs"], False, ""),
    ("G) Noritake wall pocket", "Collectibles > Decorative", 25, 60, "medium", ["Hand-painted Noritake 'M' mark era pieces sell steadily"], ["Hairlines, crazing"], False, ""),
    ("G) Vintage Kewpie Doll Figurine Bisque Porcelain", "Collectibles > Figurines", 20, 50, "medium", ["Bisque Kewpies with Rose O'Neill marks fetch more"], ["Unmarked reproductions are common"], False, ""),
    ("G) Bob Dylan Another Side LP CS 8993 Columbia", "Music > Vinyl Records", 15, 40, "high", ["Early Columbia '360 Sound' pressing", "Dylan always moves"], ["Grade the vinyl; scratches kill value"], False, ""),
    ("G) VINTAGE Metal Calendar Bank - CITIZENS BANK", "Collectibles > Advertising", 20, 45, "medium", ["Advertising still banks with working calendar are a niche", "Local bank collectors"], ["Missing key, stuck calendar"], False, ""),
    ("G) cast plaster native wall hanging 1940's", "Collectibles > Decorative", 25, 60, "medium", ["1940s chalkware wall plaques sold in pairs do well"], ["Chips in plaster are hard to hide"], False, ""),
    ("G) YOUNG Folks SPEAKER 1882 Hardcover", "Books > Antiquarian & Collectible", 15, 35, "low", ["Decorative Victorian binding"], ["Foxing, loose hinges"], False, ""),
    ("1989 Upper Deck Ken Griffey Jr. #1 Rookie Card RC raw", "Collectibles > Trading Cards > Baseball", 25, 45, "high", ["The iconic junk-wax rookie; liquid at every grade", "Pack-fresh copies gem at a low rate but PSA 10s clear $1,000+"], ["Massive population; only a 9 or 10 moves the needle", "Counterfeits and trimmed copies exist"], False, ""),
    ("G) vintage antique knic knacs", "Collectibles > Decorative", 70, 120, "medium", ["One Deruta Italy hand-painted majolica mini vase carries the lot", "Delft and drip-glaze miniatures sell in groups"], ["Chips on the black glass vase feet", "Shell-art souvenir is near worthless"], False, ""),
]

DEMO_GRADING = {
    "1989 Upper Deck Ken Griffey Jr. #1 Rookie Card RC raw": {
        "applicable": True,
        "card": {"year": "1989", "set": "Upper Deck", "card_number": "1", "player_or_subject": "Ken Griffey Jr.", "parallel_or_variation": "base", "rookie": True},
        "condition": {"centering": "~55/45 L/R, ~60/40 T/B from the front scan", "corners": "sharp at 3; top-left slightly soft", "edges": "clean, no chipping visible", "surface": "no print lines visible; gloss intact; back not shown", "notes": "Back photo needed to rule out the common back-centering issue.", "photo_quality": "limited"},
        "grade_probabilities": {"psa10": 0.04, "psa9": 0.33, "psa8": 0.40, "psa7_or_below": 0.23},
        "predicted_grade": "PSA 8",
        "graded_comps": [
            {"grader": "PSA", "grade": "10", "price": 1250, "source": "PSA APR (demo)", "url": "https://www.psacard.com/auctionprices", "date": "Aug 2026"},
            {"grader": "PSA", "grade": "10", "price": 1180, "source": "eBay sold (demo)", "url": "https://www.ebay.com/sch/i.html?_nkw=1989+upper+deck+griffey+psa+10&LH_Sold=1&LH_Complete=1", "date": "Aug 2026"},
            {"grader": "PSA", "grade": "9", "price": 115, "source": "130point (demo)", "url": "https://130point.com/sales/", "date": "Aug 2026"},
            {"grader": "PSA", "grade": "9", "price": 105, "source": "eBay sold (demo)", "url": "https://www.ebay.com/sch/i.html?_nkw=1989+upper+deck+griffey+psa+9&LH_Sold=1&LH_Complete=1", "date": "Jul 2026"},
            {"grader": "PSA", "grade": "8", "price": 48, "source": "SportsCardsPro (demo)", "url": "https://www.sportscardspro.com/", "date": "Aug 2026"},
            {"grader": "PSA", "grade": "7", "price": 30, "source": "eBay sold (demo)", "url": "https://www.ebay.com/sch/i.html?_nkw=1989+upper+deck+griffey+psa+7&LH_Sold=1&LH_Complete=1", "date": "Aug 2026"},
        ],
        "pop": {"psa_total": 118000, "psa_10": 4600, "psa_9": 46000, "note": "Gem rate ~4%; enormous pop caps PSA 9 at ~$110 but PSA 10 holds four figures on demand."},
        "raw_value": 35,
        "recommended_grader": "PSA",
        "grading_notes": "Check back centering and for the '1989' print snow; measure for trimming (2.5 x 3.5 in); confirm the hologram on the back.",
    }
}

DEMO_ITEMS = {
    "G) vintage antique knic knacs": [
        {"name": "Hand-painted majolica miniature vase, 'Deruta Italy' on base", "maker_or_mark": "DERUTA ITALY (painted mark, read from the base)", "era": "1950s-70s", "est_low": 40, "est_high": 50, "confidence": 0.75, "note": "Deruta majolica miniatures with a clear mark sell steadily; check the foot rim for chips."},
        {"name": "Blue-and-white Delft miniature vase, windmill scene", "maker_or_mark": "Delft-style, likely Holland stamp", "era": "mid-century", "est_low": 8, "est_high": 15, "confidence": 0.6, "note": "Common souvenir size; sells best paired."},
        {"name": "Brown/blue drip-glaze miniature vase", "maker_or_mark": "unmarked, Japan-style glaze", "era": "1960s", "est_low": 8, "est_high": 15, "confidence": 0.5, "note": "Attractive glaze; unmarked keeps it modest."},
        {"name": "Souvenir stein with mountain transfer and chain", "maker_or_mark": "unread transfer", "era": "1950s", "est_low": 8, "est_high": 15, "confidence": 0.5, "note": "Souvenir ware; chain intact helps."},
        {"name": "Bird in glass dome paperweight/box", "maker_or_mark": "unmarked", "era": "1960s", "est_low": 6, "est_high": 12, "confidence": 0.4, "note": "Novelty; condition of the dome matters."},
        {"name": "Black glass footed miniature vase", "maker_or_mark": "unmarked", "era": "1930s-50s", "est_low": 5, "est_high": 10, "confidence": 0.5, "note": "Possible chip on one foot."},
        {"name": "White porcelain figurine (dog/bear)", "maker_or_mark": "unmarked", "era": "mid-century", "est_low": 4, "est_high": 8, "confidence": 0.4, "note": ""},
        {"name": "Pale blue miniature pitcher", "maker_or_mark": "unmarked", "era": "mid-century", "est_low": 3, "est_high": 6, "confidence": 0.4, "note": ""},
        {"name": "Shell-encrusted Florida souvenir vase", "maker_or_mark": "Florida souvenir label", "era": "1950s", "est_low": 2, "est_high": 5, "confidence": 0.5, "note": "Near worthless; include as a bonus in a group listing."},
    ]
}

AUCTIONS = [
    (775586, "SEPT 13 - UNCLAIMED PROPERTY / POLICE SEIZURES / GOV SURPLUS", "Washington Surplus Inc", "Tacoma", "WA", 0.15),
    (775689, "Tuesday Jewelry, Coins, Handbags & Collectibles", "A.J.C.A. LLC", "Fort Lauderdale", "FL", 0.18),
    (758007, "Coins and Estates Auction", "Gold Standard Auctions", "Dallas", "TX", 0.20),
    (776102, "Contractor Tool Liquidation - No Reserve", "Midwest Asset Recovery", "Columbus", "OH", 0.13),
    (776340, "Estate of a Collector: Mid-Century, Art & Music", "Bluebird Estate Sales", "Asheville", "NC", 0.17),
    (776411, "Farm & Construction Equipment Consignment", "Prairie Auction Co", "Lincoln", "NE", 0.10),
    (776550, "Weekly Electronics & Returns Pallet Auction", "QuickBid Liquidators", "Phoenix", "AZ", 0.15),
]


# Items whose resale number looks fine but whose market is genuinely stuck. These are the whole point
# of the liquidity layer: worth $40 and unsellable is a different thing from worth $40.
_ILLIQUID = ("Peloton", "oil painting", "Original oil", "encyclopedia", "Piano", "organ", "china cabinet",
             "Hummel", "Precious Moments", "Franklin Mint", "collector plate")


# Categories that are visibly warming or cooling over the demo's trend window, so the intel panel has
# something real to show rather than a flat line.
_DRIFT = {"Tools": 1, "Electronics": 1, "Sporting Goods": -1, "Furniture": -1, "Books": -1, "Music": 1}


def _demand_signals(title: str, demand: str, mid: float, rng: random.Random,
                    drift: int = 0, recency: float = 1.0) -> dict[str, Any]:
    """Plausible eBay sold/active counts. The point of the demo is that these differ wildly for items
    with similar price tags: that difference is what the intel layer surfaces."""
    stuck = any(w.lower() in title.lower() for w in _ILLIQUID)
    if stuck:
        sold, active = rng.randint(0, 4), rng.randint(60, 240)
        trend, note = "falling", "Everyone is trying to unload one; almost nobody is buying."
    elif demand == "high":
        sold, active = rng.randint(70, 260), rng.randint(25, 110)
        trend, note = rng.choice(["rising", "flat", "flat"]), "Steady, deep market; priced right it moves in days."
    elif demand == "medium":
        sold, active = rng.randint(14, 45), rng.randint(35, 160)
        trend, note = rng.choice(["flat", "flat", "falling"]), "Moves, but you are one of many sellers."
    else:
        sold, active = rng.randint(1, 8), rng.randint(30, 180)
        trend, note = rng.choice(["falling", "flat"]), "Thin market: a handful of sales a quarter."
    # Cheap smalls churn faster than their price suggests; expensive things always take longer.
    if mid < 40:
        sold = int(sold * 1.4) + 3
    if mid > 800:
        sold = max(1, int(sold * 0.4))
        active = int(active * 0.7)
    # `recency` is 0 (oldest sample in the window) to 1 (today). A warming category sells more and lists
    # less as you approach today; a cooling one does the reverse. This is what the trend arrows read.
    if drift:
        sold = max(0, round(sold * (1 + drift * 0.45 * recency)))
        active = max(1, round(active * (1 - drift * 0.25 * recency)))
        if drift > 0 and trend != "rising" and recency > 0.6:
            trend = "rising"
        elif drift < 0 and recency > 0.6:
            trend = "falling"
    return {
        "sold_90d": sold, "active_now": active,
        "sell_through": round(sold / (sold + active), 3) if sold + active else None,
        "median_days_to_sell": None,
        "watchers_typical": round(rng.uniform(0.5, 14), 1),
        "price_dispersion": round(rng.uniform(0.2, 1.1), 2),
        "trend": trend,
        "seasonality": "Sells best Oct-Dec" if rng.random() < 0.25 else "",
        "buyer_pool": "Collectors and resellers" if demand != "high" else "Broad retail demand",
        "note": note,
    }


def make_demo(seed: int = 7, now: float | None = None) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Return (normalized lots, valuations)."""
    rng = random.Random(seed)
    now = now or time.time()
    lots, vals = [], []
    lot_id = 320600000
    for idx, (title, cat_path, lo, hi, demand, drivers, risks, auth, est) in enumerate(CATALOG):
        # Some items appear in two auctions to show cross-auction dedupe/cache behaviour.
        copies = 2 if idx % 9 == 0 else 1
        penny = title.startswith("G) ")
        for c in range(copies):
            lot_id += rng.randint(1, 40)
            mid = (lo + hi) / 2
            # Bid as a fraction of resale value: mostly 30-90%, with a tail of real bargains.
            roll = rng.random()
            frac = rng.uniform(0.04, 0.2) if roll < 0.22 else rng.uniform(0.2, 0.5) if roll < 0.5 else rng.uniform(0.5, 1.1)
            high_bid = round(mid * frac / 5) * 5 if mid > 50 else round(mid * frac)
            if penny:
                high_bid = float(rng.choice([0, 1, 1, 2, 3]))
            bid_count = 0 if rng.random() < 0.25 else rng.randint(1, 24)
            if bid_count == 0:
                high_bid = 0.0
            opening = max(1.0, round(mid * 0.05 / 5) * 5) if mid > 100 else 1.0
            min_bid = (high_bid + max(1.0, round(high_bid * 0.1))) if high_bid else opening
            secs = rng.choice([rng.uniform(600, 3600), rng.uniform(3600, 6 * 3600), rng.uniform(6 * 3600, 24 * 3600),
                               rng.uniform(24 * 3600, 72 * 3600), rng.uniform(72 * 3600, 6 * 86400)])
            au = AUCTIONS[(idx + c * 3) % len(AUCTIONS)]
            top = cat_path.split(" > ")[0]
            lots.append({
                "id": lot_id, "item_id": lot_id * 3, "lot_number": str(100 + idx * 3 + c), "title": title,
                "description": f"{title}. From {au[1].lower()}. Sold as-is where-is; preview encouraged. "
                               f"Buyer's premium {int(au[5] * 100)}%. Pickup within 7 days.",
                "estimate": est, "quantity": 1, "bid_amount_type": None,
                "image": None, "image_full": None, "picture_count": rng.randint(2, 9), "shipping_offered": rng.random() < 0.5,
                "url": f"https://hibid.com/lot/{lot_id}/demo-lot",
                "auction_id": au[0], "auction_name": au[1],
                "auction_url": f"https://hibid.com/catalog/{au[0]}/demo", "auctioneer": au[2], "auctioneer_id": 1000 + au[0] % 100,
                "city": au[3], "state": au[4], "zip": None, "distance_miles": None,
                "buyer_premium_rate": au[5], "buyer_premium_text": f"{int(au[5] * 100)}%", "currency": "USD",
                "bid_close": None, "bid_type": "INTERNET_ABSENTEE",
                "high_bid": float(high_bid), "min_bid": float(min_bid), "bid_count": bid_count,
                "time_left_seconds": secs, "time_left_text": None, "ends_at": now + secs, "is_closed": False,
                "is_live": False, "status": "OPEN", "reserve_satisfied": True, "soft_close_minutes": 2,
                "category_id": 10000 + idx, "category": top, "category_path": cat_path, "fetched_at": now,
                "demo": True,
            })
            # Spread valuations back across the trend window so the intel panel shows a real time series
            # rather than one flat point; `recency` is 0 for the oldest sample and 1 for today.
            age_days = rng.uniform(0, 18)
            recency = 1 - age_days / 18
            valued_at = now - age_days * 86400
            conf = 0.55 if auth else 0.8
            if demand == "low":
                conf = 0.35
            comps = []
            for k in range(rng.randint(3, 5)):
                price = round(rng.uniform(lo * 0.9, hi * 1.1), 2)
                comps.append({"title": f"{title} (sold)", "price": price, "source": "ebay_sold (demo)",
                              "url": "https://www.ebay.com/sch/i.html?_nkw=" + title.replace(" ", "+") + "&LH_Sold=1&LH_Complete=1",
                              "date": f"Aug {rng.randint(1, 28)}, 2026", "note": "demo comp"})
            vals.append({
                "lot_id": lot_id, "title_key": title_key(title, 1), "identified_item": title,
                "brand": title.split()[0], "model": "", "low": float(lo), "mid": float(mid), "high": float(hi),
                "currency": "USD", "confidence": conf,
                "confidence_reason": "Demo valuation: typical sold-comp range for this item in used/good condition.",
                "method": "claude+web", "demand": demand, "days_to_sell": {"high": 7, "medium": 21, "low": 60}[demand],
                "demand_signals": _demand_signals(title, demand, mid, rng, drift=_DRIFT.get(top, 0),
                                                  recency=recency),
                "category": top,
                "best_channel": "eBay" if mid < 3000 else "Facebook Marketplace / dealer",
                "condition_assumption": "Used, good, fully functional unless the listing says otherwise.",
                "value_drivers": drivers, "risks": risks,
                "rationale": f"Recent sold comps cluster between ${lo:,.0f} and ${hi:,.0f}. {('Authentication required before relying on this number. ' if auth else '')}"
                             f"Demand is {demand}.",
                "comps": comps, "search_query": title, "authenticity_risk": auth, "bulk_lot": False, "unit_count": 1,
                "sources_consulted": ["ebay_sold (demo)"], "model_used": "demo", "created_at": valued_at, "error": "",
                "items": DEMO_ITEMS.get(title, []),
                "grading": DEMO_GRADING.get(title),
                "standout_item": DEMO_ITEMS[title][0]["name"] if title in DEMO_ITEMS else "",
                "images_used": 3 if title in DEMO_ITEMS else 0,
                "listing": {
                    "title": (title.replace("G) ", "") + " " + " ".join(cat_path.split(" > ")[-1:]))[:80],
                    "category": cat_path, "condition": "Used",
                    "item_specifics": [{"name": "Brand", "value": title.replace("G) ", "").split()[0]}, {"name": "Era", "value": "Vintage" if "intage" in title or "ntique" in title else "Modern"}],
                    "description": f"{title.replace('G) ', '')}. Used, good condition as pictured; see photos for details. Ships within 1 business day, carefully packed.",
                    "format": "fixed_price", "price_quick": round(lo, 0), "price_market": round(mid, 0), "price_patient": round(hi, 0),
                    "best_offer_floor": round(lo * 0.9, 0), "auction_start": 0,
                    "shipping_weight_oz": 12 if mid < 100 else 80, "packaging": "small box" if mid < 100 else "medium box",
                    "shipping_cost_estimate": 6.5 if mid < 60 else 14.0 if mid < 500 else 0.0,
                    "keywords": [w for w in title.replace("G) ", "").split() if len(w) > 3][:6],
                    "alt_titles": [(" ".join(cat_path.split(" > ")[-1:]) + " " + title.replace("G) ", ""))[:80], (title.replace("G) ", "") + " " + ("Vintage" if "intage" in title or "ntique" in title else "Used"))[:80]],
                    "condition_description": "Used; light surface wear consistent with age, no cracks or repairs noted.",
                    "photo_checklist": ["Front, straight on, neutral background", "Back", "Base or backstamp close-up", "Any flaw close-up", "Scale shot with ruler"],
                    "seo_notes": f"Buyers search '{title.replace('G) ', '').split(',')[0]}' plus the maker; the {cat_path.split(' > ')[-1]} leaf category is where the sold comps sit. Fill Brand, Type, Era and Country specifics; they are search filters.",
                    "promoted_rate": 0.0 if mid > 300 else 0.03,
                    "best_time_to_list": "Sunday 6-9pm ET" if mid > 100 else "Any evening; fixed price with Best Offer",
                },
            })
    return lots, vals


# (category, n, hammer ratio spread, sales) -- a plausible few weeks of history: the valuer is
# well calibrated on commodity electronics and tools, and runs optimistic on furniture and art.
_OUTCOME_MIX = [
    ("Electronics", 22, (0.18, 0.55), [(0.95, 1), (1.05, 1), (0.9, 1), (1.1, 1), (1.0, 1), (0.97, 1)]),
    ("Tools", 17, (0.2, 0.6), [(1.02, 1), (0.93, 1), (1.08, 1), (0.99, 1), (1.04, 1)]),
    ("Collectibles", 14, (0.25, 0.85), [(0.8, 1), (1.15, 1), (0.7, 1)]),
    ("Furniture", 11, (0.7, 1.4), []),          # consistently outbid at our own number: inflated
    ("Jewelry & Watches", 9, (0.3, 0.9), []),
    ("Art", 6, (0.8, 1.6), []),                  # too few to act on yet, but visibly bad
    ("Books", 5, (0.2, 0.7), []),
]

# How long things ACTUALLY take to sell in each category, as a multiple of what the model predicted.
# Electronics is roughly honest, Collectibles is optimistic, Furniture is badly optimistic (bulky,
# local-pickup-only buyers) and Tools actually beat the estimate.
_SPEED_REALITY = {"Electronics": 1.05, "Tools": 0.7, "Collectibles": 1.8, "Furniture": 2.6,
                  "Jewelry & Watches": 1.4, "Art": 3.0, "Books": 2.2}


def make_demo_outcomes(seed: int = 11, now: float | None = None) -> list[dict[str, Any]]:
    """Closed lots with what we predicted vs. what they actually realized."""
    rng = random.Random(seed)
    now = now or time.time()
    out: list[dict[str, Any]] = []
    lot_id = 320500000
    for cat, n, (lo_r, hi_r), sales in _OUTCOME_MIX:
        for i in range(n):
            lot_id += rng.randint(3, 60)
            mid = round(rng.uniform(30, 400), 2)
            net = round(mid * 0.85, 2)
            hammer = round(net * rng.uniform(lo_r, hi_r) / 1.15, 2)  # back out the premium
            rec: dict[str, Any] = {
                "lot_id": lot_id, "title": f"{cat} lot {i + 1}", "category": cat,
                "closed_at": now - rng.uniform(1, 21) * 86400,
                "predicted_low": round(mid * 0.8, 2), "predicted_mid": mid, "predicted_high": round(mid * 1.2, 2),
                "predicted_net": net, "confidence": round(rng.uniform(0.55, 0.85), 2), "method": "claude+web",
                "score": round(rng.uniform(15, 80), 1), "hammer": hammer,
                "landed_at_hammer": round(hammer * 1.15, 2),
                "bought": None, "bought_price": None, "sale_price": None, "sale_at": None,
                "sale_channel": "", "notes": "", "recorded_at": now,
            }
            # What the liquidity model would have predicted before you listed it.
            predicted_days = round(rng.uniform(6, 40), 1)
            rec["predicted_days"] = predicted_days
            rec["listed_at"] = None
            rec["list_price"] = None
            rec["still_listed"] = None
            rec["views"] = None
            rec["watchers"] = None
            if i < len(sales):
                ratio, _ = sales[i]
                actual_days = max(1.0, predicted_days * _SPEED_REALITY.get(cat, 1.0) * rng.uniform(0.75, 1.3))
                listed_at = rec["closed_at"] + rng.uniform(1, 4) * 86400  # picked up, photographed, listed
                rec["bought"] = True
                rec["bought_price"] = rec["landed_at_hammer"]
                rec["sale_price"] = round(mid * ratio, 2)
                rec["listed_at"] = listed_at
                rec["list_price"] = round(mid * 1.05, 2)
                rec["sale_at"] = listed_at + actual_days * 86400
                rec["still_listed"] = False
                rec["views"] = rng.randint(40, 600)
                rec["watchers"] = rng.randint(1, 25)
                rec["sale_channel"] = "eBay"
            elif i < len(sales) + 2 and cat in ("Furniture", "Collectibles", "Art"):
                # Bought, listed, and still sitting. Right-censored evidence the loop must not ignore:
                # a model that only learns from things that sold concludes everything sells.
                rec["bought"] = True
                rec["bought_price"] = rec["landed_at_hammer"]
                rec["listed_at"] = now - rng.uniform(65, 150) * 86400
                rec["list_price"] = round(mid * 1.05, 2)
                rec["still_listed"] = True
                rec["views"] = rng.randint(2, 40)      # the "max promotion, no views" case
                rec["watchers"] = rng.randint(0, 2)
                rec["sale_channel"] = "eBay"
            out.append(rec)
    return out


# Market numbers for the demo playbook. Stand-ins for what a research pass measures, chosen to show the
# discrimination the model is for: letter openers move (deep and fast), bank giveaways are crowded, and
# obsolete notes are worth more per piece but take most of a year to sell.
DEMO_RESEARCH = {
    "advertising-letter-openers": (30.0, 140, 55, 9),
    "bank-advertising-giveaways": (38.0, 90, 140, 22),
    "celluloid-advertising-pocket-mirrors": (26.0, 75, 60, 14),
    "advertising-and-figural-pinback-buttons": (22.0, 210, 90, 11),
    "obsolete-bank-notes-and-scrip": (55.0, 60, 300, 45),
    "antique-stock-and-bond-certificates": (24.0, 110, 260, 38),
    "railroadiana-smalls": (46.0, 95, 120, 26),
    "advertising-thermometers-and-rulers": (34.0, 55, 85, 24),
}


def make_demo_theses(settings, now: float | None = None) -> list[dict[str, Any]]:
    """The seed playbook with plausible research filled in on some of it, so the panel has both
    researched niches with bid ceilings and un-researched ones still showing a blank."""
    from .playbook import normalize_thesis, refresh_thesis
    from .seeds import SEED_THESES

    now = now or time.time()
    out = []
    for seed in SEED_THESES:
        t = normalize_thesis(dict(seed, origin="seed"), settings, now)
        sim = DEMO_RESEARCH.get(t["id"])
        if sim:
            px, sold, active, days = sim
            t = refresh_thesis(dict(t, price_median=px, price_p25=round(px * 0.65, 2),
                                    price_p75=round(px * 1.6, 2), sold_90d=sold, active_now=active,
                                    median_days_to_sell=days, researched_at=now - 3 * 86400,
                                    sources=["eBay sold listings (demo)"], confidence=0.65),
                              settings, now)
        out.append(t)
    return out


def make_demo_playbook_outcomes(now: float | None = None) -> list[dict[str, Any]]:
    """Round trips that match playbook niches, so the panel shows realized performance and the
    flywheel has something to propose from."""
    now = now or time.time()
    rows = [
        ("Antique c1918 Citizens Mutual Auto Insurance Howell MI Advertising Letter Opener", 1.15, 30.0, 0.2),
        ("Vintage advertising letter opener Farmers State Bank Iowa celluloid handle", 2.30, 26.0, 3.0),
        ("Antique brass advertising letter opener hardware store Ohio", 1.15, 22.0, 6.0),
        ("Antique advertising letter opener funeral home Indiana figural", 3.45, 41.0, 1.0),
        ("Celluloid advertising pocket mirror brewery pretty girl", 2.30, 34.0, 9.0),
        ("Odd Fellows fraternal watch fob gold filled antique", 4.60, 38.0, 21.0),
    ]
    out = []
    lot_id = 320400000
    for i, (title, paid, sold, days) in enumerate(rows):
        lot_id += 37
        listed = now - (40 - i * 4) * 86400
        out.append({
            "lot_id": lot_id, "title": title, "category": "Collectibles",
            "closed_at": listed - 2 * 86400,
            "predicted_low": sold * 0.7, "predicted_mid": sold * 0.95, "predicted_high": sold * 1.3,
            "predicted_net": sold * 0.8, "confidence": 0.6, "method": "claude+web", "score": 70.0,
            "hammer": round(paid / 1.15, 2), "landed_at_hammer": paid,
            "bought": True, "bought_price": paid, "sale_price": sold,
            "sale_at": listed + days * 86400, "sale_channel": "eBay", "notes": "",
            "listed_at": listed, "list_price": round(sold * 1.1, 2), "still_listed": False,
            "views": 120 + i * 30, "watchers": 3 + i, "predicted_days": 12.0,
            "recorded_at": now,
        })
    return out


def load_demo(store, settings=None) -> int:
    from .config import load as load_settings

    settings = settings or load_settings()
    lots, vals = make_demo()
    store.upsert_lots(lots)
    for v in vals:
        store.save_valuation(v["lot_id"], v)
    for o in make_demo_outcomes():
        store.save_outcome(o)
    for o in make_demo_playbook_outcomes():
        store.save_outcome(o)
    store.save_theses(make_demo_theses(settings))
    # Grade the playbook against those outcomes so the demo shows realized performance straight away.
    from .playbook import apply_outcome_stats
    store.save_theses(apply_outcome_stats(store.theses(), store.outcomes(), {}))
    return len(lots)


# ----------------------------------------------------------------------------- raw GraphQL shape
def to_raw_graphql(lot: dict[str, Any]) -> dict[str, Any]:
    """Inverse of hibid.normalize_lot, for the mock HiBid server used in tests."""
    return {
        "id": lot["id"], "itemId": lot["item_id"], "lotNumber": lot["lot_number"], "lead": lot["title"],
        "description": lot["description"], "estimate": lot["estimate"], "bidAmount": lot["high_bid"],
        "bidQuantity": 1, "quantity": lot["quantity"], "ringNumber": 1, "shippingOffered": lot["shipping_offered"],
        "pictureCount": lot["picture_count"],
        "featuredPicture": {"description": "", "fullSizeLocation": None, "hdThumbnailLocation": None, "thumbnailLocation": None},
        "category": {"id": lot["category_id"], "baseCategoryId": 1, "parentCategoryId": None,
                     "categoryName": lot["category_path"].split(" > ")[-1], "fullCategory": lot["category_path"], "uRLPath": ""},
        "lotState": {
            "bidCount": lot["bid_count"], "biddingExtended": False, "bidMax": None, "buyNow": None, "choiceType": None,
            "highBid": lot["high_bid"], "isArchived": False, "isClosed": lot["is_closed"], "isHidden": False,
            "isLive": False, "isNotYetLive": False, "isOnLiveCatalog": False, "isPosted": True,
            "minBid": lot["min_bid"], "priceRealized": None, "priceRealizedMessage": None, "productStatus": None,
            "quantitySold": 0, "reserveSatisfied": True, "sealed": False, "showReserveStatus": False,
            "softCloseMinutes": 2, "softCloseSeconds": 0, "status": "OPEN", "timeLeft": "1h 2m",
            "timeLeftLead": "", "timeLeftSeconds": int(lot["time_left_seconds"]), "timeLeftTitle": "Time Left",
            "timeLeftWithLimboSeconds": int(lot["time_left_seconds"]),
        },
        "auction": {
            "id": lot["auction_id"], "eventName": lot["auction_name"], "eventAddress": "", "eventCity": lot["city"],
            "eventState": lot["state"], "eventZip": None, "eventDateBegin": None, "eventDateEnd": None,
            "eventDateInfo": "", "bidOpenDateTime": None, "bidCloseDateTime": None, "bidType": lot["bid_type"],
            "buyerPremium": lot["buyer_premium_text"], "buyerPremiumRate": lot["buyer_premium_rate"] * 100,
            "showBuyerPremium": True, "currencyAbbreviation": "USD", "lotCount": 100, "hidden": False,
            "sourceType": "AF", "distanceMiles": None, "bidAmountType": None,
            "auctioneer": {"id": lot["auctioneer_id"], "name": lot["auctioneer"], "city": lot["city"], "state": lot["state"],
                           "phone": "", "email": "", "internetAddress": ""},
            "auctionOptions": {"bidding": True, "catalog": True, "liveCatalog": False, "shippingType": "", "preview": "", "webcast": False, "useLotNumber": True},
            "auctionState": {"auctionStatus": "OPEN", "openLotCount": 100, "timeToOpen": 0},
            "bidIncrements": [{"minBidIncrement": 1, "upToAmount": 100}],
        },
    }
