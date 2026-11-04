<div align="center">

<img src="docs/media/architecture-hero.png" alt="MeetingLens: system audio and microphone flow through speech-to-text into a live transcript; the assistant combines recent lines with document passages, asks a local or cloud model, and shows answers in the window and overlay while meetings are saved on device." width="100%">

<br>

### A desktop meeting assistant that hears the call, explains it in plain English, and drafts a reply you can edit. Local-first. No telemetry.

<br>

![platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20(experimental)-1b1814?style=flat-square&labelColor=110f0d)
![tauri](https://img.shields.io/badge/Tauri-2-1b1814?style=flat-square&labelColor=110f0d)
![rust](https://img.shields.io/badge/Rust-backend-1b1814?style=flat-square&labelColor=110f0d)
![react](https://img.shields.io/badge/React-18%20%2B%20TS-1b1814?style=flat-square&labelColor=110f0d)
![tests](https://img.shields.io/badge/tests-49%20passing%20(local)-9cc8a0?style=flat-square&labelColor=110f0d)
![local-first](https://img.shields.io/badge/local--first-whisper.cpp%20%2B%20Ollama-ff5f2e?style=flat-square&labelColor=110f0d)
![license](https://img.shields.io/badge/license-proprietary-463e34?style=flat-square&labelColor=110f0d)

**[⬇ Download](https://github.com/Bhaktabahadurthapa/meetinglens/releases/latest/download/MeetingLens.dmg)** · **[Website](https://bhaktathapa.com.np/meetinglens/)** · **[Demo](#demo)** · **[Features](#features)** · **[How it works](#how-it-works)** · **[Quickstart](#quickstart)** · **[Privacy](#privacy)** · **[Docs](#docs)**

</div>

---

## Demo

<div align="center">

[![MeetingLens demo: live transcript, plain-English explanation and suggested reply](docs/media/meetinglens-demo.gif)](docs/media/meetinglens-demo.mp4)

**[▶ Watch the full 36-second demo (MP4, 1080p)](docs/media/meetinglens-demo.mp4)**

</div>

Every screen in the video is a real capture of MeetingLens on macOS, with
system audio transcribed by whisper.cpp and answers from a local Ollama
model. The video is built with Remotion from [`demo-video/`](demo-video/).

## Features

| | |
|---|---|
| 🎧 **Two channels** | Other participants ("Them", system audio) and you ("Me", microphone), each with status, a level meter and clear errors. Switch microphones mid-meeting. |
| 📝 **Live transcript** | Partial text appears as people talk and settles into timecoded final lines. |
| ⚡ **Hands-free reading view** | **Auto-assist** (on by default): the screen splits into *Captured audio* on top and *In simple words* below. When someone else finishes a sentence, its meaning appears below in large, plain language, and questions get a draft answer — no clicks. Switch to *Explain only* or *Off* any time. |
| 💬 **Explain** | The latest point in short, plain-English sentences that keep the speaker's meaning and flag what the transcript left unclear. |
| ✍️ **Suggest reply** | A short, editable draft grounded in the transcript, your notes and your documents. It never invents your experience, and nothing is sent into the meeting. |
| 🧭 **Recap and Ask** | Bullet recap of the meeting so far, or a direct question answered from what was said. |
| 📚 **Documents** | TXT, Markdown and PDF, indexed with SQLite FTS5. Every answer lists the passages it used. |
| 🪟 **Overlay** | A movable, resizable, always-on-top companion window. |
| 🗂️ **History** | Search, rename, reopen in the assistant, export Markdown or text. |
| ⌨️ **Shortcuts** | Configurable global shortcuts, plus optional question highlighting with cooldown and duplicate suppression. |

Answers stream as they generate and can be cancelled. With Auto-assist off, the AI runs only when you press a button.

## How it works

```
Them (ScreenCaptureKit) ─┐
                         ├─► speech-to-text ─► live transcript ─► SQLite history
Me (cpal / CoreAudio) ───┘   whisper.cpp |          │
                             Deepgram               ▼
                       your documents ─► assistant ─► language model
                       (FTS5 passages)      │        Ollama | OpenAI-compatible
                                            ▼
                                   window + overlay
```

One Tauri 2 app: a Rust backend for native audio, speech providers, SQLite
and the OS keychain, and a React + TypeScript interface. No server, no
account. Details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

| Layer | Choices |
|---|---|
| Speech-to-text | **whisper.cpp** on device (bundled C++ engine in the Mac app, or the `whisper-cli` tool), or **Deepgram** streaming |
| Language model | **Ollama** / LM Studio on device, or any OpenAI-compatible API. You pick the model; none is hardcoded. A 7B model such as `qwen2.5:7b` is recommended over 3B for accuracy. |
| Storage | SQLite with versioned migrations, on device |
| Secrets | macOS Keychain / Windows Credential Manager |

## Quickstart

**Requirements:** macOS 13+, Rust stable, Node 20+, Xcode Command Line Tools.

```bash
git clone https://github.com/Bhaktabahadurthapa/meetinglens.git
```

```bash
cd meetinglens && npm install && npm run tauri dev
```

For a fully local setup (free, nothing leaves your Mac):

```bash
brew install ollama && ollama pull qwen2.5:7b
```

Download a Whisper model such as
[`ggml-small.en.bin`](https://huggingface.co/ggerganov/whisper.cpp/tree/main)
(more accurate than base). The speech engine itself is built into the Mac app;
when running from source, build it once with `./native/whisperd/build.sh`
(needs `cmake` and a C++ compiler) or install `whisper-cpp` and choose the
command-line tool in Settings.
Then open **Setup** in the app:

1. **Audio:** choose system audio and/or microphone. macOS asks for
   Microphone and Screen & System Audio Recording permission the first time
   you start a meeting.
2. **Speech:** choose whisper.cpp and pick the model file, or paste a
   Deepgram key.
3. **AI:** pick the Ollama preset (or add an API key), press **Fetch models**
   and choose one.

No audio handy? **History → + Demo** adds a sample meeting, clearly marked
DEMO, so you can try the AI actions.

## Install as a Mac app

**Just want the app?** **[⬇ Download MeetingLens.dmg](https://github.com/Bhaktabahadurthapa/meetinglens/releases/latest/download/MeetingLens.dmg)**
(direct download, 7.9 MB, Apple Silicon). Checksums and notes are on the
[release page](https://github.com/Bhaktabahadurthapa/meetinglens/releases/latest);
the [website](https://bhaktathapa.com.np/meetinglens/) has the same button.

To build it yourself instead, create a normal app you can drag into Applications (Apple Silicon Mac, macOS 13+):

```bash
./scripts/build-mac-app.sh
```

This creates `dist-mac/MeetingLens.app` and `dist-mac/MeetingLens_0.1.1_aarch64.dmg`.
Open the DMG, drag **MeetingLens** onto **Applications**, then open it from
Launchpad. On first start macOS asks for **Microphone** and **Screen & System
Audio Recording** permission; allow both, then quit and reopen the app once.

- **Your own Mac:** works as is, because you built it yourself.
- **Someone else's Mac:** the app is not yet notarized by Apple, so macOS
  blocks the first open. Open it once, click **Done**, then go to System
  Settings → Privacy & Security, scroll down and click **Open Anyway**
  (macOS 15 and later; on older versions right-click the app → **Open**).
  A warning-free download needs an Apple Developer ID ($99/year) to sign and
  notarize it.

### Windows (experimental)

**[⬇ Download MeetingLens-Windows-Setup.exe](https://github.com/Bhaktabahadurthapa/meetinglens/releases/latest/download/MeetingLens-Windows-Setup.exe)**
(5.5 MB, Windows 10/11 64-bit). This first Windows build compiles and passes
its unit tests on a Windows build server, but has **not been tried on a real
Windows laptop yet**, so expect rough edges, especially audio capture.

1. Run the installer. Windows shows **"Windows protected your PC"** because
   it isn't signed: click **More info → Run anyway**. It installs for your
   user only (no administrator needed).
2. Allow **Microphone** access when asked. System audio is captured from your
   default output device (WASAPI loopback), so play the call through your normal
   speakers or headphones.
3. For free local AI install
   [Ollama for Windows](https://ollama.com/download) and
   [whisper.cpp](https://github.com/ggml-org/whisper.cpp/releases)
   (`whisper-cli.exe`) plus a model file, then set the paths in
   **Settings → Speech**.

The installer is built by the **Build Windows** GitHub Action
(`.github/workflows/windows.yml`), free for public repositories. Removing the
SmartScreen warning needs a paid code-signing certificate.

<details>
<summary><b>Tests, release build and hardware probes</b></summary>

```bash
npm test
```

```bash
cd src-tauri && cargo test
```

```bash
npm run tauri build
```

- `cargo run --example e2e_probe -- <whisper-cli> <model.bin> <llm-base-url> <model> <seconds>`
  captures real system and mic audio, transcribes it, runs the AI actions,
  tests cancellation, and checks persistence and export.
- `cargo run --example sck_probe -- <audio-file>` reports the ScreenCaptureKit
  audio format and level while playing a file.
- `VITE_SELFTEST=1 npm run tauri dev` runs a dev-only script that clicks
  through Start → Explain → Suggest reply → overlay → Stop → History.

</details>

## Privacy

- **On device by default:** with whisper.cpp and Ollama, no audio or text
  leaves your computer.
- **You can always see where data goes:** chips in the app show whether
  audio and AI text stay local or go to a named cloud host, and whether AI
  help is *automatic* or *on request*. With a cloud AI provider, Auto-assist
  sends what others say as they speak; turn it off if that isn't what you want.
- **Keys** live in the OS credential store, never in files or logs.
- **Recordings are off by default;** a visible indicator shows when they're
  on.
- **No telemetry,** no account, no update checks.
- **Consent matters:** some places require everyone's consent to record or
  transcribe a conversation. Tell participants when you use MeetingLens.

## Status

| | macOS (Apple Silicon) | Windows |
|---|---|---|
| Build | ✅ verified on macOS 27 | ✅ builds and unit tests pass on a Windows build server |
| Real-audio pipeline | ✅ whisper.cpp (bundled C++ engine and `whisper-cli`) + Ollama | ⚠️ not yet tried on a real Windows laptop; bundled engine passes CI protocol tests (fake mode) |
| Deepgram, OpenAI | ⚠️ implemented, awaiting live-key testing | ⚠️ same |

Full results and known limitations: [docs/TESTING.md](docs/TESTING.md).

## Docs

- [Architecture](docs/ARCHITECTURE.md) · [Languages and why](docs/LANGUAGES.md)
- [Design system](docs/DESIGN_SYSTEM.md)
- [Test results & limitations](docs/TESTING.md)
- [Reference investigation & feature coverage](docs/FINDINGS.md): an
  independent implementation; see that file for how the reference app was
  studied.
- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) ·
  [Code of conduct](CODE_OF_CONDUCT.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

Data lives in `~/Library/Application Support/app.meetinglens.desktop/`; keys
are under the credential-store service `app.meetinglens.desktop`.

## License

Proprietary. Copyright © 2026 Bhakta Thapa. All rights reserved. See
[LICENSE](LICENSE). The source is public to read; no right to use, copy,
modify or redistribute it is granted without a separate written license or
subscription agreement. Third-party components keep their own licenses; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

<div align="center">
<br>
<sub>Built by <b>Bhakta Thapa</b> · <b>BKT AI</b></sub>
</div>
