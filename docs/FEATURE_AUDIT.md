# Feature audit

Audit date: 2026-11-07. Version audited: 0.1.5 (`main`). Method: every feature below was traced to the source files
that implement it, then checked against the automated tests that exist and against what has actually been tried on real
hardware. README claims were not used as evidence.

**Status key**
- **Working**: implemented, covered by tests where noted, and used on real hardware by the owner.
- **Partial**: implemented, but a real part is unverified, missing, or depends on something the user must supply.
- **Experimental**: implemented but not verified on real hardware or real accounts.
- **Missing**: promised or planned, not in the code.

**Evidence key**: `T` = automated tests exist (Rust `cargo test` or front-end `vitest`); `M` = tried by the owner in the real app;
`P` = checked only in a browser preview with sample data; `-` = none.

Automated test totals at this audit: **178 Rust unit tests** (2 ignored: they need network) and **83 front-end tests**.
Tests cover logic, validators and prompt construction. They do not drive the real desktop window, real audio devices or a real answer engine.

## 1. Capture and transcription

| Feature | Source files | Status | Evidence | Edition | Notes and risks |
|---|---|---|---|---|---|
| System audio capture, macOS | `src-tauri/src/audio/macos_system.rs`, `audio/mod.rs` | Working | M | Community | ScreenCaptureKit; needs Screen & System Audio permission. |
| System audio capture, Windows | `audio/cpal_capture.rs` (`start_loopback`), `audio/mod.rs` | Experimental | CI build only | Community | WASAPI loopback. Never tested on Windows hardware by the owner. |
| Microphone capture | `audio/cpal_capture.rs`, `audio/resample.rs` | Working | T (resample), M | Community | |
| Local speech recognition (bundled engine) | `native/whisperd/`, `stt/native.rs`, `stt/vad.rs` | Working (macOS), Experimental (Windows) | T (8+2), M | Community | C++ helper using whisper.cpp (MIT). Models are not bundled; the user supplies one. |
| Local speech recognition (CLI) | `stt/whisper_cli.rs`, `stt/local.rs` | Working | T | Community | |
| Cloud speech recognition (Deepgram, own key) | `stt/deepgram.rs` | Partial | T (4) | Community | Needs the user's key. Not exercised against the live service by automated tests. |
| Question detection | `question.rs` | Working | T (4) | Community | Heuristic, English only. |

## 2. Answers, explanations and history

| Feature | Source files | Status | Evidence | Edition | Notes and risks |
|---|---|---|---|---|---|
| Explain, Suggest reply, Recap, Ask | `assistant.rs`, `prompts.rs`, `auto_assist.rs`, `src/components/ActionBar.tsx`, `ManualAnswers.tsx`, `SimpleStream.tsx` | Working | T (18 prompts, 5 auto), M | Community | Quality depends on the answer engine the user connects; not measured. |
| Reading pane (numbered steps, Now and Earlier, search) | `src/components/SimpleStream.tsx`, `answerLog` in `src/lib/answerLog.ts` | Working | T (6), M | Community | Earlier answers are kept in memory only, not saved with the session. |
| Answer level, length, "Remember it", "Check yourself" | `prompts.rs` (`style_note`), `src/components/AnswerStyle.tsx`, `AiText.tsx` | Partial | T (prompt text), P | Community | Effect on real answers unmeasured. |
| My instructions (About me, per screen) | `prompts.rs` (`custom_note`), `settings.rs`, `InstructionsPanel.tsx`, `commands.rs` (`instructions_preview`) | Partial | T (2), P | Community | Appended after the app's own rules. Test box not built. |
| Answer engine: any OpenAI-compatible endpoint, local or cloud, user's own key | `llm.rs`, `secrets.rs`, `SettingsView.tsx` | Working | T (13 llm, 1 secrets), M | Community | Keys live in the OS credential store. |
| Optional web search for answers | `websearch.rs` | Experimental | T (4) | Community (optional) | Needs the user's search key; sends the query to that provider. |
| Documents and course files (PDF, Word, text, Markdown) with cited answers | `docs.rs`, `session.rs`, `DocumentsView.tsx`, `ResourcesView.tsx` | Working | T (10 docs, 7 session), M | Community | Local full-text index. |
| Session history, Trash, export (Word, Markdown, text) | `db.rs`, `store.rs`, `export.rs`, `HistoryView.tsx`, `SavedDialog.tsx` | Working | T (11 db, 8 export, 4 store), M | Community | Trash purge deletes audio and linked items on request. |
| Decisions and action items (verified quotes) | `studio.rs`, `DecisionsDialog.tsx` | Working | T | Community | Quotes are checked against the transcript. |

## 3. Interview, classroom, presentation

| Feature | Source files | Status | Evidence | Edition | Notes and risks |
|---|---|---|---|---|---|
| Interview answers, practice, mock questions | `interview.rs`, `skills.rs`, `src-tauri/skills/*/SKILL.md`, `InterviewView.tsx` | Working | T (21 interview, 6 skills), M | Community (basic) | Four bundled coaching skills; their provenance must be confirmed (see LICENSING_REVIEW). |
| Interviewer question bar | `InterviewView.tsx` | Partial | P | Community | Only seen with simulated events. |
| Enhanced interview workflows (planned) | - | Missing | - | Pro | Not implemented. |
| Classroom: I'm lost, announcements, notes, study guide, flashcards, quiz, homework hints | `studio.rs`, `ClassroomView.tsx`, `ClassItems.tsx`, `Flashcards.tsx`, `QuizRunner.tsx` | Partial | T (9 studio), P | Community (basic) | Real answer quality unverified. Integrity notice shown. |
| Presentation: speaker notes, rehearsal feedback, audience questions | `studio.rs`, `PresentationView.tsx` | Partial | T | Community | |
| Presentation maker (editable .pptx) | `src/lib/deck.ts`, `DeckMaker.tsx`, `DeckEditor.tsx`, `studio.rs` (`slide_deck`) | Partial | T (1 plan check), file validated with the pptx validator | Community now; advanced reports are Pro candidates | Not opened in real PowerPoint by the owner. |

## 4. Technical Copilot, diagrams, notes, visuals

| Feature | Source files | Status | Evidence | Edition | Notes and risks |
|---|---|---|---|---|---|
| Explain a term or point | `studio.rs`, `technical/ExplainTool.tsx` | Working | T | Community | |
| Safe troubleshooting (read-only commands only) | `studio.rs` (`is_read_only`), `TroubleshootTool.tsx` | Working | T (guard test lists allowed and refused commands), M | Community | Commands are never run by the app. |
| Incident tracker | `src/lib/incident.ts`, `IncidentTool.tsx` | Working | T | Community | |
| Architecture diagrams from conversation (Mermaid) | `architecture.rs`, `src/components/architecture/*`, `src/lib/architecture.ts` | Working | T (7 + front-end), M | Community (basic) | Own sanitizer for Mermaid output. |
| Agent-driven investigations (planned) | - | Missing | - | Pro | Not implemented. Nothing in the app runs commands. |
| Advanced diagram generation and reports (planned) | - | Missing | - | Pro | |
| Whiteboard (Excalidraw) with diagram generation | `WhiteboardView.tsx`, `src/lib/board.ts`, `studio.rs` | Working | T (board), M | Community | Excalidraw is MIT; fonts bundled locally. |
| Visuals: charts from pasted tables, CSV export, library | `VisualsView.tsx`, `src/lib/charts.ts` | Partial | T (6), P | Community | Numbers are never invented; each shows its source. |
| Notes: rich editor, folders, pins, tags, trash | `NotesView.tsx`, `NoteEditor.tsx`, `src/lib/noteDoc.ts` | Partial | T (4), P | Community | New in 0.1.5; not compared with a reference app on screen. |
| Discover (hourly feed from official sources) | `discover.rs`, `DiscoverView.tsx` | Working | T (10), M | Community | Contacts 8 public feeds and GitHub search when turned on. |

## 5. Platform

| Feature | Source files | Status | Evidence | Edition | Notes and risks |
|---|---|---|---|---|---|
| Video Assist (video pane, Previous/Next, full screen) | `WatchStage.tsx`, `commands.rs` (`video_*`), `focus.ts` | Partial | T (address rules), M for YouTube | Community | Native web view layered over the window; hides behind dialogs. Depends on third-party sites. |
| Overlay hidden from screen sharing | `Overlay.tsx`, `commands.rs` (content protection) | Working on macOS | M | Community | Uses the OS "exclude from capture" flag; not a guarantee against all capture methods. |
| Read my screen | `screen.rs`, `ScreenAssist.tsx` | Working | T (2), M | Community | Screenshot goes to the user's answer engine only when pressed (or automatic mode if enabled). |
| Dashboard, global search, appearance, shortcuts | `DashboardView.tsx`, `TopBar.tsx`, `shortcuts.rs`, `appearance.ts` | Working | T (partial) | Community | |
| Settings, credential store, first-launch migration | `settings.rs`, `secrets.rs`, `migrate.rs` | Working | T (3), M for data copy | Community | Key migration untested end to end. |
| Windows installer | `.github/workflows/windows.yml` | Experimental | CI only | Community | No Windows hardware testing yet. |

## 6. Not in the code (do not claim)

Accounts and sign-in, licensing keys, managed AI, organization administration, shared workflows, usage metering, security policies,
auto-update, crash reporting, telemetry. None of these exist. A search of the source finds no analytics or telemetry code.

## 7. Gaps found during the audit

1. No automated end-to-end test of the real desktop app, audio capture or answer engine. Quality of answers is unmeasured.
2. Windows has never run on hardware.
3. No signed or notarized macOS build and no auto-update (see RELEASE_READINESS.md).
4. The repository license is proprietary while the repository is public (see LICENSING_REVIEW.md).
5. `docs/FINDINGS.md` records static analysis of a competitor's released app (see LICENSING_REVIEW.md).
