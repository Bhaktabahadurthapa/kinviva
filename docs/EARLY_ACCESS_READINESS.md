# Early Access launch readiness

Status: **NOT DEPLOYED. Ready to deploy once the owner decides the items under "Blockers".** Prepared 2026-11-07.

## What was audited and checked
| Area | Finding | Evidence |
|---|---|---|
| Data collected | Name, email, use case (fixed list), optional company, consent time and consent text version. No transcripts, recordings, IP address, user agent or app data. Extra fields sent by a client are ignored. | `schema.sql`; test "only the agreed fields are stored" |
| Consent | Required, unticked by default, enforced on the server (`consent === true`), version and time stored. | `validate()`; tests |
| Email validation | Syntax check, 254 characters max, control characters removed, stored once per lower-cased address. | `validate()`; tests |
| Duplicates | Same address in any capitalisation is stored once; the visitor gets the same answer, so the list cannot be probed. | `UNIQUE(email_lower)`; test |
| Rate limiting | 5 attempts per client per hour, counted before validation. Keys are a salted SHA-256 of the address, never the address. Old rows are deleted. | tests |
| Spam | Hidden honeypot field; origin must equal `https://bhaktathapa.com.np`; JSON only; 4 KB body limit. | tests |
| Secrets | `RATE_SALT` is required (16+ characters). The service refuses to run without it. Set with `wrangler secret put`, not in files. | tests; `wrangler.toml` |
| Errors | Any internal failure returns a safe 503 with no details; nothing from the submission is logged. | test |
| Health | `GET /health` returns `{ok, configured, database}` only. | test |
| Cloudflare config | `wrangler deploy --dry-run` accepted the configuration (bindings DB and ALLOWED_ORIGIN). `workers_dev` and preview URLs are off. | dry-run output |
| Website form | Disabled, with "Registrations are temporarily unavailable", until built with `KINVIVA_EA_ENDPOINT`. Sends nothing while closed. Success, error and duplicate messages tested. | jsdom run below |
| Pricing, payments | None. A search of the site, app and service found no prices, payment or subscription code. | grep |
| LICENSE | Unchanged (proprietary, all rights reserved). | `git diff` |

## End-to-end local test (real form script, real HTTP, SQLite file)
Ran `site/early-access.html` and `site/site.js` in jsdom against `local-server.mjs`:
1. empty form: asks for name and valid email
2. no consent: asks for consent
3. valid submit: confirmation shown, one row stored (`tester@example.com`, use case `technical`, company `Acme`, consent version `ea-2026-11-v1`, ISO time)
4. same email in capitals: same confirmation, still one row
5. wrong origin: refused with 403
Health check returned `{"ok":true,"configured":true,"database":true}`.

## Tests
`node --test cloud/early-access/worker.test.mjs`: 9 of 9 pass. Whole-repo results are in the release report.

## Blockers before switching it on (owner decisions)
1. **Approval to deploy** and a Cloudflare account.
2. **Where the service lives**: a subdomain on Cloudflare (needs a DNS change) or the free `workers.dev` address. See `DEPLOY.md` step 0.
3. **A public contact address for deletion requests.** `docs/PRIVACY.md` promises deletion on request, but the Early Access page does not yet show an address.
4. **Retention period** (draft: until deletion request, or 12 months after the programme ends).
5. **Double opt-in email** is not built; sign-ups are unverified addresses. Acceptable for a small list; decide before large outreach.
6. Optional: Cloudflare rate-limit rule or Turnstile for extra abuse protection.

## Go / no-go
- Code and configuration: **GO** (tested, dry-run valid).
- Public launch of the form: **NO-GO until blockers 1 to 3 are decided.** Nothing was deployed, no DNS or visibility changed, no licence changed.
