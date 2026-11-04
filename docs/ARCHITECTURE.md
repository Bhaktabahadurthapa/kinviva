# MeetingLens architecture

One Tauri 2 desktop application. There is no server, cloud backend or account.
The only network traffic goes to the speech and AI providers the user configures.

```
 Mic (cpal) ─────────┐                        ┌─ transcript-partial/final ─┐
                     ├─► forward_audio ─► STT ─┤                            ├─► React (main + overlay)
 System (SCK / WASAPI)┘   (opt. WAV)   provider └─► SQLite segments          │
                                                                             │
 User action ─► assistant: recent transcript + notes + FTS5 passages ─► LLM stream ─► ai-event
```

## Rust modules (`src-tauri/src`)

| Module | Responsibility |
|---|---|
| `audio/` | `Source` (Mic = "Me", System = "Them"). `CaptureHandle` owns each platform stream on its own thread and joins it on stop. `cpal_capture` (mic; Windows loopback), `macos_system` (ScreenCaptureKit), `resample` (downmix + 16 kHz). |
| `stt/` | `deepgram` (WebSocket streaming), `local` (the loop shared by on-device engines: utterance segmentation via `vad`, live partials, finals, noise/hallucination filtering), `whisper_cli` (a `whisper-cli` process per clip) and `native` (supervises the bundled C++ helper). A common `SttEvent` stream. |
| `meeting` | Session lifecycle: start captures and providers, pump events, persist finals, emit levels, ordered teardown (release devices → flush providers → cancel stragglers). Live mic switching. |
| `transcript` | Live transcript state and the bounded prompt window (partials marked as possibly incomplete). |
| `assistant`, `prompts`, `llm` | Action runner (one request per panel, cancellation tokens), prompt rules, OpenAI-compatible SSE client with readable errors that never contain the key. |
| `docs` | TXT/MD/PDF extraction, chunking, FTS query building. |
| `db` | rusqlite with ordered migrations (`PRAGMA user_version`). Meetings, segments, AI messages, documents + FTS5, settings. |
| `secrets` | OS credential store via `keyring`. Only an allow-list of names. |
| `export`, `question`, `shortcuts`, `demo`, `commands`, `state` | Export, question highlighting, global shortcuts, labelled demo data, Tauri commands, shared state. |

## Frontend (`src`)

`main.tsx` routes by window label (`main` or `overlay`). Both windows rebuild
the same live state from a `get_snapshot` call plus backend events
(`lib/useLive.ts`, `lib/liveReducer.ts`), so they stay in sync without talking
to each other.

## Privacy defaults

* Audio recording to disk is off. A pill shows it whenever it is on.
* Pills show where audio goes (cloud provider host or "this device") and where
  AI text goes, which happens only when you press an action.
* No telemetry. The app logs no keys or meeting content.
* Demo meetings are flagged in the database and shown with a DEMO badge.

## Product identity (separate from the reference app)

| Item | MeetingLens | Notes |
|---|---|---|
| Bundle identifier | `app.meetinglens.desktop` | NexQ uses `com.nexq.app` |
| Data + database | `~/Library/Application Support/app.meetinglens.desktop/meetinglens.sqlite` | NexQ's `com.nexq.app` folder, caches and WebKit data are never read, written, migrated or deleted |
| Settings | `settings` table in the MeetingLens database | |
| Credentials | Keychain / Credential Manager service `app.meetinglens.desktop` (`deepgram_api_key`, `llm_api_key`) | |
| Updates | None configured: no updater plugin, endpoint or signing key; the app never checks for updates | Add one deliberately before any public release |

## Audio backpressure

Capture callbacks never block. Each source has a large queue in front of its
speech provider. The local whisper.cpp provider drains everything queued
before each partial, so it catches up after slow transcriptions. If audio
still has to be dropped, the source's status reports how many blocks were
lost.

## Speech engines

```
audio chunks ─► stt::local loop ─► Engine::Cli     (new whisper-cli process per clip)
                  (VAD, partials,  Engine::Native  ─► NativeHub ─► meetinglens-whisperd (C++, whisper.cpp)
                   finals, filter)                       │  JSON lines + binary PCM over stdin/stdout
                                                         └─ one process per meeting, one state per channel
```

`NativeHub` owns the helper for a meeting: handshake, per-clip timeout, cancel,
restart after a crash (3 times), graceful shutdown when the last channel
finishes, and a drop backstop. The helper also exits by itself if its parent
disappears. Languages and the reasoning behind them: [LANGUAGES.md](LANGUAGES.md).
Protocol: [native/whisperd/README.md](../native/whisperd/README.md).
