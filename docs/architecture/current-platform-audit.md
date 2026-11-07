# Current platform audit

Audit of the repository as it stands on `main` at commit `d9ebacb` (version 0.1.5 in `tauri.conf.json`). Written before any implementation for the "platform transformation" brief. Nothing described here has been changed by this document.

## 1. Stack and versions
| Layer | What is used | Version |
|---|---|---|
| Shell | Tauri 2 (`macos-private-api`) | `tauri` 2.12.5, `tauri-build` 2.7.4, CLI 2.12.4 |
| Backend | Rust 2021, tokio, reqwest (rustls), tokio-tungstenite | reqwest 0.12.28 |
| Frontend | React, TypeScript, Vite, Vitest | React 18.3, TS 5.6, Vite 6, Vitest 3 |
| Diagrams | Mermaid (lazy-loaded), dev-only jsdom | mermaid 12.3.0 |
| Storage | SQLite (bundled, FTS5), versioned migrations | rusqlite 0.37 |
| Secrets | OS credential store (macOS Keychain) | keyring 3.6.3 |
| Audio | cpal (mic), ScreenCaptureKit (system audio, macOS) | cpal 0.16, screencapturekit 1.5.4 |
| Speech | `whisperd` native sidecar (whisper.cpp), `whisper-cli` process, Deepgram WebSocket | see `native/whisperd` |
| Router | none: a `tab` state in `App.tsx` (seven destinations incl. Settings) | n/a |
| Version mismatch | `src-tauri/Cargo.toml` says 0.1.1; `tauri.conf.json` and `package.json` say 0.1.5 (the bundle uses `tauri.conf.json`) | cosmetic, to tidy |

Size: about 7.7k lines of Rust in `src-tauri/src`, about 5.5k lines of TypeScript/TSX, installed app about 26 MB.

## 2. Identity and data (must be preserved)
- Product name `Kinviva`, bundle identifier `app.meetinglens.desktop`.
- Data directory `~/Library/Application Support/app.meetinglens.desktop/` with `meetinglens.sqlite` (+ WAL) and `tmp/`.
- Schema versions 1 to 5 in `db.rs` (`PRAGMA user_version`). Tables: `settings`, `meetings`, `segments`, `ai_messages`, `documents`, `doc_chunks` (+ FTS5 index), `courses`, `interview_entries`, `diagrams`. Migrations are append-only and tested for idempotence and re-open.
- Secrets: only `deepgram_api_key`, `llm_api_key`, `web_search_key` are allowed names (`secrets.rs`), stored in the Keychain, never in SQLite.
- Local code signing certificate "Kinviva Dev" keeps microphone/screen/Keychain permissions stable across rebuilds (`scripts/build-mac-app.sh`).

## 3. Audio and transcription pipeline (existing, working)
- `audio/cpal_capture.rs` (microphone), `audio/macos_system.rs` (ScreenCaptureKit system audio), `audio/resample.rs`.
- `meeting.rs` runs the session: two sources ("Them" = system audio, "Me" = mic), a pause gate that sends 1.2 s of silence then drops audio, optional audio recording to disk (off by default).
- `stt/`: `native.rs` + `native/whisperd` sidecar, `whisper_cli.rs`, `deepgram.rs`, `vad.rs`, `local.rs`. Partial and final transcripts are separate (`transcript.rs`: `finals` and `partials`); finals carry id, source, start and end time.
- Speaker labels are limited to the two sources (Them / Me). No per-person diarization.
- Raw audio stays local unless the user picks Deepgram (a disclosure pill says where audio goes).

## 4. AI layer (existing, working)
- `llm.rs`: one OpenAI-compatible streaming client (SSE), retry on 429/503 with `Retry-After`, optional-field fallback (`response_format`, `reasoning_effort`), image content parts, readable errors. Providers are chosen in Settings → Answer engine (OpenAI, Gemini, OpenRouter, Mistral, xAI, local Ollama and others by base URL).
- `assistant.rs` + `prompts.rs`: four actions (Ask, Explain, Suggest reply, Recap), document retrieval, optional web search (Tavily, user key), source labels, citations, "about me" guard so the model never invents the user's experience.
- `auto_assist.rs` + `question.rs`: finalized-sentence auto answers, question detection with cooldown and duplicate suppression, concurrency cap, interview-live gate.
- `interview.rs` + `src-tauri/skills/` (4 bundled coaching skills): practice modes, answer styles, JSON schema validation, saved entries.
- `screen.rs`: Read my screen (macOS only, screenshot to a vision model, deleted after use).
- `architecture.rs`: validated architecture model (evidence labels) used by the Architecture screen.
- Stale-response control: request ids, cancel tokens (`ai_tasks`), `latestGuard` on the front end. Automatic answers are scoped to a transcript segment id.

## 5. UI
- Single window plus an always-on-top transparent overlay. Sidebar destinations: Meeting, Interview, Architecture, Sessions, Knowledge, Settings (+ Overlay toggle).
- Light default, dark via system or Settings → Appearance (theme, text size, font), tokens in `src/styles.css` with a `.app` "professional" layer; documented in `docs/DESIGN_SYSTEM.md` and `DESIGN.md`.
- No router library, no breadcrumbs, no global search, no notifications, no user profile, no keyboard navigation between destinations beyond native focus.

## 6. Tests, CI and release
| Item | State |
|---|---|
| Rust tests | 149 passed, 1 ignored (network); `clippy -D warnings` clean |
| Frontend tests | 54 passed (13 files); `tsc --noEmit` clean; `npm run build` succeeds |
| Browser checks | `scripts/architecture-*-check.mjs` (real Chrome) |
| CI | `pages.yml` deploys `site/`; `windows.yml` builds the Windows installer on demand. **No workflow runs tests on push.** |
| Release | manual: `scripts/build-mac-app.sh` (signed with the local cert), `gh release create`, Windows installer via `windows.yml`, then promote to Latest |
| Updates | no auto-updater; users download from Releases |
| Notarization | not notarized; first open needs right-click → Open |
| Windows | experimental, unsigned |

## 7. Security posture
- CSP: `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src ipc: http://ipc.localhost`. Any feature that fetches from the internet from the web view (Discover, GitHub) must go through Rust commands, not the CSP.
- Tauri capabilities are minimal (`core:default`, window actions, dialog open/save). Entitlement: audio input.
- Untrusted-data rules in every prompt; model output is re-validated (interview JSON, architecture model); Mermaid locked down and its link-rendering behaviour covered by Kinviva' own checks.

## 8. Gap analysis against the brief
Legend: ✅ exists, 🟡 partly, ❌ missing.

| Brief item | Status | Notes |
|---|---|---|
| Keep name, bundle id, data, Keychain, migrations | ✅ | rules above |
| Shared conversation engine (capture → STT → finals → question detection → answers → persistence → cancel) | ✅/🟡 | works for Meeting and Interview. Missing: formal intent classification, per-mode context permissions, recovery after a crash mid-session |
| Meeting Copilot: live transcript, explain, suggest, recap, questions | ✅ | |
| Meeting: decisions, action items with owners/deadlines, follow-up notes, saved moments, cross-session retrieval | ❌ | needs new prompt schema and tables |
| Interview Copilot: practice, styles, mock, STAR, history, grounded in documents | ✅/🟡 | missing job-description analysis, adaptive follow-ups beyond one question, resume/project "verified experience" structure |
| Classroom Copilot | 🟡 | "Class" sessions with course files and week scope exist; no lecture notes, study guides, practice questions, progress |
| Technical Copilot | 🟡 | expert skills for questions + Architecture screen exist. Missing: troubleshooting workflow (safe read-only commands, risk), incident tracker, repository and log sources, runbooks |
| Presentation Copilot | ❌ | |
| Whiteboard (Excalidraw), AI object editing, revision history | ❌ | Excalidraw and Recharts not installed |
| Charts (Recharts) | ❌ | |
| Discover | ❌ | needs network collectors, source list, ranking, privacy consent |
| My Learning | ❌ | |
| Knowledge Base | 🟡 | documents + FTS5 retrieval exist; no notes entity, no unified search across sessions, notes, diagrams |
| Dashboard with real local metrics | ❌ | today the app opens on Meeting |
| 19-item navigation | ❌ | 6 destinations exist; many items would be empty until their features exist |
| Global search, notifications, profile, Community/Pro | ❌ | |
| Cloud: accounts, Stripe, entitlements | ❌ | no backend exists; see migration plan |
| Export | 🟡 | session export (Markdown, Word, text); diagram SVG/PNG |

## 9. Dependency and licence check
Verified: the current runtime JavaScript tree and Rust crates are listed in `THIRD_PARTY_NOTICES.md`; Mermaid's 114 dependencies are included (MIT, ISC, Apache-2.0, BSD-3-Clause, Unlicense; two dual-licensed packages used under permissive terms).
Not yet verified (check at install time, before adding): `@excalidraw/excalidraw` (expected MIT; requires React 18, which matches; large bundle and its own fonts), `recharts` (expected MIT, depends on d3 packages), Stripe SDKs (server side only). Do not assume; run the same dependency-tree licence script used for Mermaid.

## 10. Broken, incomplete or unverified today
- Read my screen on the user's Mac, interview auto-answers with a real interviewer, mic-denied and offline paths: unverified.
- The Architecture screen has not been exercised inside the real Tauri window (UI automation blocked by missing Accessibility permission).
- Release 0.1.5 is committed and pushed but **not released** (the installer build was interrupted); downloads are still 0.1.4.
- Not notarized; no auto-update; Windows experimental.
