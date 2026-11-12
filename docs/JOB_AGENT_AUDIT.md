# Job search feature audit

Branch `feature/web-intelligence` at `7ef9809`. Audit only: no application behavior was changed. Nothing was merged, pushed or deployed.

## How statuses are used
- **Verified** means the logic runs in an automated test or was exercised in the browser mock (`?mock`) with canned backend answers, and the result was checked.
- **Not verified live** means the code exists and is unit-tested against fake responses, but it has never been run against the real service (job feeds, Apify, Firecrawl, OpenAlex) or a real answer engine.
- No capability has been exercised against a live service or a real model. That is the largest gap in this audit.

## Tests run for this audit (no changes made)
| Check | Result |
|---|---|
| `npx tsc --noEmit` | passes |
| `npx vitest run` | 22 files, 120 tests pass (25 of them for jobs and resume: `jobs.test.ts` 14, `resume.test.ts` 11) |
| `cargo test --lib` | 196 pass, 2 ignored, 0 fail (15 in `jobs::` and `webintel::`) |
| `cargo clippy --all-targets -- -D warnings` | clean |
| Component tests for `JobsView.tsx` | none exist |
| Tests that call a real LLM, Apify, Firecrawl or a real job feed | none exist |

## 1. Inventory

Files: `src-tauri/src/jobs.rs` (805 lines), `src-tauri/src/webintel.rs` (284), `src/lib/jobs.ts` (301), `src/lib/resume.ts` (187), `src/views/JobsView.tsx` (437), `src/components/ResumeFormat.tsx` (52); commands in `commands.rs`; settings in `settings.rs`, `SettingsView.tsx`; keys in `secrets.rs`.

| # | Capability | Status | Where | Notes |
|---|---|---|---|---|
| 1 | Jobs UI and discovery | Not verified live | `JobsView.tsx` (Find jobs), `jobs::search`, `jobs_search` | Feeds: Remotive, The Muse, Arbeitnow, Greenhouse, Lever, Ashby boards. Parsers are tested on sample JSON written from memory of each API, not on real responses. Location, remote, category and keyword filters are verified by unit tests. UI verified in the mock. |
| 2a | Resume upload and text extraction | Not verified live | `resume_read` → `docs::extract` | PDF, DOCX, TXT, MD up to 20 MB. Existing `docs` tests cover extraction. No test with a real resume. Scanned PDFs error out (no OCR). |
| 2b | Resume parsing | Fully implemented and verified | `src/lib/resume.ts` `parseResume` | Plain-text heuristics: name, contacts, sections, roles, dates. 11 tests. Unknown lines are kept as text, never dropped. |
| 2c | Profile storage | Partially implemented | `localStorage` key `ml.jobs.resume1` | Only the resume text is stored. There is no structured career profile (skills, experience, education as data). Not in SQLite. |
| 3 | Apify integration | Not verified live | `webintel::apify_run`, `parse_apify_jobs`, `commands::apify_jobs`, Settings, Jobs checkbox | Actor name and input template are user-supplied; field mapping accepts common names. Tested with a mock server. Never run on a real actor, so the real response shape and cost are unknown. |
| 4 | Firecrawl integration and JD extraction | Partially implemented | `webintel::firecrawl_search/scrape`; callers: `assistant::web_results` (answers) and `commands::apify_jobs` | Job-description extraction exists only as a fallback for Apify rows with no description (max 5 per search). There is no "add a job from a URL" and no extraction for jobs from other feeds. Request shape follows Firecrawl v1 as known to the author; not checked against the live API. |
| 5 | Resume-to-job matching | Fully implemented and verified | `jobs.ts` `matchJob`, `extractSkills` | Deterministic skill and word counting, 118-entry skill dictionary, required skills weighted double. Verified by tests and the mock. It is an estimate, labelled as one. Narrow outside technical roles. |
| 6 | AI match explanation and skill-gap analysis | Partially implemented | `JobsView` job detail | Shows matched and missing skills and a score label. There is no AI-written explanation, no prioritised gap advice, no "what to learn". |
| 7 | Tailored resume | Not verified live | `jobs::tailor_messages`, `jobs_tailor`, `JobsView.TailorPanel` | Prompt forbids invention. A client-side check (`newClaims`) flags added skills and numbers; a diff (`diffLines`) shows exactly what changed. Prompt and parsing are tested; the model output never has been. |
| 7b | US resume layout, templates, export | Fully implemented and verified | `resume.ts`, `jobs.rs` `render_resume_docx`, `ResumeFormat.tsx` | 3 templates, Letter size, single column, real text. Docx structure asserted in a Rust test; preview checked in the mock. Never opened in Word itself. |
| 7c | Reformat uploaded resume | Not verified live | `jobs::format_messages`, `resume_reformat` | LLM, layout only, Undo available. See bug B1. |
| 8 | Cover letter | Not verified live | `jobs::letter_messages`, `jobs_cover_letter`, `letter_export` | Same pattern as tailoring. Letter can be saved as Word or text and is stored on the tracker card. |
| 9 | Application workflow and submission | Partially implemented (submission deliberately absent) | `JobsView` | "Open the application page" opens the employer's page; "I applied" sets the status. There is no auto-submit, which is intended and stated in the UI. There is also no single "application pack" step (resume + letter + link together). |
| 10 | Tracking and persistence | Partially implemented | `localStorage` `ml.jobs.apps1`, `JobsView` tracker, `jobs.ts` `reminders` | Board, notes, interview and follow-up dates, a "Coming up" list, seen-job tracking for the agent. Logic verified. Stored only in the webview's browser storage. See risk R1. |
| 11 | Job agent | Fully implemented and verified (logic), runs only while open | `jobs.ts` `agentDue`, `newJobIds`; `JobsView` mount effect | Re-searches on opening Jobs when the last search is over 12 hours old. Not a background service. |
| 12 | Saved searches | Partially implemented | `PREFS_KEY` | One set of search choices is remembered. No named, multiple saved searches. |
| 13 | Company information | Missing | | Only the company name from the listing. |
| 14 | Web provider limits | Fully implemented and verified | `webintel::spend_call`, Settings | Daily call limit tested (counts, resets by day, refuses at limit). Keys in the OS credential store; errors never contain keys (tested). |

## 2. End-to-end workflow

```
Job search -> Job details -> Resume comparison -> Tailored resume -> Application preparation -> Submission -> Tracking
```

| Step | What exists | Status |
|---|---|---|
| Job search | Find jobs: type, location, remote, keywords, boards, optional Apify, agent | Works in the mock; not run against live feeds |
| Job details | Click a row: full description, source, age, remote tag, match score | Works |
| Resume comparison | Score, matched skills, missing skills (not AI-written) | Works |
| Tailored resume | "Tailor my resume and prepare" → editable text, diff, new-claim warning, US layout preview | Works up to the model call, which is untested live |
| Application preparation | Save Word/text, write a cover letter, copy, open the employer's page | Manual steps; no combined pack |
| Submission | Not implemented, by design. The user submits on the employer's site and presses "I applied" | Stops here |
| Tracking | Tracker board, notes, interview and follow-up dates, reminders | Works, but in browser storage only |

**The workflow stops at Submission, intentionally.** Beyond that, the real gaps are: no live verification of any external call, and tracker data kept in `localStorage`.

## 3. Reuse (do not rebuild)
- `jobs::search`, parsers, `location_fits` (Rust); `matchJob`, `reminders`, `newJobIds` (TS).
- `webintel::*` adapters, `spend_call`, `secrets` keys, `Settings` fields.
- `export::docx_package`, `jobs::render_resume_*`, `resume.ts` parse and diff.
- `assistant::llm_config` and `llm::stream_chat` for every model call (already used by all three generators).
- `db.rs` and `migrate.rs` for any new persistence (they already hold meetings, notes, records).
- `store.rs` records (`record_save`, `record_list`) are an existing generic table keyed by `kind`; check whether it can hold applications before adding a new table.

## 4. Missing
1. Live verification of any feed, Apify actor, Firecrawl call or model output.
2. Durable storage (SQLite) for resume, tracker and preferences, and inclusion in backups and exports.
3. Structured career profile.
4. Add a job from a pasted URL (Firecrawl extraction for any listing).
5. AI skill-gap explanation.
6. Named saved searches.
7. Company information.
8. One-step application pack.
9. Cancel buttons for job search, reformat and cover letter (the answer engine requests are registered for cancellation, but only tailoring exposes a Cancel button; `jobs_search` has no request id and no cancel).

## 5. Bugs and risks

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| R1 | High | Resume, tracker (including tailored resumes and letters) and preferences live only in the webview's `localStorage`. No Rust code reads or writes them (`grep "ml.jobs" src-tauri` returns nothing), so they are not in the SQLite database, not in any export, and are lost if site data is cleared or the app's webview storage is reset. | `src/lib/jobs.ts:197-202` |
| B1 | Medium | `split_tailored` treats a line that is exactly `---` as the start of the "changes" list. `resume_reformat` keeps only the text before it, so a resume that contains a `---` separator line would be silently truncated. The tailoring command has the same split (it would move the rest into "changes"). | `commands.rs:457`, `:511`; `jobs.rs:468` |
| B2 | Medium | Tailoring writes a tracker entry with status "preparing" automatically, even if the user then discards the result. Every edit to the tailored text also re-saves the tracker (one localStorage write per keystroke). | `JobsView.tsx` `doTailor`, `TailorPanel onChange` |
| B3 | Low | `webintel::spend_call` reads, increments and writes a small file without a lock. Two calls at the same moment (an answer and a job search) could undercount by one. | `webintel.rs` `spend_call` |
| B4 | Low | `apify_jobs` and `jobs_search` use a fresh cancellation token that is never cancelled, so a running Apify call (up to its 60 s timeout) cannot be stopped from the UI. | `commands.rs` `apify_jobs` |
| B5 | Low | The daily limit counts Firecrawl and Apify only. Tavily and OpenAlex calls are not counted. | `assistant::web_results` |
| B6 | Low | `open_link` accepts any plain-https link to a named host, not only links that came from a job or source row. It blocks IP addresses, localhost, embedded logins and non-https. | `commands.rs` `open_link` |
| B7 | Low | `resumeChecks` in `jobs.ts` is no longer used by the UI (replaced by `usChecks`) but is still exported and tested. | `jobs.ts` |
| B8 | Info | Duplicate jobs across feeds are removed by title plus company only; the same role with a slightly different title appears twice. | `jobs::search` |
| B9 | Info | Match scores for non-technical roles use a word-overlap fallback and can be misleading (an unrelated resume scored 0 in the mock, which is right, but a close one could also score low). | `jobs.ts` `matchJob` |

Privacy: resume text goes to the answer engine on Tailor, Reformat and Cover letter (documented in `docs/PRIVACY.md`). Search words and location go to the job feeds, Apify (if enabled) and OpenAlex/Tavily/Firecrawl for answers. No transcript or audio is sent.

## 6. Prioritized small tasks
1. **Move jobs data to SQLite** (resume, applications, preferences, seen ids) with a one-time import from `localStorage`. Fixes R1; everything else builds on it.
2. **Fix `---` handling** (B1): require the `CHANGES` heading after `---`, with a unit test. Small and safe.
3. **Live smoke test script**: a developer-run check (not in CI) that calls each feed with a tiny query and prints what parsed, so the parsers are verified against real responses. Costs nothing for the free feeds.
4. **Add a job from a URL** with Firecrawl extraction, reusing `firecrawl_scrape`.
5. **Stop auto-creating tracker rows on Tailor** and save on explicit action (B2).
6. **Cancel buttons** for search, reformat and cover letter, plus a cancellation token for Apify (B4).
7. **AI skill-gap explanation** (one short model call over the matched and missing lists).
8. **Atomic usage counter** (B3) and count Tavily too (B5).
9. **Named saved searches** and company notes.
10. **Application pack** (resume + letter + link) in one step.

## 7. Recommended next task: Task 1, durable storage for the job workspace

**Why first:** the tracker and tailored resumes are the user's real work product. They currently sit in a place that is not backed up, not exportable and easy to lose. Every later feature (saved searches, URL import, packs) would add more data to that fragile place.

**Scope:** add tables for the resume, applications and preferences through the existing `migrate.rs`/`db.rs` path (or reuse `store.rs` records if it fits); add commands to load and save them; make `JobsView` use them; import existing `localStorage` data once, then keep a copy until the user confirms.

**Acceptance criteria**
1. After restarting the app, the resume, every tracker card (status, notes, dates, tailored resume, letter) and the search preferences are exactly as left.
2. Existing `localStorage` data from a prior session is imported once with no loss and no duplicates; the import is skipped on later starts.
3. Data is included wherever other user data is exported or backed up, or the docs state clearly that it is not.
4. Clearing browser storage no longer loses any of it.
5. New Rust tests cover save, load, update, delete and the import, using a temporary database; existing 196 Rust and 120 front-end tests still pass; clippy is clean.
6. No change to what users see apart from reliability; no new network calls.

**Out of scope:** auto-submission, new feeds, any paid service.

## 8. Decisions that are the maintainer's
- Whether to run the live smoke test (Task 3) now. It uses only free public feeds.
- Whether any paid provider (Apify, Firecrawl) is worth trialling, and with what daily limit. Nothing has been run against either.
