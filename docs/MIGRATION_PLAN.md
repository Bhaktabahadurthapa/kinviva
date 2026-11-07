# Migration plan

Covers moving users and data safely: from MeetingLens to Kinviva (done in 0.1.5), future database changes, and the move to
paid editions. Rule for every migration: **copy first, never delete, verify, then offer cleanup**.

## 1. MeetingLens to Kinviva (shipped in 0.1.5)

| What | How | Verified |
|---|---|---|
| App identity | New bundle id `app.kinviva.desktop`. macOS asks again for Microphone and Screen Recording. | Expected behaviour; documented in the release notes. |
| Data folder | On first start the old `app.meetinglens.desktop` folder is copied into `app.kinviva.desktop`; `meetinglens.sqlite(-wal,-shm)` become `kinviva.sqlite(...)`. The old folder is left untouched. | `src-tauri/src/migrate.rs` has 2 unit tests. On the owner's real data the counts matched exactly after migration: 19 sessions, 15 notes and boards, 212 saved answers. |
| Failure case | If the copy fails, the app opens the old database in place, so data is never hidden. | Code path present; not triggered in practice. |
| API keys | Keys saved under the old keychain service are copied to the new one the first time each is read. | **Not verified end to end.** The keychain may show a one-time access prompt. |
| Display preferences | Theme, panel sizes, recent videos live in WebKit storage tied to the bundle id and start fresh. | Documented. |
| Old installers | Old releases were deleted at the owner's request. | Done. |

Verification script for a release: `scripts/verify-migration.sh <old-folder> <new-folder>` compares row counts of the main tables between the two databases.

## 2. Future database changes
- SQLite schema changes are append-only, numbered migrations (currently 1 to 8) in `db.rs`. Never edit an old migration.
- Before a migration that rewrites tables, the app copies `kinviva.sqlite` to `kinviva.sqlite.backup-<schema version>` (to add: not done yet).
- Every migration has a test that opens a database at the previous version and checks the data.

## 3. Updating the app safely (design, not built)
1. Notify, do not auto-install: the app checks a signed release feed and shows "Version X is available".
2. Updates are signed (Tauri updater with a pinned public key) and macOS builds are notarized.
3. Keep the previous version's installer available for a rollback.
4. A database backup is made before the first start of a new schema.

## 4. Community to Pro or Business (future)
- Upgrading must not move or reformat user data: Pro modules read the same SQLite database.
- Downgrading must leave all data readable by Community (Pro features simply stop being offered).
- Exporting (Markdown, Word, text, PPTX, CSV) stays free in every edition.

## 5. Early-access data
Stored only in the early-access service (see PRIVACY.md). On request, a person's record is deleted. When the list is retired, all records are deleted.
