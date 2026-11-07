# Deploying the Early Access service (owner approval required first)

Nothing here has been run. Do not run these steps until the owner says to. You need a Cloudflare account (the free plan is enough).

## 0. Decide first
- **Where will the service live?** Two options:
  - **A. Selected: `api.kinviva.tech`**, a custom domain on the Cloudflare-managed zone `kinviva.tech`. Cloudflare creates the DNS record when the custom domain is attached; that is a DNS change and needs the owner's separate approval.
  - **B. The free `workers.dev` address** (fallback). No DNS change. In `wrangler.toml` set `workers_dev = true`.
- **A contact address for deletion requests.** `docs/PRIVACY.md` promises deletion on request, so the Early Access page must show a real address. Add it to the page text before launch.

## 1. Sign in and create the database
```bash
cd cloud/early-access
npx wrangler login
npx wrangler d1 create kinviva-early-access
```
Copy the printed `database_id` into `wrangler.toml` (replace `REPLACE_WITH_DATABASE_ID`). The id is not a secret.

## 2. Create the tables
```bash
npx wrangler d1 execute kinviva-early-access --remote --file=schema.sql
```
The file is safe to run twice (`CREATE TABLE IF NOT EXISTS`). Check it:
```bash
npx wrangler d1 execute kinviva-early-access --remote --command "SELECT name FROM sqlite_master WHERE type='table'"
```
Expected: `signups` and `rate`.

## 3. Set the secret
```bash
openssl rand -hex 32 | npx wrangler secret put RATE_SALT
```
`RATE_SALT` must be at least 16 characters; the service refuses to run without it. Never commit it or paste it into chat. `ALLOWED_ORIGIN` is not secret and lives in `wrangler.toml`: a comma-separated list of exact website origins (no trailing slash). It currently lists `https://kinviva.tech`, `https://www.kinviva.tech` and `https://bhaktathapa.com.np`. Remove the old one after the site has moved.

## 4. Deploy
```bash
npx wrangler deploy
```
For option A, add a custom domain in the Cloudflare dashboard (Workers & Pages, kinviva-early-access, Settings, Domains & Routes), or add this to `wrangler.toml` and deploy again:
```toml
routes = [{ pattern = "api.kinviva.tech", custom_domain = true }]
```

## 5. Check it works
```bash
curl https://api.kinviva.tech/health
# expected: {"ok":true,"configured":true,"database":true}
```
Then send one test sign-up from your own email address using the real form (step 6), and read it back:
```bash
npx wrangler d1 execute kinviva-early-access --remote --command "SELECT id,email,name,use_case,company,consent_version,consent_at FROM signups"
```

## 6. Switch the website form on
```bash
cd ../..
KINVIVA_EA_ENDPOINT="https://api.kinviva.tech/api/early-access" python3 scripts/gen-site.py
git add site && git commit -m "Site: switch Early Access form on"
```
Pushing `site/` publishes the site automatically (the Pages workflow). Do this only after step 5 passes.

## Running it (after launch)
- **See sign-ups:** the `SELECT` above, or the D1 page in the dashboard.
- **Export:** `npx wrangler d1 execute kinviva-early-access --remote --command "SELECT * FROM signups" --json > signups.json` (keep that file private).
- **Delete one person on request:** `npx wrangler d1 execute kinviva-early-access --remote --command "DELETE FROM signups WHERE email_lower = 'person@example.com'"`
- **Switch the form off:** regenerate the site without `KINVIVA_EA_ENDPOINT` and push, or delete the worker in the dashboard.
- **Roll back:** `npx wrangler rollback`.
- **Rotate the salt:** run step 3 again. Old rate-limit keys stop matching, which is harmless.

## Optional hardening (recommended)
In the Cloudflare dashboard add a rate-limiting rule or Turnstile on the route if you see abuse. The service already limits each address to 5 attempts an hour, ignores a hidden bot trap field, and only accepts requests from the website origin. Double opt-in email needs an email provider and is not built.

## Local trial, no account needed
```bash
node cloud/early-access/local-server.mjs 8787 http://localhost:8000
```
Serves the same code with an in-memory database (set `EA_DB=/path/file.db` to keep records). For the Cloudflare runtime locally: copy `.dev.vars.example` to `.dev.vars`, then `npx wrangler dev`.
