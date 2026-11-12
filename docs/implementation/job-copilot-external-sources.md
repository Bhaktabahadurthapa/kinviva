# Job Copilot external sources: Apify + Firecrawl

This feature extends the existing **Jobs & Resume** screen. Existing public-feed search, resume tailoring, export and local tracker remain unchanged.

## What is implemented

- **Apify**: a user-selected Actor executes when the user presses **Run Actor and import jobs**. The app sends the user's explicit JSON input to Apify, caps a run at USD 0.50 and 50 paid dataset items (where the Actor supports that cap), and imports recognized title/company/URL rows.
- **Firecrawl**: on a selected job, **Fetch full JD** sends that job URL to `POST https://api.firecrawl.dev/v2/scrape` and replaces the short description for the current in-memory search results. The existing **Tailor my resume and prepare** action can then work with the enriched description.
- API keys are persisted through the existing macOS Keychain / Windows Credential Manager abstraction. Neither provider receives the user's resume from these connectors.
- Existing source listings continue to work without API keys.

## Setup

1. In Apify Console, select a suitable Actor from the store. Read its documentation, supported sites, accepted JSON input and charge model. Only choose sources and permissions you are entitled to access.
2. Generate an Apify API token in Apify Console. In Kinviva, open **Jobs & Resume → Find jobs → External job sources**, paste and save that key.
3. Enter the Actor ID (`owner~actor-name`, or a valid Actor ID) and its JSON input. Start with a tiny test. The Actor determines which input keys it supports.
4. Create a Firecrawl API key and save it in the same section.
5. Run job search or import results. Open a candidate and press **Fetch full JD (Firecrawl)**, then review the page text and press **Tailor my resume and prepare**.
6. Review the tailored text, export the DOCX, open the employer's official page, submit manually, and update your tracker.

## Limitations

- No auto-apply; no automatic external jobs scanning in background. The existing local search agent uses its established public sources.
- Actor output schemas vary. This adapter recognizes common top-level fields: title/jobTitle/position/name, company/companyName/employer, jobUrl/url/applyUrl/link/job_url, and description/jobDescription/descriptionText/text. Other Actor schemas need a mapping adapter.
- A provider's success response does **not** prove the job is still open or the application URL is the official employer page. Verify both before applying.
- Description content is untrusted and must never be followed as model instructions. The existing tailoring system already marks resume and job text as untrusted.
- The in-memory enriched description is not guaranteed to survive app restart or a fresh search. Export tailored work or add the job to the tracker.
- Apify synchronous runs can exceed the desktop timeout; check Apify Console before retrying to prevent duplicate spending. Provider costs remain subject to your account's pricing rules.
- The existing master resume is stored in the application's current local storage implementation, not an encrypted resume vault. Review that boundary before claiming stronger confidentiality.
- External-provider restrictions and terms apply.

## REA's role (development only)

Use the sibling REA repository (Reverse Engineer Anything) only for **authorized behavior inspection, local trace analysis, and test-environment exploration** of Kinviva or your own integrations. REA is not installed or invoked in the shipped Job Copilot and must not be used to bypass provider logins, terms, CAPTCHAs, protections, or private APIs. Prefer the published Apify and Firecrawl API contracts as the integration source of truth.

## Verification checklist

- [ ] `npm run build`
- [ ] `npm test`
- [ ] `cd src-tauri && cargo fmt --check && cargo test && cargo clippy -- -D warnings`
- [ ] Save and delete Apify/Firecrawl credentials in supported desktop OS stores
- [ ] Provider missing key, invalid JSON, 401, 402, 429, timeout and malformed dataset errors
- [ ] Firecrawl fetch and re-tailor one public job page
- [ ] Confirm existing public-source search and resume export are unchanged
- [ ] Verify no secrets appear in logs, saved settings, frontend storage or error messages

No real provider-key integration tests have been executed in this environment.
