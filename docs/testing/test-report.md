# Test report — 2026-11-04 (this pass)

Executed on macOS (Apple Silicon):

| Check | Result |
|---|---|
| `cd src-tauri && cargo test` | 132 passed, 1 ignored (network) |
| `cargo clippy --all-targets` | no warnings |
| `npx tsc --noEmit` | clean |
| `npx vitest run` | 27 passed |
| `npm run build` | succeeds |
| `npx impeccable detect src/` | see result below |
| Browser preview (mock backend), 1200x780, light and dark | all five destinations open and highlight correctly |

Not tested here: live meetings with a real model after the redesign, microphone-permission-denied flow, offline mode, long conversations, desktop UI automation (none exists yet). Real-model answer quality and latency remain unmeasured.

Earlier history: `docs/TESTING.md`.
impeccable exit: 0


## Phase 2 run (after pause/resume, search, resizable panels, settings sections, interview styles)

| Check | Result |
|---|---|
| `cargo test` | 135 passed, 1 ignored (network) |
| `cargo clippy --all-targets -- -D warnings` | clean |
| `npx tsc --noEmit` | clean |
| `npx vitest run` | 32 passed |
| `npm run build` | succeeds |
| `npx impeccable detect src/` | no findings (regex-only, source files) |
| `npx impeccable detect --json http://localhost:1420/?mock` | `[]` (rendered Meeting screen only) |
| Browser preview (mock backend), 1200x780 | resizer present and keyboard-resizable (48/52 after one arrow press), search box present, six Settings tabs switch sections, Interview shows an answer-style menu |

Failure paths covered by automated tests: invalid API key (401, key never in message), 429 with retry, provider 500, unreachable provider, malformed stream, mid-stream error, cancellation, missing STT engine/model, crashed meeting recovery on next launch, bounded transcript window, pause gate (silence flush, drop, resume).

Not run: microphone-permission-denied (would require changing system permissions), real network-off test, AI request timeout (the 60 s idle limit is untested in CI), real Gemini end-to-end, long live meeting, drag-resize with a real pointer, pause/resume against real audio hardware. These remain unverified.

## Architecture (Mermaid) run
| Check | Result |
|---|---|
| `cargo test` | 149 passed, 1 ignored (network); 7 new `architecture::` tests (evidence downgrades, hostile text, caps, bad links, errors, prompt) and 1 DB test |
| `cargo clippy --all-targets -- -D warnings` | clean |
| `npx tsc --noEmit` | clean |
| `npx vitest run` | 54 passed (13 files): Mermaid parse of generated flowchart/sequence, invalid syntax, large diagram, empty model, hostile labels, source checker, detection and debounce rules, stale-request guard |
| `npm run build` | succeeds; main bundle unchanged (252 kB), Mermaid in lazy chunks |
| `scripts/architecture-browser-check.mjs` (real Chrome) | light and dark render, sequence render, friendly syntax error, 4 rejected inputs, 24-node diagram 87 ms (cached 0 ms), SVG sanitiser, SVG and PNG export (PNG signature valid) |
| `scripts/architecture-security-check.mjs` (real Chrome) | HTML and script labels neutralised; no script ran; **Mermaid strict mode still emits a clickable link for `click … href`** (blocked by MeetingLens' own checks) |
| CSP check | production Mermaid build rendered flowchart, sequence and ER under the app's exact CSP, 0 violations |
| Mock-backend preview 1440x900 | panel renders, 5 nodes and 4 links, dashed inferred items, light and dark |
| Real app | built, signed, installed, launched (process and 1200x780 window present) |

Not tested: the Architecture screen inside the real Tauri window (UI automation was refused: macOS Accessibility permission is not granted to the tool), a live model call from the app, real meetings with speech, SVG/PNG saving through the native save dialog, long sessions.

## Platform transformation run
| Check | Result |
|---|---|
| `cargo test` | 166 passed, 2 ignored (network). New: store (4), studio (9: read-only command guard with 21 allowed and 26 rejected examples, hypotheses, decisions quotes, quiz, plan, board diagram and ops, chart provenance), discover (6) |
| `cargo test -- --ignored the_real_feeds_parse` | passed against the internet: all 8 feeds parse (10 to 25 items each, with dates) and the GitHub search returns repositories |
| `cargo clippy --all-targets -- -D warnings` | clean |
| `npx tsc --noEmit` | clean |
| `npx vitest run` | 74 passed (18 files): board layout and edit commands, charts provenance, incident rules, notes, platform helpers, plus the earlier suites |
| `npm run build` | succeeds; dist 14 MB (whiteboard and charts are lazy chunks) |
| Real Chrome, mock backend | Dashboard, search, Notes (create), Knowledge Base search, Technical (explain tab, architecture generate), Whiteboard (create, AI generate and add, edit-with-words preview and apply, fonts load locally), charts (build, table), Classroom tool, Discover list, Learning goal creation |
| CSP check (production build, app CSP) | Excalidraw rendered and exported SVG, PNG and JSON with no violations except blocked attempts to reach its CDN font fallback |

Not tested: any screen in the real Tauri window, real model output for the new tools, native save dialogs for board and chart export, Discover refresh from inside the app (the parsing was tested with live data in Rust), Windows.

