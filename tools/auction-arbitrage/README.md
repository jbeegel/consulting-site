# Spread Hunter — auction arbitrage scanner for HiBid

Finds lots on [hibid.com](https://hibid.com) whose **current bid is far below what the item resells for**, values
each one independently (Claude + web search for sold comps, eBay sold listings, or the auctioneer's own estimate as
a last resort), scores the spread, and puts everything in a local dashboard with a heat map, a cost-vs-value scatter,
a sortable table, live countdowns, and a one-click dossier explaining *why* the upside exists.

> Personal research tool. HiBid has no public API; this uses the same GraphQL endpoint the hibid.com site itself
> calls (`POST https://hibid.com/graphql`), read-only, throttled to one request every ~0.6s. Respect their terms of
> use; do not hammer it.

## Quick start (5 minutes)

```bash
cd tools/auction-arbitrage
python3 -m venv .venv && source .venv/bin/activate      # Python 3.10+
pip install -r requirements.txt

export ANTHROPIC_API_KEY=sk-ant-...      # optional but strongly recommended (real valuations + dossiers)
export ARB_ZIP=33301 ARB_MILES=100       # optional: only auctions near you (pickup!)

python -m arb scan --hours 24 --max-value 40   # pull lots closing in the next 24h, value the 40 most promising
python -m arb serve --open                      # dashboard at http://127.0.0.1:8765
```

Want to see the dashboard before spending anything? `python -m arb demo && python -m arb serve --open` loads
synthetic example lots (clearly labelled) so you can click around.

## How it works

```
hibid.com/graphql ──LotSearch──▶ normalize ──▶ SQLite (lots)
                                                │
                       triage (brand words, model numbers, no bids, closing soon)
                                                │
             ┌───────────── valuation pipeline ─┴──────────────┐
             │ 1. cache by normalized title (7 days)            │
             │ 2. eBay SOLD listings → comps (no key needed)    │
             │ 3. Claude + web_search → structured appraisal    │  ← range, confidence, comps w/ URLs,
             │ 4. fallback: auctioneer's estimate               │    value drivers, risks, demand
             └────────────────────────────────────────────────┘
                                                │
                    scoring: landed cost, net resale, spread, multiple, heat
                                                │
                       FastAPI  ──▶  dashboard (heatmap · scatter · table · dossier)
                       GetLotStateQuery ──▶ "Refresh live" (bid, bids, seconds left)
```

**Landed cost** = next required bid × (1 + buyer's premium) × (1 + sales tax) + pickup cost.
**Net resale** = mid estimate × (1 − selling fees) − your shipping cost.
**Spread** = net resale − landed cost. **Multiple** = net resale ÷ landed cost.

**Score (0–100)** = 100 × (0.6·multiple component + 0.4·dollar component) × (½ + ½·confidence) × (½ + ½·price reliability).
The multiple component is log-scaled (2× = ⅓, 8× = full marks) because a $1 → $30 penny lot is a 25× and the
bread and butter of auction flipping; the dollar component is scaled to a realistic $150 spread (`ARB_SPREAD_FULL`),
and spreads under $10 are scaled down. **Score** = value score × time factor (100% under 1h, 50% at a day, 20% at 3 days, 10% at a week). **Radar**:
Strike (< 2h), Watch (2–12h), Track (12–48h), Scan (valued, waiting on the clock). **Sweet spot** = landed ≤ $6 and net ≥ $15 (`ARB_SWEET_*`): those get a
floor on the dollar component so a $2 buy that nets $25 scores hot, and a badge/filter in the dashboard.
Price reliability is how much the *current* bid tells you about the *final* price: 1.0 under an hour left, 0.65 inside a day,
0.3 with 3+ days left (bids arrive late). Heat bands: **hot ≥ 60**, warm ≥ 40, mild ≥ 20. Authenticity-flagged lots are
discounted 25%.

Every valuation records its method (`claude+web`, `claude`, `ebay_sold`, `hibid_estimate`, `none`), confidence and the
reason for it, the comps it used (with links), value drivers and risks, so you can audit the number before you bid.
The current bid is deliberately withheld from the model so it cannot anchor on it.

## CLI

| Command | What it does |
|---|---|
| `python -m arb scan [--status OPEN\|CLOSING_TODAY\|HOT] [--hours 24] [--search "dewalt"] [--category ID] [--zip Z --miles M] [--max-pages 10] [--max-value 40] [--no-value]` | Pull lots, store them, value the most promising `--max-value` |
| `python -m arb value [--hours 24] [--limit 40]` | Value stored lots that don't have a valuation yet |
| `python -m arb top [--min-score 40] [--hours 6]` | Print the best opportunities to the terminal |
| `python -m arb serve [--port 8765] [--open]` | Run the dashboard |
| `python -m arb refresh [--hours 6]` | Re-pull live bid / time-left for lots closing soon |
| `python -m arb export [--out spread-hunter.html]` | Self-contained HTML snapshot you can share |
| `python -m arb categories` | List HiBid category ids for `--category` |
| `python -m arb demo` | Load synthetic example data |

A typical day: `scan --hours 24` in the morning (valuations are cached 7 days, so re-scans are cheap), then
`scan --status CLOSING_TODAY --hours 6 --max-value 20` in the afternoon, keep the dashboard open and hit
**Refresh live** on what you're watching. The dashboard's **Scan HiBid** button does the same thing in the background.

## Configuration (environment variables)

| Var | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Enables Claude appraisals. Without it you get eBay-sold comps / auctioneer estimates only. |
| `ARB_MODEL` | `claude-opus-5` | Model for appraisals. `claude-sonnet-5` is ~2.5× cheaper and fine for commodity items. |
| `ARB_WEB_SEARCH` | `1` | Let Claude search the web for sold comps (≤3 searches per lot). |
| `ARB_VISION` / `ARB_MAX_IMAGES` | `1` / `4` | Send the lot's photos so the model reads marks and splits multi-item lots into per-item values. |
| `ARB_EBAY_SOLD` | `1` | Scrape eBay sold listings as comps (no key; best effort, may be rate-limited). |
| `ARB_VALUER` | `auto` | `auto` \| `claude` \| `ebay` \| `estimate` \| `none` |
| `ARB_BUYER_PREMIUM` | `0.15` | Fallback buyer's premium when the auction doesn't publish one |
| `ARB_SALES_TAX` | `0` | Your sales tax on hammer + premium (e.g. `0.07`) |
| `ARB_PICKUP_COST` | `0` | Flat $ per lot for gas/time |
| `ARB_RESALE_FEE` | `0.15` | Marketplace + payment fees on resale (eBay ≈ 13–15%) |
| `ARB_RESALE_SHIP` | `0` | $ shipping you absorb per resale |
| `ARB_ZIP` / `ARB_MILES` / `ARB_STATE` / `ARB_COUNTRY` | — | Default geographic scope |
| `ARB_DB` | `arb.sqlite3` | Database file |
| `ARB_VALUATION_TTL_DAYS` | `7` | How long a valuation for the same title is reused |
| `ARB_VALUATION_WORKERS` | `4` | Parallel valuation calls |
| `ARB_REQUEST_DELAY` | `0.6` | Seconds between HiBid requests |

**Cost.** One appraisal ≈ 4–10k input tokens (search results) + ~1k output. With `claude-opus-5` that's roughly
$0.05–0.10 per lot, so `--max-value 40` ≈ $2–4 per scan; `claude-sonnet-5` is about $0.02–0.04 per lot. Cached
titles cost nothing. Start with `--max-value 20` and a tight `--hours 6` window if you want to stay cheap.

## Dashboard

* **KPIs** — lots tracked, valued, hot/warm counts, warm-or-better closing in < 3h, total spread on the table.
* **Where the heat is** — category × time-to-close heat map (best score per cell, count of warm+ lots). Click a cell to focus.
* **Landed cost vs. net resale** — log-log scatter with 1×/2×/5×/10× guide lines; dot size = dollar spread. Hover, click to open.
* **Opportunities table** — sortable, live countdowns (red under 1h), confidence bar, `auth` flag, "no bids" marker.
* **Dossier drawer** — photo, live bid & countdown, full cost breakdown, valuation range, *Why the upside* paragraph,
  value drivers, risks, comparable sales with links, listing description & photos, **Open on HiBid**, **eBay sold**
  search, **Refresh live**, **Re-value**.
* **Grading upside** — for trading cards: photo condition read (centering, corners, edges, surface), PSA grade
  probabilities, graded comps by grade (PSA APR, SportsCardsPro, 130point, eBay sold), pop report, and the
  expected net of grading vs. selling raw (`ARB_GRADING_*`), with a recommendation.
* **List it on eBay** — the appraisal also drafts the listing (80-char title, category, condition, item specifics,
  description) and three price points (quick / market / patient) with net after eBay fees (`ARB_EBAY_*`), shipping
  and packaging, and profit vs. landed cost. Copy buttons for the sell form.
* Left rail: minimum score, no-bids-only, time-bucket and category toggles, free-text filter.

## Real-time data

HiBid exposes `GetLotStateQuery` (bid, bid count, seconds left) per lot; **Refresh live** pulls it for what's on screen
(up to 60 lots per click). The countdowns tick client-side between refreshes. HiBid also has a WebSync push channel
(`/websync/websync.ashx`) that the site uses for live bid updates; wiring that in would give true push updates
without polling and is the natural next step if you find yourself refreshing a lot.

## Roadmap / ideas

* **More comp sources**: Mercari sold listings; targeted subreddits (e.g. r/baseballcards, r/vintage-focused subs)
  for niche collectibles where eBay under-represents the market; WorthPoint for antiques. The comp layer is
  pluggable — add a `fetch_*_comps()` in `arb/valuation/` and pass the comps into the pipeline alongside eBay's.
* Other auction platforms (Proxibid, AuctionZip/LiveAuctioneers, GovDeals, BidSpotter) behind the same `normalize_lot` shape.
* Push updates via HiBid's WebSync channel; alerts (SMS/email) when a hot lot enters its last 30 minutes.
* Image-based identification (send the lot photo to the model) for vaguely titled lots.
* Track outcomes: record price realized after close and grade the valuer's calibration over time.

## Hosted version

The same scanner, valuer, scoring and dashboard are ported to TypeScript under `lib/spread/` + `app/api/spread/` in this
repo and deploy with the consulting site on Vercel (`/spread`). It stores in Supabase, runs on a schedule, and sends
alerts. Setup is in the root README. This Python CLI stays useful for local, residential-IP scanning if the hosted
scanner gets blocked, or for cheap bulk experiments.

## Development

```bash
pip install pytest
python -m pytest tests            # runs against a built-in mock of hibid.com/graphql
python -m tests.mock_hibid        # serve the mock on :8799 to try the CLI without touching HiBid
ARB_HIBID_GRAPHQL=http://127.0.0.1:8799/graphql ARB_HIBID_SITE=http://127.0.0.1:8799 python -m arb scan --no-value
```

Layout: `arb/hibid.py` (GraphQL client + normalizer) · `arb/db.py` · `arb/valuation/` (`claude.py`, `ebay.py`,
`estimate.py`, `pipeline.py`) · `arb/scoring.py` · `arb/scanner.py` · `arb/server.py` · `arb/static/index.html` ·
`arb/cli.py` · `arb/demo.py` · `arb/export.py`.
