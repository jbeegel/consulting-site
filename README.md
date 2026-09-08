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
| `SPREAD_GRADING` / `SPREAD_GRADING_FEE` / `SPREAD_GRADING_SHIP` / `SPREAD_GRADING_DAYS` | Trading-card grading analysis (default on), $75 per-card fee + $15 shipping (about $90 all-in), 60-day turnaround |
| `SPREAD_EBAY_FVF` / `SPREAD_EBAY_FVF_MEDIA` / `SPREAD_EBAY_PER_ORDER` / `SPREAD_EBAY_PER_ORDER_SMALL` / `SPREAD_EBAY_PROMOTED` / `SPREAD_PACKAGING` | eBay fee model for the listing net-out: 13.6% (15.3% books/music/movies), $0.30 per order ($0.40 under $10), optional promoted rate, $1 packaging |
| `SPREAD_RUN_BUDGET_MS` | Time box per scan run (default 240000). Set 50000 if Fluid Compute is unavailable and functions cap at 60s |

3. **Schedule**: `vercel.json` registers a daily cron (the most Hobby allows). For every-15-minutes scanning add repo secrets `SPREAD_CRON_URL` (`https://<your-site>/api/spread/cron`) and `CRON_SECRET`; `.github/workflows/spread-cron.yml` does the rest. On Vercel Pro you can instead change the cron schedule to `*/15 * * * *`.
4. Each run is time-boxed to ~4 minutes: pull lots → value the most promising (budget-capped) → live-refresh everything closing soon → alert. Coverage builds across runs; valuations are cached 7 days by item title.

Note: HiBid sits behind Cloudflare and eBay blocks many datacenter IPs. If scans from Vercel come back with `HTTP 403`, run the Python CLI from a home machine instead (same dashboard, same scoring) — see `tools/auction-arbitrage/README.md`.

### Go-live checklist

1. Merge to `main` (scheduled GitHub Actions workflows only run from the default branch).
2. Supabase → SQL editor → run `supabase/spread.sql`.
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

**Score** = value score × time factor (100% under an hour, 95% under 2h, 80% under 6h, 65% under 12h, 50% at a day,
35% at two days, 20% inside a week, 10% beyond), because a $1 bid with a week left says nothing about the final
price. **Radar levels**: Strike (< 2h, alerts fire here), Watch (2–12h), Track (12–48h), Scan (valued, waiting on
the clock; it climbs into Strike as the close approaches at no extra cost since appraisals are cached 7 days).

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
