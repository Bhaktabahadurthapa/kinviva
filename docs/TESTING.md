# Test results and remaining limitations

Host: macOS 27.0.1, Apple Silicon (arm64), Rust 1.97.1, Node 26.13.
Run 2026-11-03.

## Automated tests

| Suite | Command | Result |
|---|---|---|
| Rust unit/integration | `cd src-tauri && cargo test` | **43 passed**, 1 ignored (network); `cargo clippy --all-targets` clean |
| Rust network (real Deepgram endpoint, invalid key) | `cargo test -- --ignored` | **1 passed**: HTTP 401 is reported as a readable error and the key does not appear in the message |
| Frontend reducer | `npm test` | **6 passed** |
| Type check | `npx tsc --noEmit` | clean |
| Release bundle | `npm run tauri build -- --bundles app` | builds `MeetingLens.app` (19 MB, unsigned), launches; dev self-test code absent from the production JS |

Coverage by area:

- **Local speech provider loop:** a stand-in `whisper-cli` drives partials, a final after silence and a flush of the open utterance on stop.
- **Transcript handling:** partial replaced by the final for the same source
  only, duplicate finals ignored, a new meeting clears state, the prompt
  window is bounded and chronological with in-progress text flagged,
  oversized segments are truncated, Deepgram interim/final/empty/metadata
  parsing, utterance segmentation (silence end, max length), whisper
  annotation filtering.
- **Persistence:** migrations idempotent, data survives reopen, search, cascade
  delete, crashed meetings closed on next launch, FTS retrieval honours
  active/removed documents.
- **Provider failures:** 401 (key never leaked), 503, unreachable host,
  missing model, empty response, mid-stream provider error, malformed
  stream, missing whisper model file, real Deepgram rejection.
- **Cancellation:** a slow stream is cancelled after the first delta in under
  900 ms with no further deltas.
- **Export:** Markdown and text contain the transcript, notes and completed AI
  output, and exclude cancelled partial output.
- **Documents:** chunk overlap, stop-word query building with quoting (FTS
  syntax injection), TXT/MD extraction, unsupported/empty files, non-PDF and
  malformed PDF errors.

## Hardware verification on this Mac (real audio, local providers)

Setup: whisper.cpp 1.9.4 `whisper-cli` + `ggml-base.en.bin`; Ollama
`llama3.2:3b` at `http://localhost:11434/v1`. A synthesized spoken question
(`say`) was played through the default output (AirPods) with `afplay`.

| Check | Result | Evidence |
|---|---|---|
| System audio reaches transcription | ✅ 8 partial updates then one final, word-accurate | `evidence/probe3.log`, `evidence/ui-answered.png` |
| Mic handled separately | ✅ separate "Me" stream and device (AirPods mic / MacBook mic). Room noise was captured; whisper's noise annotations are now filtered | `ui-answered.png` |
| Transcript updates appear in the UI | ✅ live in the main window and the overlay | `ui-answered.png`, `ui-overlay.png` |
| AI responses stream and can be cancelled | ✅ first token ~0.4–0.5 s; cancel after 3 deltas returned in ~240 ms; Cancel button shown while streaming | `probe3.log`, `ui-answered.png` |
| Saved meetings survive restart | ✅ app process restarted (new PID); meeting, transcript and AI output listed in History | `ui-after-restart.png` |
| Exported files contain the correct content | ✅ probe export contains every segment and response (plus unit tests) | `probe3.log` |
| Stopping releases capture resources | ✅ ScreenCaptureKit stream stopped and mic stream dropped, capture threads joined in 14–29 ms; speech tasks ended immediately after | `probe3.log` |
| Overlay | ✅ always-on-top, frameless, transparent window shown via command and shortcut path | `ui-overlay.png` |
| Auto-assist, hands-free (14:23–14:24) | ✅ with real meeting audio playing, every finished "Them" sentence got an automatic "In simple words" note beside it (jargon as bullets), and a question got an automatic "You could say" answer with detail bullets — no clicks. Superseded requests are cancelled by newer speech by design | `ai_messages` rows for the 14:23/14:24 meetings |
| Repeat run after hardening (08:24) | ✅ real meeting saved (`is_demo = 0`) with the spoken question as a "Them" segment, no noise lines from the mic, Explain and Suggest reply saved as `done` | `ui-answered.png`, `ui-history.png` |

Release-build fix: on macOS 27, Cargo's default release stripping produced proc-macro dylibs that dyld rejected. `Cargo.toml` now sets `strip = "none"` for `profile.release.build-override` (build-time artifacts only).

Bug found and fixed during verification: requesting
`excludesCurrentProcessAudio` made ScreenCaptureKit deliver silent buffers
for audio played by processes started from the same app (diagnosed with
`examples/sck_probe.rs`). The flag was removed.

## Not verified (exact gaps)

- **Deepgram live transcription:** no API key yet. URL building, message
  parsing and real rejection are tested; real streaming transcripts are not.
- **Cloud AI providers (OpenAI etc.):** no API key yet. The same client was
  verified against Ollama's OpenAI-compatible endpoint; OpenAI itself is
  untested.
- **Windows (experimental):** the first Windows build (GitHub Actions, `windows-latest`) ran the 4+ frontend tests, type check and 47 Rust unit tests successfully and produced a 5.5 MB NSIS installer; its checksum was recorded and it was published as experimental. **Not done:** installing or running it on real Windows hardware, so WASAPI loopback capture, microphone access, Credential Manager storage, the SmartScreen flow and the whisper-cli.exe setup are all unverified. (Earlier note, now partly superseded:) WASAPI loopback and mic code compile only under Windows and
  were **not built or run**. Credential Manager is untested.
- **Clicking through the UI by hand:** this session had no Accessibility
  permission, so UI flows were driven by the dev-only `VITE_SELFTEST` script,
  which clicks the real DOM buttons. Native save dialogs (export), file
  pickers (documents), the settings form and global shortcut key presses were
  not exercised end to end in the GUI; their backend paths are tested.
- **Microphone switching mid-meeting and device unplug:** implemented
  (`switch_mic`, cpal device-lost faults) but not exercised with hardware.
- **First-run permission prompts:** this dev binary inherited permissions
  already granted to its parent app. Prompts for a freshly installed,
  unsigned bundle were not observed.
- **Screen-capture exclusion of the overlay:** not tested against any
  sharing tool. It is labelled best-effort and off by default.
- **Compatibility with specific meeting apps** (Zoom, Teams, Meet) was not
  tested. Any app whose audio plays through the system mix should be
  captured; this is not guaranteed.
- **Auto-assist cost and privacy:** it calls the AI after every finished sentence from the other side (after a 2 s pause, sentences of 6+ words). With a cloud provider this streams the conversation continuously and uses tokens accordingly. An automatic answer can replace a reply you are still editing in the reply panel; the side-by-side notes keep every answer.
- **Concurrent instances:** fixed a clash where two running copies shared whisper temp files (now unique per process and clip).
- **Detailed, labelled answers:** Explain now uses `Meaning / Details / Terms / Unclear` and answers use `Answer / Details / Fill in`, with the newest lines passed as the focus. In a side-by-side trial on a few real passages, `llama3.2:3b` added filler and stray tags, while `qwen2.5:7b` followed the format and was more accurate. A 7B local model still invented tools and libraries when asked about the user's own work, so with no notes or documents the app now gives **coaching tips** ("Say which method you used") instead of speaking for the user, and rhetorical questions return no answer. The trial transcripts contained meeting content and are deliberately not published.
- **Answer quality:** with a 3B local model, explanations were accurate. One
  suggested reply added a mild opinion ("we should review the tutorial")
  despite instructions. Larger models should follow the grounding rules
  better; replies are always for you to review.
- **Optional local models:** whisper.cpp (speech) and any OpenAI-compatible
  local server (AI) are supported. No model is bundled or downloaded by the
  app.
- **REA runtime observation of NexQ:** passive only (launch, sockets, files, window capture); no workflows exercised. See `FINDINGS.md`.
