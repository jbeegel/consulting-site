"""Runtime settings. Everything is an environment variable so the tool can run anywhere."""
from __future__ import annotations

import os
from dataclasses import dataclass, field


def _f(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


def _b(name: str, default: bool) -> bool:
    v = os.environ.get(name)
    if v is None:
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


@dataclass
class Settings:
    # --- sources
    hibid_graphql: str = field(default_factory=lambda: os.environ.get("ARB_HIBID_GRAPHQL", "https://hibid.com/graphql"))
    hibid_site: str = field(default_factory=lambda: os.environ.get("ARB_HIBID_SITE", "https://hibid.com"))
    request_delay: float = field(default_factory=lambda: _f("ARB_REQUEST_DELAY", 0.6))

    # --- storage
    db_path: str = field(default_factory=lambda: os.environ.get("ARB_DB", "arb.sqlite3"))

    # --- valuation
    valuer: str = field(default_factory=lambda: os.environ.get("ARB_VALUER", "auto"))  # auto|claude|ebay|estimate|none
    model: str = field(default_factory=lambda: os.environ.get("ARB_MODEL", "claude-opus-5"))
    web_search: bool = field(default_factory=lambda: _b("ARB_WEB_SEARCH", True))
    ebay_sold: bool = field(default_factory=lambda: _b("ARB_EBAY_SOLD", True))
    valuation_ttl_days: float = field(default_factory=lambda: _f("ARB_VALUATION_TTL_DAYS", 7))
    valuation_workers: int = field(default_factory=lambda: int(_f("ARB_VALUATION_WORKERS", 4)))
    vision: bool = field(default_factory=lambda: _b("ARB_VISION", True))  # send lot photos to the model
    max_images: int = field(default_factory=lambda: int(_f("ARB_MAX_IMAGES", 4)))

    # --- cost model (fractions, not percents)
    default_buyer_premium: float = field(default_factory=lambda: _f("ARB_BUYER_PREMIUM", 0.15))
    sales_tax: float = field(default_factory=lambda: _f("ARB_SALES_TAX", 0.0))
    pickup_cost: float = field(default_factory=lambda: _f("ARB_PICKUP_COST", 0.0))  # $ per lot (gas, time)
    resale_fee: float = field(default_factory=lambda: _f("ARB_RESALE_FEE", 0.15))  # marketplace + payment fees
    resale_shipping: float = field(default_factory=lambda: _f("ARB_RESALE_SHIP", 0.0))  # $ per item you absorb
    spread_full: float = field(default_factory=lambda: _f("ARB_SPREAD_FULL", 150.0))  # $ net spread that earns full marks
    min_spread: float = field(default_factory=lambda: _f("ARB_MIN_SPREAD", 10.0))  # below this the score is scaled down
    sweet_spot_max_landed: float = field(default_factory=lambda: _f("ARB_SWEET_MAX_LANDED", 6.0))
    sweet_spot_min_net: float = field(default_factory=lambda: _f("ARB_SWEET_MIN_NET", 15.0))
    # grading economics (trading cards)
    grading: bool = field(default_factory=lambda: _b("ARB_GRADING", True))
    grading_fee: float = field(default_factory=lambda: _f("ARB_GRADING_FEE", 25.0))  # PSA/SGC/BGS value tier per card
    grading_ship: float = field(default_factory=lambda: _f("ARB_GRADING_SHIP", 8.0))  # your share of round-trip shipping/insurance
    grading_days: int = field(default_factory=lambda: int(_f("ARB_GRADING_DAYS", 60)))
    # eBay fee model (see scoring.listing_economics)
    ebay_fvf: float = field(default_factory=lambda: _f("ARB_EBAY_FVF", 0.136))
    ebay_fvf_media: float = field(default_factory=lambda: _f("ARB_EBAY_FVF_MEDIA", 0.153))  # books, music, movies
    ebay_per_order: float = field(default_factory=lambda: _f("ARB_EBAY_PER_ORDER", 0.30))
    ebay_per_order_small: float = field(default_factory=lambda: _f("ARB_EBAY_PER_ORDER_SMALL", 0.40))  # orders <= $10
    ebay_promoted: float = field(default_factory=lambda: _f("ARB_EBAY_PROMOTED", 0.0))  # optional ad rate
    packaging_cost: float = field(default_factory=lambda: _f("ARB_PACKAGING", 1.0))

    # --- default search scope
    zip: str | None = field(default_factory=lambda: os.environ.get("ARB_ZIP") or None)
    miles: int | None = field(default_factory=lambda: int(os.environ["ARB_MILES"]) if os.environ.get("ARB_MILES") else None)
    country: str | None = field(default_factory=lambda: os.environ.get("ARB_COUNTRY") or None)
    state: str | None = field(default_factory=lambda: os.environ.get("ARB_STATE") or None)

    @property
    def anthropic_available(self) -> bool:
        return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


def load() -> Settings:
    return Settings()
