"""eBay sold/completed listings as comps.

eBay's sold-listing search page is server-rendered HTML that we can parse without an API key.
This is best-effort: eBay may rate-limit or serve a challenge page; on any failure we return [].
If you have eBay developer keys you can swap in the Browse/Marketplace Insights APIs here.
"""
from __future__ import annotations

import html
import logging
import re
import statistics
import time
import urllib.parse
from typing import Any

import httpx

from .base import Comp

log = logging.getLogger(__name__)

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
_ITEM = re.compile(r'<li class="s-item[^"]*"[^>]*>(.*?)</li>', re.S)
_TITLE = re.compile(r'<(?:div|span|h3) class="s-item__title[^"]*"[^>]*>(.*?)</(?:div|span|h3)>', re.S)
_PRICE = re.compile(r'<span class="s-item__price"[^>]*>(.*?)</span>', re.S)
_LINK = re.compile(r'<a class="s-item__link"[^>]*href="([^"]+)"')
_DATE = re.compile(r'(?:Sold|Ended)\s+([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})')
_TAG = re.compile(r"<[^>]+>")
_MONEY = re.compile(r"[\d,]+(?:\.\d{2})?")


def sold_search_url(query: str) -> str:
    q = urllib.parse.quote_plus(query)
    return f"https://www.ebay.com/sch/i.html?_nkw={q}&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=60"


def clean_query(title: str, max_words: int = 8) -> str:
    t = re.sub(r"\(.*?\)|\[.*?\]", " ", title or "")
    t = re.sub(r"[^A-Za-z0-9\-\.\s]", " ", t)
    words = [w for w in t.split() if len(w) > 1]
    junk = {"lot", "of", "the", "and", "with", "new", "nib", "nwt", "untested", "as", "is", "read"}
    words = [w for w in words if w.lower() not in junk]
    return " ".join(words[:max_words])


def fetch_sold_comps(query: str, *, limit: int = 30, timeout: float = 20.0) -> list[Comp]:
    if not query.strip():
        return []
    url = sold_search_url(query)
    try:
        r = httpx.get(url, headers={"user-agent": UA, "accept-language": "en-US,en;q=0.9"}, timeout=timeout,
                      follow_redirects=True)
        if r.status_code != 200 or "s-item" not in r.text:
            log.info("ebay sold search: no parsable results (%s)", r.status_code)
            return []
        body = r.text
    except httpx.HTTPError as e:
        log.info("ebay sold search failed: %s", e)
        return []
    comps: list[Comp] = []
    for block in _ITEM.findall(body):
        t = _TITLE.search(block)
        p = _PRICE.search(block)
        if not t or not p:
            continue
        title = html.unescape(_TAG.sub("", t.group(1))).strip()
        if title.lower().startswith("shop on ebay"):
            continue
        price_txt = html.unescape(_TAG.sub("", p.group(1)))
        m = _MONEY.search(price_txt)
        if not m:
            continue
        price = float(m.group(0).replace(",", ""))
        link = _LINK.search(block)
        d = _DATE.search(html.unescape(_TAG.sub(" ", block)))
        comps.append(Comp(title=title, price=price, source="ebay_sold",
                          url=(link.group(1).split("?")[0] if link else url), date=d.group(1) if d else ""))
        if len(comps) >= limit:
            break
    return comps


def summarize(comps: list[Comp]) -> dict[str, Any]:
    prices = sorted(c.price for c in comps if c.price > 0)
    if not prices:
        return {"n": 0}
    q = statistics.quantiles(prices, n=4) if len(prices) >= 4 else [prices[0], statistics.median(prices), prices[-1]]
    return {"n": len(prices), "p25": q[0], "median": statistics.median(prices), "p75": q[-1],
            "min": prices[0], "max": prices[-1]}


def polite_sleep(seconds: float = 1.5) -> None:
    time.sleep(seconds)
