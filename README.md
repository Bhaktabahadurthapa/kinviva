# MeetingLens

A local-first desktop meeting assistant. It transcribes your meeting audio
live, explains what was just said in plain English, and drafts a short reply
you can review. Meetings are saved on your computer.

> Temporary product name. Independent implementation; see
> [docs/FINDINGS.md](docs/FINDINGS.md) for how the reference app was studied.

**Core flow:** meeting audio → speech recognition → live transcript →
simple-English explanation → suggested reply → local meeting history.

## Features

- **Separate sources:** system audio ("Them") and microphone ("Me"), each with
  status, level meter and errors. Switch microphones mid-meeting.
- **Speech providers:** Deepgram streaming (cloud) or whisper.cpp (local).
- **AI provider:** any OpenAI-compatible Chat Completions endpoint, e.g.
  OpenAI, or Ollama / LM Studio running locally. The model is chosen in
  Settings and never hardcoded.
- **Actions:** Explain, Suggest reply, Recap, Ask. All run on demand, stream
  as they generate, and can be cancelled. Nothing is ever spoken or typed into
  the meeting.
- **Context documents:** TXT, Markdown and PDF, retrieved with SQLite FTS5.
  Every answer lists the passages it used.
- **History:** search, rename, delete, reopen in the assistant, export as
  Markdown or text.
- **Overlay:** movable, resizable, always-on-top companion window.
- **Configurable global shortcuts,** plus optional question highlighting with
  cooldown and duplicate suppression.
- **Privacy:** keys in Keychain / Credential Manager, recordings off by
  default, indicators showing when audio or text goes to a cloud provider, no
  telemetry.

## Requirements

| | macOS (primary target) | Windows |
|---|---|---|
| OS | macOS 13+ (ScreenCaptureKit audio) | Windows 10/11 |
| Toolchain | Rust stable, Node 20+, Xcode Command Line Tools | Rust stable (MSVC), Node 20+, WebView2 |
| Status | Built and verified on macOS 27.0.1 / Apple Silicon | Code path written, **not built or tested** |

Optional, for fully local use:

- `brew install whisper-cpp`, plus a model such as
  [`ggml-base.en.bin`](https://huggingface.co/ggerganov/whisper.cpp/tree/main).
- [Ollama](https://ollama.com) and a model, e.g. `ollama pull llama3.2:3b`.

## Develop

```bash
npm install
```

```bash
npm run tauri dev
```

Tests:

```bash
npm test
```

```bash
cd src-tauri && cargo test
```

Release bundle (unsigned; nothing is published):

```bash
npm run tauri build
```

On first launch, open **Setup**:

1. **Audio:** choose system audio and/or microphone. macOS asks for
   Microphone and Screen & System Audio Recording permission the first time
   you start a meeting. If you deny it, enable MeetingLens (or, in dev, your
   terminal app) under System Settings → Privacy & Security, then restart.
2. **Speech:** paste a Deepgram key, or choose whisper.cpp and pick a model
   file.
3. **AI:** pick a preset, add a key if needed, press **Fetch models** and
   choose one.

Use **History → + Demo** for a sample meeting, clearly marked DEMO, that lets
you explore the AI actions without audio.

### Hardware probes (developer tools)

- `cargo run --example e2e_probe -- <whisper-cli> <model.bin> <llm-base-url> <model> <seconds>`
  captures real system and mic audio, transcribes it, runs the AI actions,
  tests cancellation and checks persistence and export.
- `cargo run --example sck_probe -- <audio-file>` reports the ScreenCaptureKit
  audio format and level while playing a file.
- `VITE_SELFTEST=1 npm run tauri dev` runs a dev-only script that clicks
  through Start → Explain → Suggest reply → overlay → Stop → History.

## Data locations

- Database: `~/Library/Application Support/app.meetinglens.desktop/meetinglens.sqlite`
  (Windows: `%APPDATA%\app.meetinglens.desktop\`).
- Optional recordings: `recordings/<meeting-id>/` next to the database.
- API keys: OS credential store, service `app.meetinglens.desktop`.

More: [Architecture](docs/ARCHITECTURE.md) ·
[Findings & coverage](docs/FINDINGS.md) ·
[Test results & limitations](docs/TESTING.md) ·
[Third-party notices](THIRD_PARTY_NOTICES.md)

## License

Proprietary. Copyright © 2026 Bhakta Thapa. All rights reserved. See
[LICENSE](LICENSE). No rights are granted without a separate written license
or subscription agreement. Third-party components keep their own licenses;
see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), which must ship with
every distributed copy.
