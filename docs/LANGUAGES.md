# Languages in MeetingLens: what is used, and why

The rule applied: **a language is added only where a measured, current need
justifies its build, packaging and maintenance cost.** Working modules were not
rewritten to change languages.

## Module map and decision

| Responsibility | Language | Decision |
|---|---|---|
| Interface (screens, overlay, reading view) | TypeScript + React | existing |
| Tauri shell, window and shortcut handling, OS credential store, SQLite, audio capture (ScreenCaptureKit, cpal), resampling, LLM streaming client, prompts, document extraction, FTS retrieval, **supervising the speech helper** | Rust | existing; stays |
| **Local speech recognition** (model kept loaded, two channels, cancellable) | **C++** (whisper.cpp) | **new, justified** |
| AI orchestration, simplification, replies, document processing, retrieval | Python | **not used** (no demonstrated need) |
| Hosted accounts, subscriptions, team administration, managed AI access | Java + Spring Boot | **not used** (not in the current scope) |

## C++: speech helper (`native/whisperd/`)

**Need, measured on this Mac (Apple Silicon, whisper.cpp v1.9.4):**

| Model | One clip, new `whisper-cli` process (before) | One clip, model kept loaded (after) |
|---|---|---|
| base.en | 0.30–0.41 s | 0.09–0.12 s (≈ 3–4× faster) |
| small.en | 0.61–0.65 s | 0.26–0.34 s (≈ 2× faster) |

Every clip used to reload the model, roughly every 1.5 s while someone talks. The
larger model also gives noticeably better punctuation and sentences, and the
engine ships inside the app so users no longer have to install whisper.cpp with
Homebrew. Both halves of that were the justification, not the language itself.

**Reuse, not replacement:** the helper is about 370 lines that link the existing
whisper.cpp library. It does not implement a speech engine. nlohmann/json comes
from whisper.cpp's own examples folder.

**Not moved to C++:** audio capture and resampling. They work in Rust, cost
almost nothing, and no benefit was demonstrated.

**Integration (Rust owns the process):** one helper per meeting; versioned JSON
lines for control and results; audio as a bounded binary payload (≤ 60 s) after
its header; per-clip timeout (30 s) then kill and replace; cancellation; restart
after a crash (3 per meeting, then a clear error); graceful shutdown; the helper
exits on its own if the app closes or dies (verified: gone 0.34 s after the app
was SIGKILLed mid-load). The existing `whisper-cli` provider is untouched and
still selectable. See `native/whisperd/README.md`.

**Costs:**

| | |
|---|---|
| App size | +3.8 MB (app 20 → 23.8 MiB; installer 7.9 → 9.3 MB) |
| Build | `cmake`, a C++17 compiler and network (fetches whisper.cpp) for developers only; helper build 17 s, whole Mac app build about 27 s. Users install nothing |
| Maintenance | a second language and build; whisper.cpp is pinned and must be bumped on purpose; the app and helper protocol are versioned together |
| First run | the very first model load at a new install location takes **≈ 15 s** while macOS compiles GPU shaders (measured 14.7 s, then 90 ms). The app primes the engine in the background at launch to hide it; a meeting started within those seconds connects late but loses no audio |
| Two channels at once | they contend for the GPU: a 6 s clip took ≈ 0.20–0.26 s with two active versus ≈ 0.11 s alone (base.en) |

## Python: evaluated, not adopted

The only current feature where Python could plausibly help is document
processing. Measured against the known source text:

| Extractor | Realistic 2-column article with accents, ligatures, table | 21-page document |
|---|---|---|
| Rust `pdf-extract` (in use) | 100 % of words | all 399 marked passages found |
| Python `pypdf` | 100 % | identical |
| Python `pdfminer.six` | 100 % | identical |

Rust took 56 ms and 540 ms; Python 7–11 ms and 135–322 ms. There is no quality
gap. Adding Python would add a bundled runtime (typically tens of MB), a second
process to supervise, and cold-start delays for no measured gain. Prompt
building and LLM streaming gain nothing from a language change. Semantic
retrieval, if wanted later, can use embeddings from Ollama, which the app already
talks to.

**Add Python when one of these becomes a real requirement:** scanned PDFs (OCR),
DOCX or other formats Rust crates handle poorly, a local embedding or reranking
pipeline beyond what Ollama offers, or offline evaluation tooling.

## Java + Spring Boot: not in scope

The first version is deliberately one desktop app with no backend, no accounts
and no cloud service. Accounts, subscriptions, team administration and managed AI
access are only a future business idea, not a current requirement, so no Java
service was built. **Add it when** those features are requested; it would be a
separate hosted service, and the desktop app would keep working offline.

## Tested and not tested

Tested on macOS (Apple Silicon): helper protocol (load, parallel channels,
cancel, errors, exit paths) with real models; 12 new Rust tests (the process
tests run against the real helper binary in fake mode); the complete workflow in
the real app window with real spoken audio and the new engine: audio → live
transcript → explanation and coaching → saved meeting, twice; the packaged app
finds, starts and cleans up its bundled engine.

**Not tested:** Windows (the helper is not built there; Windows keeps using
`whisper-cli`); Intel Macs (arm64 only); a click-through of the packaged `.app`
itself (the UI test script only exists in development builds); memory use;
models larger than small.en or multilingual models; the engine on a Mac that has
never compiled the GPU shaders, beyond the 14.7 s measurement; notarization.
