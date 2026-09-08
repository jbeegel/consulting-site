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

3. **Schedule**: `vercel.json` registers a daily cron (the most Hobby allows). For every-15-minutes scanning add repo secrets `SPREAD_CRON_URL` (`https://<your-site>/api/spread/cron`) and `CRON_SECRET`; `.github/workflows/spread-cron.yml` does the rest. On Vercel Pro you can instead change the cron schedule to `*/15 * * * *`.
4. Each run is time-boxed to ~4 minutes: pull lots → value the most promising (budget-capped) → live-refresh everything closing soon → alert. Coverage builds across runs; valuations are cached 7 days by item title.

Note: HiBid sits behind Cloudflare and eBay blocks many datacenter IPs. If scans from Vercel come back with `HTTP 403`, run the Python CLI from a home machine instead (same dashboard, same scoring) — see `tools/auction-arbitrage/README.md`.

