# consulting-site

SMB-focused consulting storefront + **Capture**, the SEO & GEO Opportunity Audit.

- `/` — homepage (services, packages, lead capture)
- `/audit` — Capture: drop a domain, get a live-data opportunity audit
- `/audit/[domain]/report` — client-ready consulting report (print to PDF)
- `/api/audit/export?domain=X` — pivot-ready Excel workbook

## Env (Vercel)

| Var | Purpose |
|---|---|
| `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` | Live rankings, volumes, SERP + AI keyword data |
| `ANTHROPIC_API_KEY` | Claude analyst narrative on live audits |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Durable audit cache + archive, lead capture |

Keyless deployments degrade gracefully to deterministic demo mode.
