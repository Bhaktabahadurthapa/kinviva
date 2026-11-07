# Reference investigation: NexQ → Kinviva

Kinviva is an independent implementation. No NexQ source was cloned,
downloaded or copied. No NexQ icons, screenshots, branding, prompts or recovered
code are in this repository. The reference artifact was used only to answer
specific behavioural questions.

## Sources and evidence labels

| Label | Meaning |
|---|---|
| **DOC** | Documented claim in NexQ's public README, releases page, `getting-started.md` or `audio-setup.md` (read 2026-11-03). |
| **STATIC** | Observed with REA (and `nm`/`strings` for targeted lookups) in the official release `NexQ_2.31.0_aarch64.dmg`, SHA-256 `bb4bc97d…31cb`. Main executable `nexq` SHA-256 `026b63af…7180`, arm64. REA evidence IDs are listed below. |
| **RUNTIME** | Observed while running the release build in place from the analysis folder (not installed), 2026-11-03 08:14–08:16, with your consent. Passive only: window capture, network sockets, files created. No clicks or input (see Limitations). |
| **DESIGN** | A Kinviva design decision, not a claim about NexQ. |

REA evidence: DMG inventory `ev_72b7e8b0…`, Info.plist `ev_cec824d0…`,
Mach-O inspection `ev_2dd276e3…`, code signature `ev_4b3c50b1…`.

## Findings table

| Feature | Observed behaviour (label) | Evidence reference | Limitations / unknowns | Kinviva independent implementation (DESIGN) |
|---|---|---|---|---|
| First-run audio + AI setup | DOC: launcher picks a mic for "You" and an output device for "Them". Ollama is auto-detected. Cloud keys are kept in the OS credential store. STATIC: Info.plist has mic and system-audio-capture usage strings. Binary imports `SecItemAdd/CopyMatching/Update/Delete` (Keychain). A default Ollama URL `localhost:11434` string is present. Entitlement `com.apple.security.device.audio-input`. RUNTIME: within seconds of launch NexQ held a TCP connection to Ollama at `127.0.0.1:11434`, This shows a connection to Ollama's default port. It is consistent with the documented auto-detection but does not by itself show how detection works or what the UI does with it. A 5-step "Setup" flow ('Step 5 of 5') showed a "Them: deepgram" summary, a keyboard-shortcut table and Start Meeting / Go to Launcher buttons. `config.json` holds `meetingAudioConfig`, `micDeviceId`, `systemDeviceId`, `sttProvider`, `recordingEnabled`, `claudeModels` (keys only were read). | README, getting-started.md; `ev_cec824d0`, `ev_4b3c50b1`; `nm -u` | The actual onboarding screens and order were not observed. | A Setup page with a 3-step checklist (audio, speech, AI). Keys go to Keychain / Credential Manager via the `keyring` crate and are never returned to the web view. Presets for OpenAI / Ollama / LM Studio and a "Fetch models" button (`GET /models`), with no hardcoded model. |
| Start / stop meeting | DOC: Ctrl+M starts and ends. The meeting is saved automatically. RUNTIME: the setup screen lists Ctrl+M as a global start/end shortcut, Ctrl+B to show/hide the overlay, Space for AI Assist and number keys for modes ("What to Say", "Shorten") during a meeting. | getting-started.md | Not observed at runtime. | Start/Stop button plus a configurable global shortcut (default Cmd/Ctrl+Shift+M). The meeting row is created on start and closed on stop. Meetings left open by a crash are closed on the next launch. |
| Mic + system audio capture | DOC: two independent streams. macOS uses a "Core Audio tap" (14.2+); Windows uses WASAPI loopback. STATIC: imports `AudioHardwareCreateAggregateDevice`, `AudioHardwareDestroyAggregateDevice`, `AudioDeviceCreateIOProcID`. A `CATapDescription` class reference is present. ScreenCaptureKit is **not** among the linked frameworks. | audio-setup.md; `ev_2dd276e3` dependencies facet; `nm -u`, `strings` | Static evidence is consistent with the documented Core Audio process tap. Device-switch behaviour was not observed. | Different mechanism: **ScreenCaptureKit audio** (macOS 13+) for system audio and **cpal/CoreAudio** for the mic, each on its own thread, normalised to 16 kHz mono. Windows: cpal WASAPI loopback (written, **unverified**). Live mic switching works during a meeting. Device-loss faults are surfaced in the UI. |
| Partial + final transcripts | DOC: live transcript with You/Them labels. Interim results are not mentioned. STATIC: Deepgram query fragments including `interim_results=true`, a "pause detected" finalisation message, a "[transcribing...]" placeholder. | README; `strings` | How partials are rendered in the UI is unknown. | Partial text is shown in italics and replaced by the final segment for the same source. Deepgram uses native interim results. whisper.cpp re-transcribes the utterance so far every ~1.5 s, then finalises after 700 ms of silence or 15 s. |
| AI assistance from recent conversation | DOC: Assist, What to Say, Shorten, Follow-Up, Recap, Ask, question detection; Space triggers Assist. STATIC: endpoint strings for OpenAI, Anthropic, Gemini, Groq, OpenRouter, LM Studio, Ollama, custom. | README; `strings` | Prompts, context windowing and automatic behaviour are unknown. Not inferred. | **Explain** (simple English, keeps the meaning, flags "Unclear:"), **Suggest reply** (grounded, `[placeholders]` instead of invented facts, editable), **Recap**, **Ask**. On demand only. One OpenAI-compatible streaming client. One request per panel, cancellable. Optional question *highlighting* with cooldown and duplicate suppression that never auto-answers. |
| Notes / documents as context | DOC: local RAG over PDF, DOCX, TXT, MD using "SQLite FTS + embeddings". STATIC: strings about query embeddings for semantic/hybrid search and RAG index progress. RUNTIME: the database created on first launch contains `rag_chunks`, `rag_embeddings` and an FTS5 `rag_fts` table, This establishes storage structure only. Retrieval was not exercised, so whether or how passages are retrieved is unverified. The setup screen also offers "Upload your resume for personalized responses". | README; `strings` | Chunking, models and ranking are unknown. | TXT/MD/PDF. Chunks of ~900 characters with overlap, indexed with SQLite FTS5 (porter stemming, bm25). The top 4 passages matching recent speech + question are included, and **every answer lists the passages it used**. No embeddings yet. PDF extraction errors (encrypted, scanned, malformed, non-PDF) are reported clearly. |
| Review + export saved meetings | DOC: searchable history, summaries, "Ask a past meeting". Export formats are not stated. RUNTIME: the schema has `meetings`, `transcript_segments`, `meeting_bookmarks`, `meeting_action_items`, `meeting_topic_sections`, `meeting_speakers`, `meeting_chat`, `transcript_translations`. Storage structure only; no history, search or export workflow was exercised. | README | Not observed. | History with full-text search, rename, delete, **Open in assistant** (reuse a saved transcript with AI actions), export to **Markdown** and **plain text**. |
| Floating overlay | DOC: always-on-top, transparent overlay with global shortcuts. Screen-share exclusion uses `NSWindowSharingNone` / `WDA_EXCLUDEFROMCAPTURE`. STATIC: selector string `setSharingType:`, a `stealthMode` config key. RUNTIME: an "NexQ Overlay" window exists at launch but is hidden until toggled. | README (v2.25 notes); `strings` | Whether exclusion works across capture tools was **not** tested. | A separate always-on-top, transparent, frameless, resizable Tauri window with a draggable header and Assist/Transcript tabs. Optional "exclude from screen capture" (Tauri content protection) is **off by default** and labelled best-effort. |

## Limitations of this investigation

* NexQ was launched once with your consent (ad-hoc signed, no team ID,
  not notarized; run in place, not installed). REA's native-UI tools could
  not bind to its window ("window absent"; one hypothesis, not confirmed, is that
  the window was on another Space), and this session has no Accessibility permission, so
  **no workflow was exercised**: starting/stopping a meeting, capture,
  partial transcripts, AI actions, document upload, history/export and the
  overlay remain documented-only. Observations were limited to window
  captures, sockets and created files. Nothing here claims parity.
* NexQ opened at "Step 5 of 5" of setup because of WebKit data
  (`~/Library/WebKit/nexq`, dated 2026-11-02) that predates this session.
  A text selection with NexQ's "Translate" popup was visible in that state.
* Launching created `~/Library/Application Support/com.nexq.app` (config,
  empty `nexq.db`, `models/opus_mt`) and `~/Library/Caches/com.nexq.app`.
  Both were left in place.
* Static observations come from import tables and printable strings only.
  No functions were decompiled and no code was transferred.
* Docs pages not fetched: ai-providers, rag-context, configuration,
  keyboard-shortcuts, meeting-detection.

## Parity statement

No NexQ workflow (meeting start/stop, capture, transcription display, AI
actions, document retrieval, history/export, overlay use) has been compared
side by side with Kinviva. Kinviva implements the documented
functionality independently. Similar features do not imply equivalent
behaviour.
