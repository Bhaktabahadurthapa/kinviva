# Early Access service

A small serverless worker that stores Early Access signups from the Kinviva website. **It is not deployed.** Deploying it and pointing the
website at it needs the owner's approval.

## What it does
`POST /api/early-access` with JSON `{ name, email, use_case, company?, consent: true }`:
validates every field, requires explicit consent, ignores a hidden honeypot field, limits each client to 5 attempts per hour (bad requests count too) (by a salted
hash of the address, never stored with the signup), stores one row per email address (repeats change nothing and get the same answer), and
answers with a confirmation message. `GET /health` reports whether it is configured and the database answers. A missing secret or database error gives a safe 503 with no details. Only the website's origin may call it.

Stored: name, email, use case, optional company, consent time, consent text version. Nothing else. See `docs/PRIVACY.md`.

## Test (no cloud account needed)
```bash
node --test cloud/early-access/worker.test.mjs     # Node 22.13 or newer (uses the built-in SQLite)
```

## Deploy (owner approval needed first)
Exact steps, secrets, health check, export and deletion commands: **[DEPLOY.md](DEPLOY.md)**.
Quick local trial: `node cloud/early-access/local-server.mjs`. Health check: `GET /health`.
The website form stays closed ("Registrations are temporarily unavailable") until the site is rebuilt with `KINVIVA_EA_ENDPOINT` set.

## Still to decide
Email confirmation (double opt-in) needs an email provider. The retention period and a public contact address for deletion requests (see `docs/PRIVACY.md`).
