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
