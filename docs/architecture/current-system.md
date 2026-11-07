# Kinviva — current system (audited 2026-11-04)

Audited from the repository itself, not from earlier documentation.

## Stack
- **Shell:** Tauri 2 (Rust). Two windows: `main` and a transparent always-on-top `overlay` (macOS private API enabled for transparency).
- **Frontend:** React 18 + TypeScript + Vite, plain CSS (`src/styles.css`, token-driven). No state library: a reducer (`src/lib/liveReducer.ts`) fed by Tauri events.
- **Storage:** SQLite (rusqlite) in the app data dir; FTS5 for document search. Migrations 1–4. API keys in the OS credential store (macOS Keychain) via `keyring`, cached in memory once per run.
- **Audio:** mic and system audio capture (`src-tauri/src/audio`), VAD segmentation (`stt/vad.rs`).
- **Speech to text:** `whisper_native` (bundled C++ helper in `native/`), `whisper_cli` (external binary), `deepgram` (cloud, websocket). Currently selected on the dev machine: `whisper_cli`.
- **AI:** OpenAI-compatible streaming client (`llm.rs`): timeout, cancellation, optional-field retry on 400, retry with backoff on 429/503 (max 2, honours `Retry-After`), readable provider errors including Gemini's array-shaped error body.
- **Web search:** optional Tavily (`websearch.rs`), 3 s budget.

## Data flow
mic/system audio → VAD segments → STT provider → `transcript.rs` (partial/final, dedupe) → events to UI + `auto_assist.rs` (settle 300 ms, plan Explain vs Suggest) → `assistant.rs` (build prompt from `prompts.rs`/`session.rs`/`skills.rs`, retrieve passages from `db.rs`, optional web) → `llm.rs` stream → `session::normalize_answer` (only app-verified citations survive) → saved in `ai_messages` → UI.

Interview mode is a separate path: `interview.rs` (skills allowlist, roles, Explain/Practice/Question, strict JSON with plain-text fallback, `interview_entries`).

## Destinations (sidebar)
Meeting · Interview · Sessions · Knowledge · Settings (+ Overlay toggle). Meeting hosts the session type (Class / Work / General) and live view; Sessions is saved meetings with export (Markdown / Word / Text); Knowledge holds courses and resources (PDF, DOCX, TXT, MD).

## Status checklist
**Existing and working** (verified by tests or by running the app): live capture and transcription; streaming answers; hard-word explanations; question detection; Class/Work/General sessions; course-scoped retrieval with citation validation; Interview coach (3 modes); exports; overlay (auto on minimize, clear mode); keychain storage with single read per run; 132 Rust tests, 27 frontend tests.

**Existing but fragile**
- Answer quality and latency depend on the provider tier; free-tier Gemini returns HTTP 429 during live meetings (now retried and surfaced in the UI).
- macOS permissions and Keychain access are tied to the code signature; local builds use a self-signed identity, so a signature change resets them. Not notarized.

**Partially implemented**
- Speaker labels: only the audio *channel* (Them = system audio, Me = microphone). No diarization.
- Settings are one long page, not sectioned navigation.
- Export: Markdown, Word, Text only. No PDF.

**Missing (candidates, not yet built)**
- Pause / Resume capture.
- Transcript search and copy-selection helpers.
- Resizable panels.
- Editable meeting title while live.
- Windows build is untested.
- Desktop UI automation tests.

**Optional future:** diarization, notarized distribution, offline answer model.

## Security notes
Keys never leave the credential store except in the Authorization header to the configured provider; not logged, not in exports. Transcript, notes and documents are fenced as data in prompts. CSP is restrictive. Overlay uses content protection (hidden from screen capture on supported OSes). Recording consent is the user's responsibility; the UI states when audio or text goes to a cloud host.
