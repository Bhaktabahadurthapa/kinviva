# Moving the website to kinviva.tech (prepared, NOT active)

Today the site is at https://bhaktathapa.com.np/kinviva/. Nothing below has been done. Each step needs the owner's approval.

What is already prepared in the repository:
- `scripts/gen-site.py` writes a `canonical` link and `og:url` on every page. With no setting it uses the current address, so nothing changes.
- `KINVIVA_SITE_BASE=https://kinviva.tech/ python3 scripts/gen-site.py` rebuilds every canonical and social-image URL for the new address and also writes `sitemap.xml` and `robots.txt`.
- `move-to-kinviva-tech/old-address-redirect.html` is the page to leave at the old address (instant redirect, canonical link to the new site, not indexed).
- The Early Access service already allows the `https://kinviva.tech` and `https://www.kinviva.tech` origins.

Cutover steps (in this order):
1. Cloudflare: confirm `kinviva.tech` is an active zone. Add the DNS records GitHub Pages asks for (apex A/AAAA records and a `www` CNAME to `bhaktathapa.github.io`). **DNS change: needs approval.**
2. Repo settings, Pages: set the custom domain to `kinviva.tech`, wait for the certificate, tick Enforce HTTPS. **Settings change: needs approval.**
3. Build for the new address: `KINVIVA_SITE_BASE=https://kinviva.tech/ python3 scripts/gen-site.py`, add a `site/CNAME` file containing `kinviva.tech`, commit and push.
4. Check `https://kinviva.tech/`, every page, the downloads, and the Early Access page.
5. Replace the old address with `old-address-redirect.html` (in the root-domain site repo as `kinviva/index.html`) and keep the old `meetinglens/` redirect.
6. Remove `https://bhaktathapa.com.np` from `ALLOWED_ORIGIN` in `cloud/early-access/wrangler.toml` and redeploy the service.
7. Update the website address in the README and in the GitHub repository "website" field.
