"""Command line: scan, value, top, serve, refresh, demo."""
from __future__ import annotations

import argparse
import logging
import sys
import time
import webbrowser

from .config import load
from .db import Store
from .playbook import match_theses
from .scanner import Scanner
from .scoring import score_lot


def _fmt_time(secs):
    if secs is None:
        return "?"
    secs = int(secs)
    if secs < 3600:
        return f"{secs // 60}m"
    if secs < 86400:
        return f"{secs // 3600}h{(secs % 3600) // 60:02d}m"
    return f"{secs // 86400}d{(secs % 86400) // 3600}h"


def cmd_scan(args, s, store):
    sc = Scanner(s, store)
    print(f"Scanning HiBid: status={args.status} window={args.hours}h category={args.category} "
          f"search={args.search!r} zip={args.zip or s.zip} max_pages={args.max_pages}")
    st = sc.scan(status=args.status, hours=args.hours, category=args.category, search_text=args.search,
                 zip=args.zip, miles=args.miles, max_pages=args.max_pages, value=not args.no_value,
                 max_value=args.max_value)
    if st.get("error"):
        print("ERROR:", st["error"], file=sys.stderr)
        sys.exit(1)
    print(f"Done: {st['lots_seen']} lots in window, {st['lots_valued']} newly valued. Run `python -m arb top`.")


def cmd_value(args, s, store):
    from .valuation import ValuationPipeline
    lots = store.lots(only_unvalued=True, ends_before=time.time() + args.hours * 3600 if args.hours else None)
    print(f"{len(lots)} unvalued open lots; valuing up to {args.limit}")
    pipe = ValuationPipeline(s, store)
    n = pipe.value_many(lots, max_lots=args.limit,
                        progress=lambda d, t, l: print(f"  [{d}/{t}] {l.get('title', '')[:70]}"))
    print(f"valued {n}")


def cmd_top(args, s, store):
    now = time.time()
    lots = store.lots(ends_after=now - 60, ends_before=(now + args.hours * 3600) if args.hours else None)
    vals = store.valuations_for([l["id"] for l in lots])
    rows = []
    for l in lots:
        v = vals.get(l["id"])
        if not v:
            continue
        sc = score_lot(l, v, s, now=now)
        if sc["score"] >= args.min_score:
            rows.append((sc, l, v))
    rows.sort(key=lambda r: r[0]["score"], reverse=True)
    print(f"{'score':>5} {'heat':<5} {'left':>7} {'next':>8} {'landed':>8} {'resale':>8} {'x':>5} {'spread':>8} {'conf':>4}  title")
    for sc, l, v in rows[: args.limit]:
        print(f"{sc['score']:5.0f} {sc['heat']:<5} {_fmt_time(sc['seconds_left']):>7} {sc['next_bid']:8.0f} "
              f"{sc['landed_cost']:8.0f} {v['mid']:8.0f} {sc['ratio']:5.1f} {sc['spread']:8.0f} {sc['confidence']:4.1f}  "
              f"{l['title'][:60]}  {l['url']}")
    if not rows:
        print("No valued lots yet. Run `python -m arb scan` first.")


def cmd_serve(args, s, store):
    import uvicorn
    from .server import create_app
    app = create_app(s, store)
    url = f"http://{args.host}:{args.port}"
    print(f"Dashboard: {url}")
    if args.open:
        webbrowser.open(url)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


def cmd_refresh(args, s, store):
    sc = Scanner(s, store)
    now = time.time()
    lots = store.lots(ends_after=now - 60, ends_before=now + args.hours * 3600)
    print(f"refreshing live state for {len(lots)} lots closing within {args.hours}h")
    n = sc.refresh_many([l["id"] for l in lots][: args.limit])
    print(f"refreshed {n}")


def cmd_demo(args, s, store):
    from .demo import load_demo
    n = load_demo(store, s)
    print(f"loaded {n} demo lots with valuations into {s.db_path}. Run `python -m arb serve`.")


def cmd_export(args, s, store):
    from pathlib import Path
    from .export import export_html
    out = export_html(s, store, Path(args.out))
    print(f"wrote {out} ({out.stat().st_size // 1024} KB). Open it in a browser or share it.")


def cmd_settle(args, s, store):
    sc = Scanner(s, store)
    n = sc.settle_closed_lots(limit=args.limit)
    print(f"settled {n} closed lots into the report card")
    cmd_report(args, s, store)


def cmd_report(args, s, store):
    from .calibration import build_report
    rep = build_report(store.outcomes(), s)
    t = rep["totals"]
    print(f"\n{t['closed']} closed lots graded, {t['sold']} sales recorded"
          + (f", {t['realized_profit']:+,.2f} realized" if t["realized_profit"] is not None else ""))
    print(f"{'category':<24}{'closed':>7}{'outbid':>8}{'sales':>7}{'act/pred':>10}{'adjust':>8}  basis")
    for c in rep["categories"] + [rep["global"]]:
        name = "ALL" if c["category"] == "__all__" else c["category"][:23]
        over = f"{c['overshoot_rate'] * 100:.0f}%" if c["overshoot_rate"] is not None else "-"
        sale = f"{c['median_sale_ratio']:.2f}" if c["median_sale_ratio"] is not None else "-"
        print(f"{name:<24}{c['n_closed']:>7}{over:>8}{c['n_sold'] or '-':>7}{sale:>10}{'x%.2f' % c['bias']:>8}  {c['basis']}")
    liq = rep["liquidity"]
    measured = [c for c in liq["categories"] if c["basis"] == "measured"]
    if measured:
        print(f"\nSpeed calibration (how long things really take vs. what we said)")
        print(f"{'category':<24}{'sold':>6}{'observed':>10}{'predicted':>11}{'adjust':>8}")
        for c in measured:
            obs = f"{c['observed_days']:.0f}d" if c["observed_days"] is not None else "-"
            pred = f"{c['predicted_days']:.0f}d" if c["predicted_days"] is not None else "-"
            print(f"{c['category'][:23]:<24}{c['n_sold']:>6}{obs:>10}{pred:>11}{'x%.2f' % c['days_multiplier']:>8}")


def cmd_intel(args, s, store):
    """Market intel: which categories move, where capital turns fastest, what looks good but is stuck."""
    sc = Scanner(s, store)
    board = sc.intel()
    liq = board["liquidity"]
    print(f"\nMarket intel over the last {board['window_days']} days")

    print(f"\n{'category':<24}{'liq':>6}{'to sell':>10}{'sell-thru':>11}{'trend':>10}{'n':>6}")
    for t in board["trends"][:15]:
        st = f"{t['sell_through'] * 100:.0f}%" if t["sell_through"] is not None else "-"
        days = f"{t['days_p50']:.0f}d" if t["days_p50"] is not None else "-"
        arrow = {"warming": "up", "cooling": "down", "steady": "flat", "new": "new"}[t["direction"]]
        chg = f" {t['change']:+.0f}" if t["change"] is not None else ""
        print(f"{t['category'][:23]:<24}{t['liquidity'] or 0:>6.0f}{days:>10}{st:>11}{arrow + chg:>10}{t['n']:>6}")

    if board["velocity_leaders"]:
        print("\nFastest money right now (profit per dollar of capital per month)")
        for v in board["velocity_leaders"][:8]:
            print(f"  {v['monthly_roi'] * 100:>7.0f}%/mo  {v['liquidity_grade']}  {v['eta']:<12}"
                  f"${v['landed_cost']:>7.2f} -> +${v['spread']:<6} {v['title'][:52]}")

    if board["value_traps"]:
        print("\nValued high, but nobody is buying")
        for v in board["value_traps"][:8]:
            print(f"  {v['liquidity_grade']}  ${v['mid'] or 0:>7.0f}  {v['eta']:<12}{v['title'][:44]}  ({v['reason']})")

    measured = [c for c in liq["categories"] if c["basis"] == "measured"]
    if measured or liq["realized_monthly_roi"] is not None:
        print(f"\nYour own listings ({'x%.2f' % liq['global']['days_multiplier']} vs the model overall)")
        print(f"{'category':<24}{'listed':>8}{'sold':>6}{'observed':>10}{'predicted':>11}{'30d rate':>10}{'stuck':>7}")
        for c in liq["categories"][:12] + [liq["global"]]:
            name = "ALL" if c["category"] == "__all__" else c["category"][:23]
            obs = f"{c['observed_days']:.0f}d" if c["observed_days"] is not None else "-"
            pred = f"{c['predicted_days']:.0f}d" if c["predicted_days"] is not None else "-"
            rate = f"{c['sell_rate_30d'] * 100:.0f}%" if c["sell_rate_30d"] is not None else "-"
            print(f"{name:<24}{c['n_listed']:>8}{c['n_sold']:>6}{obs:>10}{pred:>11}{rate:>10}{c['stuck']:>7}")
        if liq["realized_monthly_roi"] is not None:
            print(f"\nRealized return on capital: {liq['realized_monthly_roi'] * 100:.0f}%/month (median round trip)")


def cmd_playbook(args, s, store):
    """The niches we hunt, and the most you can pay for each."""
    sc = Scanner(s, store)
    if args.review:
        out = sc.playbook_review()
        rows, proposed = out["theses"], out["proposed"]
    else:
        rows, proposed = sc.theses(), []
    rows.sort(key=lambda t: (-(t.get("max_bid") or 0), t.get("name", "")))

    print(f"\n{'niche':<34}{'pay up to':>10}{'sells for':>11}{'liq':>5}{'in':>7}{'sold/active':>13}  basis")
    for t in rows:
        bid = f"${t['max_bid']:.2f}" if t.get("max_bid") else "-"
        px = f"${t['price_median']:.0f}" if t.get("price_median") else "-"
        liq = t.get("liquidity_grade") or "-"
        days = f"{t['days_p50']:.0f}d" if t.get("days_p50") else "-"
        vol = (f"{int(t['sold_90d'])}/{int(t['active_now'])}"
               if t.get("sold_90d") is not None and t.get("active_now") is not None else "-")
        basis = "researched" if t.get("researched_at") else "not yet researched"
        print(f"{t['name'][:33]:<34}{bid:>10}{px:>11}{liq:>5}{days:>7}{vol:>13}  {basis}")

    unresearched = [t for t in rows if not t.get("researched_at")]
    if unresearched:
        print(f"\n{len(unresearched)} niche(s) have no market data yet, so they have no bid ceiling. "
              "Run `arb research` to measure them against eBay sold listings.")

    earned = [t for t in rows if (t.get("stats") or {}).get("sold")]
    if earned:
        print(f"\n{'niche':<34}{'matched':>9}{'bought':>8}{'sold':>6}{'spend':>9}{'revenue':>9}{'roi':>8}")
        for t in earned:
            st = t["stats"]
            roi = f"{st['realized_monthly_roi'] * 100:.0f}%" if st.get("realized_monthly_roi") is not None else "-"
            print(f"{t['name'][:33]:<34}{st['lots_matched']:>9}{st['bought']:>8}{st['sold']:>6}"
                  f"{st['spend']:>9.0f}{st['revenue']:>9.0f}{roi:>8}")

    if proposed:
        print(f"\n{len(proposed)} niche(s) proposed from your own sales (re-run with --accept to keep):")
        for t in proposed:
            print(f"  {t['name']:<28} median ${t['price_median']:.0f}  {t['rationale']}")
        if args.accept:
            sc.save_theses(proposed)
            print(f"accepted {len(proposed)}")


def cmd_research(args, s, store):
    """Mine recent eBay sold data for new niches, and re-measure stale ones."""
    sc = Scanner(s, store)
    out = sc.research(discover=args.discover, refresh=args.refresh, focus=args.focus)
    if out.get("error"):
        print("research problem:", out["error"])
    for t in out["added"]:
        vol = (f"{int(t['sold_90d'])} sold / {int(t['active_now'])} active"
               if t.get("sold_90d") is not None and t.get("active_now") is not None else "counts unknown")
        px = f"${t['price_median']:.0f}" if t.get("price_median") else "no price"
        bid = f"pay up to ${t['max_bid']:.2f}" if t.get("max_bid") else "no ceiling yet"
        print(f"+ {t['name']:<34} {px:>8}  {vol:<28} {bid}")
    for t in out["updated"]:
        print(f"~ {t['name']:<34} refreshed -> "
              + (f"${t['price_median']:.0f}, pay up to ${t['max_bid']:.2f}" if t.get("max_bid") else "still no ceiling"))
    if not out["added"] and not out["updated"]:
        print("nothing added or updated")


def cmd_hunt(args, s, store):
    """Run the playbook's search terms against HiBid."""
    sc = Scanner(s, store)
    out = sc.hunt(max_theses=args.limit)
    print(f"hunted {len(out['hunted'])} theses: {', '.join(out['hunted']) or 'none'}")
    print(f"{len(out['lots'])} lots found and stored")
    theses = sc.theses()
    hits = [(l, match_theses(l, theses)) for l in out["lots"]]
    hits = [(l, m) for l, m in hits if m]
    hits.sort(key=lambda x: -x[1][0]["strength"])
    for lot, m in hits[:20]:
        bid = f"${m[0]['max_bid']:.2f}" if m[0].get("max_bid") else "?"
        print(f"  [{m[0]['name'][:24]:<24} pay<={bid:>7}] ${lot.get('high_bid') or 0:>6.0f}  {lot.get('title', '')[:56]}")


def cmd_local(args, s, store):
    """Local, non-auction buys scored against the playbook."""
    from .sources import hunt_local, parse_pasted_listing, score_local

    sc = Scanner(s, store)
    theses = sc.theses()
    if args.url or args.text:
        listing = parse_pasted_listing(url=args.url or "", text=args.text or "", price=args.price)
        if not listing:
            print("nothing to parse")
            return
        if args.miles is not None:
            listing["distance_miles"] = args.miles
        h = score_local(listing, theses, s)
        print(f"\n{h['verdict'].upper()}: {h['note']}")
        if h["theses"]:
            print("matches: " + ", ".join(m["name"] for m in h["theses"]))
        return
    if not s.craigslist_site:
        print("Set ARB_CRAIGSLIST_SITE to your local craigslist subdomain (e.g. 'detroit'), or pass\n"
              "--url / --text to score a pasted OfferUp or Marketplace listing. Those two have no public\n"
              "API and their terms forbid scraping, so pasting is the supported path.")
        return
    listings = hunt_local(theses, s)
    order = {"buy": 0, "negotiate": 1, "unknown": 2, "pass": 3}
    hits = [h for h in (score_local(l, theses, s) for l in listings) if h["theses"]]
    hits.sort(key=lambda h: order[h["verdict"]])
    print(f"scanned {len(listings)} local listings, {len(hits)} match the playbook\n")
    for h in hits[:args.limit]:
        l = h["listing"]
        price = f"${l['price']:.0f}" if l.get("price") is not None else "ask"
        print(f"  {h['verdict']:<10}{price:>7}  {l['title'][:54]}")
        print(f"             {h['note']}")
        if l.get("url"):
            print(f"             {l['url']}")


def cmd_categories(args, s, store):
    from .hibid import HiBidClient
    c = HiBidClient(s.hibid_graphql, site_url=s.hibid_site, delay=s.request_delay)
    for cat in c.category_tree(args.parent):
        print(f"{cat['id']:>8}  {cat.get('fullCategory') or cat.get('categoryName')}  {'(+children)' if cat.get('hasChildren') else ''}")
        for ch in cat.get("children") or []:
            print(f"{ch['id']:>8}      {ch.get('categoryName')}")


def main(argv=None):
    p = argparse.ArgumentParser(prog="arb", description="HiBid auction arbitrage scanner")
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("scan", help="pull lots from HiBid and value the promising ones")
    a.add_argument("--status", default="OPEN", help="OPEN | CLOSING_TODAY | HOT | UPCOMING")
    a.add_argument("--hours", type=float, default=24, help="only keep lots closing within N hours (0 = no limit)")
    a.add_argument("--category", type=int, help="HiBid category id (see `categories`)")
    a.add_argument("--search", help="search text, e.g. 'dewalt'")
    a.add_argument("--zip"); a.add_argument("--miles", type=int)
    a.add_argument("--max-pages", type=int, default=10, help="100 lots per page")
    a.add_argument("--max-value", type=int, default=40, help="max lots to send for valuation this run")
    a.add_argument("--no-value", action="store_true", help="only pull lots, skip valuation")
    a.set_defaults(fn=cmd_scan)

    a = sub.add_parser("value", help="value stored lots that have no valuation yet")
    a.add_argument("--hours", type=float, default=24); a.add_argument("--limit", type=int, default=40)
    a.set_defaults(fn=cmd_value)

    a = sub.add_parser("top", help="print the best opportunities")
    a.add_argument("--hours", type=float, default=0); a.add_argument("--min-score", type=float, default=0)
    a.add_argument("--limit", type=int, default=30)
    a.set_defaults(fn=cmd_top)

    a = sub.add_parser("serve", help="run the dashboard")
    a.add_argument("--host", default="127.0.0.1"); a.add_argument("--port", type=int, default=8765)
    a.add_argument("--open", action="store_true", help="open a browser")
    a.set_defaults(fn=cmd_serve)

    a = sub.add_parser("refresh", help="re-pull live bid/time-left for lots closing soon")
    a.add_argument("--hours", type=float, default=6); a.add_argument("--limit", type=int, default=200)
    a.set_defaults(fn=cmd_refresh)

    a = sub.add_parser("demo", help="load demo data so you can see the dashboard without scanning")
    a.set_defaults(fn=cmd_demo)

    a = sub.add_parser("export", help="write a self-contained HTML snapshot of the dashboard")
    a.add_argument("--out", default="spread-hunter.html")
    a.set_defaults(fn=cmd_export)

    a = sub.add_parser("settle", help="record what closed lots actually sold for, then print the report card")
    a.add_argument("--limit", type=int, default=200)
    a.set_defaults(fn=cmd_settle)

    a = sub.add_parser("report", help="the valuer's report card: predictions vs. what actually happened")
    a.set_defaults(fn=cmd_report)

    a = sub.add_parser("intel", help="market intel: category trends, fastest money, value traps")
    a.set_defaults(fn=cmd_intel)

    a = sub.add_parser("playbook", help="the niches we hunt and the most to pay for each")
    a.add_argument("--review", action="store_true", help="grade the playbook against your recorded sales")
    a.add_argument("--accept", action="store_true", help="keep the niches proposed from your own sales")
    a.set_defaults(fn=cmd_playbook)

    a = sub.add_parser("research", help="mine eBay sold data for new niches; re-measure stale ones")
    a.add_argument("--discover", type=int, help="how many new niches to look for")
    a.add_argument("--refresh", type=int, default=6, help="how many stale niches to re-measure")
    a.add_argument("--focus", help="steer the search, e.g. 'bank and insurance advertising'")
    a.set_defaults(fn=cmd_research)

    a = sub.add_parser("hunt", help="run the playbook's searches against HiBid")
    a.add_argument("--limit", type=int, help="how many niches to hunt this run")
    a.set_defaults(fn=cmd_hunt)

    a = sub.add_parser("local", help="local non-auction buys scored against the playbook")
    a.add_argument("--url", help="score one pasted listing URL (OfferUp, Marketplace, anywhere)")
    a.add_argument("--text", help="score pasted listing text")
    a.add_argument("--price", type=float, help="asking price, if the text does not contain it")
    a.add_argument("--miles", type=float, help="how far away it is, for the trip cost")
    a.add_argument("--limit", type=int, default=25)
    a.set_defaults(fn=cmd_local)

    a = sub.add_parser("categories", help="list HiBid category ids")
    a.add_argument("--parent", type=int)
    a.set_defaults(fn=cmd_categories)

    args = p.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    s = load()
    if args.cmd == "scan" and args.hours == 0:
        args.hours = None
    store = Store(s.db_path)
    try:
        args.fn(args, s, store)
    finally:
        store.close()
