# consulting-site

SMB-focused consulting storefront + **Capture**, the SEO & GEO Opportunity Audit.

- `/` — homepage (services, packages, lead capture)
- `/audit` — Capture: drop a domain, get a live-data opportunity audit
- `/audit/[domain]/report` — client-ready consulting report (print to PDF)
- `/api/audit/export?domain=X` — pivot-ready Excel workbook
- `/spread` — **Spread Hunter**, the HiBid auction arbitrage dashboard (scans hibid.com, values lots with Claude + web search, scores the spread, alerts on hot lots). API under `/api/spread/*`; scheduled scans via `/api/spread/cron`. Python CLI twin lives in `tools/auction-arbitrage/`.

## Env (Vercel)

| Var | Purpose |
|---|---|
| `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` | Live rankings, volumes, SERP + AI keyword data |
| `ANTHROPIC_API_KEY` | Claude analyst narrative on live audits |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Durable audit cache + archive, lead capture |

Keyless deployments degrade gracefully to deterministic demo mode.

## Spread Hunter on Vercel

1. **Database**: run `supabase/spread.sql` in the Supabase SQL editor (same project the audit uses). Without Supabase the app falls back to an in-memory store that resets on every cold start.
2. **Env vars** (Vercel → Settings → Environment Variables):

| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude appraisals with web search (already set for the audit) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Durable lots, valuations, scan log |
| `SPREAD_PASSWORD` | Required. Gate for the dashboard/API (you're prompted once in the browser) |
| `CRON_SECRET` | Required. Vercel Cron and the GitHub Actions trigger authenticate with it |
| `SPREAD_ZIP` / `SPREAD_MILES` | Only auctions near you (pickup) |
| `SPREAD_CRON_HOURS` / `SPREAD_CRON_STATUS` / `SPREAD_CRON_SEARCH` / `SPREAD_CRON_CATEGORY` | What each scheduled scan pulls (default: OPEN lots closing within 24h) |
| `SPREAD_VALUE_PER_RUN` / `SPREAD_DAILY_VALUATION_CAP` | Spend control: lots valued per run (12) and per day (150) |
| `SPREAD_MODEL` | `claude-opus-5` default; `claude-sonnet-5` is ~2.5× cheaper |
| `SPREAD_ALERT_WEBHOOK` | Slack/Discord incoming-webhook URL for hot-lot alerts |
| `RESEND_API_KEY` + `SPREAD_ALERT_EMAIL` | Email alerts instead of / as well as the webhook |
| `SPREAD_ALERT_MIN_SCORE` / `SPREAD_ALERT_WINDOW_MIN` | Alert when score ≥ 60 and closing within 90 min |
| `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` | Optional eBay Browse API (reliable comps from a server IP; asking prices) |
| `SPREAD_BUYER_PREMIUM` / `SPREAD_SALES_TAX` / `SPREAD_PICKUP_COST` / `SPREAD_RESALE_FEE` / `SPREAD_RESALE_SHIP` | Cost model |
| `SPREAD_SPREAD_FULL` / `SPREAD_MIN_SPREAD` | Net spread that earns full marks (default $150) and the floor below which scores are scaled down ($10) |
| `SPREAD_SWEET_MAX_LANDED` / `SPREAD_SWEET_MIN_NET` | Sweet-spot definition: landed ≤ $6 and net ≥ $15 flags the $1–$3 buys that resell for $20–$50 |
| `SPREAD_VISION` / `SPREAD_MAX_IMAGES` | Send lot photos to the model (default on, 4 photos) so it reads marks and splits multi-item lots |
| `SPREAD_CALIBRATION` / `SPREAD_CALIBRATION_MIN_CLOSED` / `SPREAD_CALIBRATION_MIN_SALES` / `SPREAD_CALIBRATION_MIN_BIAS` / `SPREAD_CALIBRATION_MAX_BIAS` / `SPREAD_SETTLE_PER_RUN` | The feedback loop (default on): sample floors before an adjustment applies (8 closed lots, 5 sales), the clamp on it (0.5 to 1.5), and how many closed lots each run settles (40) |
| `SPREAD_PLAYBOOK` / `SPREAD_TARGET_MONTHLY_ROI` / `SPREAD_MIN_BUY_MULTIPLE` / `SPREAD_HUNT_PER_RUN` / `SPREAD_HUNT_PAGES` | The playbook (default on): the return on capital a buy must clear (1.0 = 100%/month), the multiple of net you will never pay within (3), and how many niches each scan hunts (4, two pages each) |
| `SPREAD_DISCOVER_COUNT` / `SPREAD_RESEARCH_TTL_DAYS` / `SPREAD_THESIS_MIN_SALES` / `SPREAD_THESIS_MIN_ROI` / `SPREAD_THESIS_MAX_FROM_SALES` | How many niches a research pass looks for (8), how stale research may get before a refresh (30 days), and the bar your own sales must clear to propose a niche (3 sales at 150% ROI, 8 proposals max) |
| `SPREAD_LOCAL` / `SPREAD_CRAIGSLIST_SITE` / `SPREAD_LOCAL_TRIP_COST` / `SPREAD_LOCAL_COST_PER_MILE` | Local buying: your craigslist subdomain (e.g. `detroit`), and what a collection trip costs ($4 flat plus $0.20/mile). OfferUp and Facebook are paste-only — see above |
| `SPREAD_LIQUIDITY_WEIGHT` / `SPREAD_HANDLING_DAYS` / `SPREAD_MAX_DAYS_TO_SELL` / `SPREAD_LIQUIDITY_MIN_SALES` / `SPREAD_TREND_WINDOW_DAYS` | How much liquidity discounts the score (0.7; 0 disables it), days of handling before capital comes back (3), the horizon past which "slower" stops meaning anything (365), your own sales needed before measured speed overrides the model (4), and the market-trend window (21 days) |
| `SPREAD_GRADING` / `SPREAD_GRADING_FEE` / `SPREAD_GRADING_SHIP` / `SPREAD_GRADING_DAYS` | Trading-card grading analysis (default on), $75 per-card fee + $15 shipping (about $90 all-in), 60-day turnaround |
| `SPREAD_EBAY_FVF` / `SPREAD_EBAY_FVF_MEDIA` / `SPREAD_EBAY_PER_ORDER` / `SPREAD_EBAY_PER_ORDER_SMALL` / `SPREAD_EBAY_PROMOTED` / `SPREAD_PACKAGING` | eBay fee model for the listing net-out: 13.6% (15.3% books/music/movies), $0.30 per order ($0.40 under $10), optional promoted rate, $1 packaging |
| `SPREAD_RUN_BUDGET_MS` | Time box per scan run (default 240000). Set 50000 if Fluid Compute is unavailable and functions cap at 60s |

3. **Schedule**: `vercel.json` registers a daily cron (the most Hobby allows). For every-15-minutes scanning add repo secrets `SPREAD_CRON_URL` (`https://<your-site>/api/spread/cron`) and `CRON_SECRET`; `.github/workflows/spread-cron.yml` does the rest. On Vercel Pro you can instead change the cron schedule to `*/15 * * * *`.
4. Each run is time-boxed to ~4 minutes: pull lots → value the most promising (budget-capped) → live-refresh everything closing soon → alert. Coverage builds across runs; valuations are cached 7 days by item title.

Note: HiBid sits behind Cloudflare and eBay blocks many datacenter IPs. If scans from Vercel come back with `HTTP 403`, run the Python CLI from a home machine instead (same dashboard, same scoring) — see `tools/auction-arbitrage/README.md`.

### Go-live checklist

1. Merge to `main` (scheduled GitHub Actions workflows only run from the default branch).
2. Supabase → SQL editor → run `supabase/spread.sql` (re-run it after pulling: it adds `spread_outcomes` for the feedback loop, the listing-lifecycle columns on it, `spread_valuations.category` for the liquidity layer, and `spread_theses` for the playbook; every statement is `if not exists`, so re-running is safe).
3. Vercel → Environment Variables: `SPREAD_PASSWORD`, `CRON_SECRET`, `SPREAD_ZIP`, `SPREAD_MILES`,
   `SPREAD_ALERT_WEBHOOK`, and optionally `SPREAD_MODEL=claude-sonnet-5` with `SPREAD_DAILY_VALUATION_CAP=60`
   to keep spend around $2–3/day. Redeploy.
4. Vercel → Functions: make sure **Fluid Compute** is on so functions can run 300s (else `SPREAD_RUN_BUDGET_MS=50000`, `SPREAD_VALUE_PER_RUN=2`).
5. GitHub → Secrets → Actions: `SPREAD_CRON_URL` = `https://<your-domain>/api/spread/cron`, `CRON_SECRET`. Then Actions → spread-hunter-cron → Run workflow.
6. Open `/spread`, enter the password. The **Setup** strip lists anything still missing (`/api/spread/health`).

### How the score works

**Landed cost** = next required bid × (1 + buyer's premium) × (1 + sales tax) + pickup. **Net resale** = mid
estimate × (1 − selling fees). **Value score** (0–100) blends the resale multiple (log-scaled, 8× = full marks,
weighted 0.6), the dollar spread (scaled to `SPREAD_SPREAD_FULL`), and confidence; spreads under
`SPREAD_MIN_SPREAD` are scaled down and authenticity-flagged lots lose 25%. **Sweet spot** (landed ≤ $6, net ≥ $15)
gets a floor so a $2 buy that nets $25 scores hot.

**Score** = value score × time factor × liquidity factor. The time factor is 100% under an hour, 95% under 2h,
80% under 6h, 65% under 12h, 50% at a day, 35% at two days, 20% inside a week, 10% beyond, because a $1 bid with
a week left says nothing about the final price. The liquidity factor is below. **Radar levels**: Strike (< 2h,
alerts fire here), Watch (2–12h), Track (12–48h), Scan (valued, waiting on the clock; it climbs into Strike as the
close approaches at no extra cost since appraisals are cached 7 days).

### Liquidity: how fast the money comes back

Worth $40 and *sells* for $40 are different claims. An item with 200 active listings and four sales a quarter is
not a $40 item, it is a $40 asking price attached to a six-month wait — the "max promotion, no views" case. The
appraiser therefore researches `demand_signals` on every lot (comparable items sold on eBay in the last 90 days,
how many are listed right now, trend, seasonality, price dispersion, typical watchers) and the model turns the two
counts into a hazard rate:

    p = (sold_90d / 90) / active_now        chance one listing sells on any given day
    days_p50 = ln2 / p     days_p80 = ln5 / p     P(sold in 30d) = 1 − (1 − p)^30

Sell-through (`sold / (sold + active)`) is reported alongside because resellers already know that number, but the
hazard is what the arithmetic runs on: sell-through alone cannot tell 5-sold-of-10 in a week from the same in a
year. **Depth** (how many sales the estimate rests on) is a separate axis and gates confidence, not speed.

That produces a **liquidity grade A–F**, an ETA, a 30-day sell probability, and the number that actually settles
"$40 item vs $25 item": **monthly ROI** = profit ÷ landed cost ÷ (capital days ÷ 30), where capital days is the
median wait plus `SPREAD_HANDLING_DAYS` of photographing, listing and packing. A $3 lot that nets $22 in a week
beats a $3 lot that nets $37 in a year, and this is the number that says so. Rank the table by **Fastest money**
to sort on it. The eBay price points also take their expected days from this model rather than from constants, so
pricing at the quick number visibly shortens the wait.

The score keeps `1 − w × (1 − (0.35 + 0.65 × liquidity/100))` of its headline, where `w` is
`SPREAD_LIQUIDITY_WEIGHT` (0.7 by default; the dashboard slider overrides it per request). At weight 0 the score
is exactly what it was before this layer existed. **Missing data is never treated as bad data**: if the valuer
returned no demand signals and no demand read, the basis is `none` and the factor is a no-op — ignorance is not
evidence of illiquidity. You can also refuse to hold slow stock outright with **Min. grade** and **Sells within N
days**, which filter server-side so alerts honour them too.

### The Playbook: hunting instead of waiting

Everything above starts from a lot and asks "what is this worth". That finds value, but it is passive — you
only ever evaluate what the scanner happened to pull. A $1 advertising letter opener that sells for $30 in
three hours is not a lucky accident, it is a repeatable **niche**, and the way to work a niche is to know its
numbers first and then go looking for it.

A **thesis** is that knowledge, written down and testable: what to search for (queries, plus the negative
words that mean "wrong thing"), what it sells for (p25 / median / p75 from real eBay sold data), how fast
(sold in 90 days vs. listed now), and the one number you act on at 2am —

```
net        = median × (1 − fees) − shipping − packaging
k          = SPREAD_TARGET_MONTHLY_ROI × capital_days / 30
max_landed = net / (1 + k)          … and never more than net / SPREAD_MIN_BUY_MULTIPLE
max_bid    = (max_landed − pickup) / ((1 + premium) × (1 + tax))
```

`max_landed` is the source of truth and works for any channel; `max_bid` is it converted back to an auction
bid with the buyer's premium stripped out. Buying locally there is no premium — the asking price plus the
trip *is* the landed cost — so local listings are judged against `max_landed` directly.

Theses arrive three ways:

- **Seeded.** A starter pack weighted heavily toward small printed-and-stamped advertising (letter openers,
  blotters, pocket mirrors, thermometers, rulers, paperweights, pinbacks) and bank, insurance and financial
  memorabilia (still banks, obsolete notes and scrip, stock certificates, bank giveaways). That profile is
  what makes this tool work: worthless to the auctioneer, specific enough that a collector searches for it by
  name, cheap to post, and identifiable from a photo once you can read the imprint. **The seeds ship with no
  prices.** A fabricated median would produce a confident bid ceiling with nothing behind it, so the numbers
  stay empty and the niche shows no ceiling until it is actually researched.
- **Discovered.** `POST /api/spread/playbook/research` (or `arb research`) runs a Claude call with web search
  that mines recent eBay sold listings for niches meeting all five criteria: sells for $20–$150, sells fast,
  is cheap at auction, ships cheaply, and is recognisable in a mediocre auction thumbnail. It reports the sold
  and active counts it actually read, and `-1` for anything it could not determine.
- **From your own wins.** `arb playbook --review` mines your recorded round trips for recurring, profitable
  phrases and proposes them. Sales already covered by a thesis are skipped, which is what stops four
  letter-opener flips from proposing "letter", "opener" and "advertising" as three separate niches.

**Hunting.** Every scan spends part of its budget running the playbook's own search terms against HiBid,
rotating least-recently-hunted first so the whole playbook gets covered over a few runs. A lot that matches a
researched niche also jumps the valuation queue, and carries its price and ceiling in the table *before* any
valuation call is spent on it — which is the entire point for a $1 lot.

### Local and non-auction buying

Same playbook, no clock. `GET /api/spread/local` (or `arb local`) searches Craigslist for the playbook's
queries and scores what comes back, adding `SPREAD_LOCAL_TRIP_COST` plus mileage because going to collect
something is real money: a $3 win thirty miles away is not a win. Each hit gets a verdict — **buy**,
**negotiate** (with the number to offer), **pass** or **unknown**.

Being straight about the sources: **Craigslist** publishes RSS for any search and is fetched directly.
**OfferUp and Facebook Marketplace have no public API and their terms forbid scraping**, so this does not
scrape them. Instead, paste a link or the listing text into the Playbook panel (or `POST /api/spread/local`,
or `arb local --url …`) and it runs through the same matching, the same ceiling and the same verdict.
Automating those two properly needs OfferUp's partner API or a licensed data provider.

### Market intel

`GET /api/spread/intel` (the **Market intel** panel, and `arb intel` on the CLI) is the layer above any single
lot, built entirely from valuations already on disk so it costs nothing extra to render:

- **Fastest money right now** — open lots ranked by profit per dollar of capital per month, grade C or better.
- **Valued high, but nobody is buying** — the mirror image: lots that would have scored well on upside alone and
  have no market underneath. These are what the layer exists to catch.
- **Category heat** over a rolling `SPREAD_TREND_WINDOW_DAYS` window, with warming/cooling measured by comparing
  the recent half of the window against the earlier half. A category without enough history in both halves reads
  "new" and gets no sparkline rather than a trend line drawn through two points.
- **What your own listings actually did** — the liquidity feedback loop, below.

### Photo-based identification

Titles like "vintage knic knacs" hide the value in a backstamp. With `SPREAD_VISION=1` the scanner pulls the lot's
photos and sends them with the appraisal. The model reads maker's marks and labels, identifies every distinct item
in a multi-item lot with its own range, names the standout piece, and values the lot as what a reseller would net
splitting the good pieces out. Vague titles with photos are prioritised for valuation rather than skipped.

### Grading upside (trading cards)

When a lot is a trading card the appraisal runs a deeper pass (up to 5 searches): it reads the photos like a
grader (centering ratios, corners, edges, surface), turns that into PSA grade probabilities (10 / 9 / 8 / ≤7),
pulls graded sales by grade from PSA Auction Prices Realized, SportsCardsPro/PriceCharting, 130point and eBay
sold, checks the PSA population report and gem rate, and notes what to verify in hand (trimming, reprints, print
lines). The dossier shows the expected net from grading (Σ probability × price-by-grade, less selling fees and
about $90 all-in to grade) against selling raw. Tens are rare, so the model uses the set's gem rate as its prior
for a 10; a "grade" call must clear a hurdle (the larger of $25, 30% of the grading cost, 25% of the raw net) and
still beat raw with the 10 removed. Otherwise: "speculative: pays only if it gems", "grade if it looks 9+ in
hand", "sell raw", or "inspect in hand".

### The feedback loop (calibration)

The valuer grades its own past calls and bends future ones toward reality. Two tiers of evidence:

**Auction results, free and automatic.** HiBid publishes the realized price on every closed lot, including
ones you never bid on. After each scan the scanner settles lots whose auctions have ended and records what
it predicted against what the lot actually hammered for. A hammer price is not a resale value, so it can
never prove an estimate was too low, but it can prove one was too high: if the landed cost at the hammer
meets or beats the net resale we predicted, either the winner overpaid or, far more often across many lots,
our number was inflated. That share is the **overshoot rate**, and on this basis the system only ever cuts
an estimate, never raises one.

**Your recorded sales, ground truth.** In any lot's dossier, enter what you paid, when you listed it, and what
it sold for. Once a category has `SPREAD_CALIBRATION_MIN_SALES` of them, the median of actual over predicted
replaces the hammer signal entirely and can raise estimates as well as cut them. Wide dispersion against real
sales also discounts confidence, since a number that is a coin flip should not be scored like a firm one.

**Speed, from the same records.** The listing dates drive a second loop that grades the liquidity model rather
than the price model. Median observed days over median predicted days gives a per-category multiplier that
stretches or compresses every future speed estimate — on the demo history, furniture takes about 2.6× longer than
predicted while tools beat the estimate. Recording a listing that has **not** sold is just as useful as one that
has: the 30-day sell rate counts everything that had a fair shot at 30 days, sold or still sitting, because a loop
that only learned from things that sold would conclude that everything sells. A listing up for 12 days is not yet
evidence either way and is excluded until day 30; one sitting at 90 days counts fully against the rate.

Adjustments apply per category, fall back to a global figure, need a minimum sample
(`SPREAD_CALIBRATION_MIN_CLOSED`), and are clamped to `SPREAD_CALIBRATION_MIN_BIAS` and
`SPREAD_CALIBRATION_MAX_BIAS` so one thin or unlucky week cannot swing the model. Every adjusted valuation
is stamped in the dossier with the factor, the sample size, and which basis it came from. The **Valuer report
card** panel on the dashboard shows the whole thing per category: lots closed, how often you would have been
outbid at your own number, sales recorded, actual over predicted, and the adjustment in force. The speed loop
appears in the Market intel panel: listed, sold, how long it took, what we said, the 30-day sell rate, how many
are still sitting, and your realized return on capital per month.

This is also the prerequisite for any autonomy. Do not let software spend money on a valuer whose accuracy
you have never measured; a few weeks of the report card tells you which categories are trustworthy.

### Listing plan and net-out

Every appraisal also returns a ready-to-post eBay listing written for eBay's own search ranking: a
keyword-front-loaded 80-character title plus two alternates, the leaf category the sold comps live in, the full
set of item specifics buyers filter on, condition plus a flaw line, a Best-Match-friendly description, three price
points (quick ≈ 25th percentile of sold comps, market ≈ median, patient ≈ 75th) with a best-offer floor, format
(fixed price + offers vs. Sunday-ending auction), a photo checklist, a promoted-listing rate and the best time to
list. The dossier shows what you net at each price after eBay's final value fee, per-order fee, shipping and
packaging, and the profit vs. landed cost, with copy buttons for the sell form.

One-click posting to a seller account is the next step: it needs an eBay developer keyset with the Sell APIs, a
one-time OAuth consent from the seller, and business policies on the account. The listing plan is already shaped
as the input to that call (Inventory + Offer APIs).
