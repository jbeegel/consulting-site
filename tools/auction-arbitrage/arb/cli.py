"""Command line: scan, value, top, serve, refresh, demo."""
from __future__ import annotations

import argparse
import logging
import sys
import time
import webbrowser

from .config import load
from .db import Store
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
