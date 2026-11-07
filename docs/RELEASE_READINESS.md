# Release readiness

Checklist for shipping Kinviva responsibly. Status as of 2026-11-07 (version 0.1.5).

## 1. Release version consistency
- Single source of truth: the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` must match, and match the git tag.
- Enforced by `scripts/check-versions.mjs` (run by CI and by `npm run check:versions`). Status: **done**, all three are 0.1.5.

## 2. Automated tests in CI
- `.github/workflows/ci.yml` runs on every push and pull request: type check, front-end tests, Rust tests, Rust lint with warnings denied, version consistency, the early-access service tests. Status: **added, not yet run on GitHub** (it runs after the next push).
- `.github/workflows/windows.yml` builds the Windows installer by hand.
- Missing: an end-to-end test that drives the real app and a fixed audio sample; a dependency-license check.

## 3. macOS signing and notarization plan
Today the Mac build is signed with a local or ad-hoc identity, so Gatekeeper warns on other Macs.
1. Join the Apple Developer Program (organization or individual).
2. Create a Developer ID Application certificate; store it in the CI secrets (never in the repo).
3. Sign the app and the speech helper with the hardened runtime and the entitlements in `src-tauri/entitlements.plist` (microphone, screen capture, no unnecessary ones).
4. Notarize with `notarytool` and staple the ticket. `scripts/build-mac-app.sh` already reads `KINVIVA_SIGN_IDENTITY` and `KINVIVA_NOTARY_PROFILE`; the missing pieces are the certificate and the profile.
5. Verify on a clean Mac: download, open, no warning, permissions prompt appears once.
6. Because the bundle id changed in 0.1.5, keep it stable from now on.

## 4. Windows hardware testing plan
Status: built in CI only; **never run on Windows hardware**.
- Machines: Windows 10 and 11, one with a USB headset, one with Bluetooth headphones, one with speakers.
- Cases: install and uninstall; first run permissions; microphone capture; system audio (WASAPI loopback) while a video plays; local speech engine speed on a CPU-only laptop; overlay always on top; screen-share exclusion; Video Assist panel; Notes and Notes export; data folder location; upgrade over the previous version.
- Pass criteria written per case before testing; results recorded in `docs/testing/`.
- Until this is done the Windows installer stays labelled experimental on the website.

## 5. Safe update strategy
See MIGRATION_PLAN.md section 3: notify first, signed updates, notarized builds, database backup before a schema change, a kept previous installer for rollback. No silent auto-update until signing is in place.

## 6. Data migration verification
- `src-tauri/src/migrate.rs` tests (2) and `scripts/verify-migration.sh` (row counts of old and new database). On the owner's data all counts matched.
- To do: an automated test that opens each past schema version and upgrades it; an end-to-end check of the key migration on a clean Mac.

## 7. Privacy and consent documentation
`docs/PRIVACY.md` describes what stays local, what leaves the computer and when, and how early-access data is handled. The website privacy page must match it. Status: **written**; legal review pending.

## 8. Security
`SECURITY.md` (private reporting, scope). To add: a threat-model note for the embedded video pane and the overlay; dependency audit (`cargo audit`, `npm audit`) in CI.

## 9. Contribution and governance
`CONTRIBUTING.md` (updated). Needs the DCO or CLA decision (LICENSING_REVIEW.md) before accepting outside code.

## 10. Go / no-go for a public release
| Item | Status |
|---|---|
| Version consistency | done |
| CI green on GitHub | pending first run |
| Signed and notarized Mac build | not done |
| Windows tested on hardware | not done |
| Privacy page matches behaviour | done (review pending) |
| License decision | open |
| Migration verified on a clean machine | partly (data copy yes, keys no) |
