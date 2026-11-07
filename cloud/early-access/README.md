# Early Access service

A small serverless worker that stores Early Access signups from the Kinviva website. **It is not deployed.** Deploying it and pointing the
website at it needs the owner's approval.

## What it does
`POST /api/early-access` with JSON `{ name, email, use_case, company?, consent: true }`:
validates every field, requires explicit consent, ignores a hidden honeypot field, limits each client to 5 attempts per hour (by a salted
hash of the address, never stored with the signup), stores one row per email address (repeats change nothing and get the same answer), and
answers with a confirmation message. Only the website's origin may call it.

Stored: name, email, use case, optional company, consent time, consent text version. Nothing else. See `docs/PRIVACY.md`.

## Test (no cloud account needed)
```bash
node --test cloud/early-access/worker.test.mjs     # Node 22.13 or newer (uses the built-in SQLite)
```

## Deploy (owner approval needed first)
```bash
cd cloud/early-access
npx wrangler d1 create kinviva-early-access          # copy the database id into wrangler.toml
npx wrangler d1 execute kinviva-early-access --remote --file=schema.sql
npx wrangler secret put RATE_SALT                    # any long random string
npx wrangler deploy
```
Then set `EA_ENDPOINT` for the website build (see `scripts/gen-site.py`) to the worker's `/api/early-access` address and regenerate the site.

## Still to decide
Email confirmation (double opt-in) needs an email provider. Retention period and the contact address for deletion requests (PRIVACY.md).
