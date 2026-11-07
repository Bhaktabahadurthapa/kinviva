# Commercial architecture (design only)

Nothing in this document is built except the early-access service code in `cloud/early-access/`. It is a design for later phases.
Everything here must keep the Community Edition fully usable offline and without an account.

## Components

```
Desktop app (Community)  ──optional sign-in──►  Cloud backend (private)
   │  local SQLite, local keys                      │ auth, licensing, managed AI gateway, usage, admin API
   │                                                │
   └── Pro module (private, loaded at build)        └── Billing provider (later)
Marketing site (public, static)  ──form──►  Early-access service (cloud/early-access)
```

### 1. Desktop app
Unchanged Tauri 2, Rust, React and SQLite. New in the app, later: an entitlement check through `edition.rs`, and an optional sign-in screen that is only shown if a Pro or Business build is installed. Offline use must keep working: a signed license token is verified locally and cached, with a grace period.

### 2. Private cloud backend (future)
- **Auth**: email sign-in with a hosted identity provider (do not build passwords). Organizations map to Business.
- **Licensing**: signed, short-lived tokens (Ed25519). The app holds only the public key. Revoking works by not renewing.
- **Managed AI gateway**: one endpoint compatible with the app's existing OpenAI-style client. It enforces per-user usage limits, never stores prompts by default, and is clearly labelled so users know when data leaves their machine.
- **Admin API**: organization settings, seats, policy (for example "disable cloud AI"), usage reports.
- **Hosting**: begin with one small serverless service and one SQL database. No microservices until a measured need.

### 3. Pro extension repository (future, private)
A crate (`kinviva-pro`) that implements the traits in OPEN_CORE_PLAN.md and is linked at build time into Pro installers. The public repository never contains or imports it.

### 4. Early-access service (exists as code)
`cloud/early-access/` is a small serverless worker with a SQL table:
- `POST /api/early-access` with JSON: name, email, use case, optional company, consent.
- Server-side validation, a honeypot field, per-client rate limiting (hashed client address, never stored with the signup), duplicate handling by lower-cased email, and a body size limit.
- Stored: name, email, use case, company, consent time and the version of the consent text. Nothing else.
- Not deployed. Deploying it and pointing the website at it requires the owner's approval. See `cloud/early-access/README.md`.

## Data flow rules
1. The Community app never contacts a Kinviva server for normal use. (Today it contacts none.)
2. Any feature that does contact one must say so in the UI before the first use and have an off switch.
3. Meeting audio and transcripts are never uploaded by Kinviva servers' design: managed AI sends only the text the user asked about to the gateway, and the gateway does not keep it by default.

## Security design points
- Signed license tokens, public key pinned in the app; no secrets in the app.
- Server stores minimal personal data; encryption at rest from the host; delete-on-request process documented in PRIVACY.md.
- Rate limiting and abuse controls on every public endpoint.
- Audit log for admin actions (Business).

## Open decisions (owner)
Identity provider, billing provider, hosting provider, region and data residency, and the retention period for early-access data.
