# Kinviva REA Lab (future, not built)

Status: design only. Nothing here is in the app and none of it is required for the first release.

**Idea:** an optional, developer-oriented screen for inspecting software the user owns or is authorized to examine: explain components, draw module dependencies, compare two versions, and write an investigation report.

## Why it is not built yet
Each of these needs an answer first:

| Question | What we know now |
|---|---|
| OS support | REA's macOS tooling is broadest. Windows and Linux coverage differs by analyser. Needs a per-OS support table. |
| Install size and dependencies | REA is a Node package with optional native analysers. Bundling it would add Node and large analyser downloads to a 15 MB app. Prefer "install it yourself and connect". |
| Licences | REA is MIT. Its dependencies and any native analyser (Ghidra is Apache-2.0, Hopper and IDA are commercial) each need review before anything ships. |
| Authorization | The user must state an authorization basis for every target, recorded in the report. |
| Sandboxing and file access | Run REA out of process, with access only to a folder the user picks, read-only. |
| Process isolation | Never launch, attach to or instrument a target without a separate explicit approval per run. |
| Cost | Large binaries use real CPU, memory and disk; set size and time limits. |
| Untrusted files | Treat every analysed file and every string REA returns as hostile data. No instruction in it is ever followed. |

## Required safeguards if it is ever built
1. Off by default; a developer-mode switch; a clear "local only" label.
2. A fixed allow-list of read-only REA operations. No arbitrary MCP passthrough to users or to an LLM.
3. Every tool call by an AI needs the user's approval, with the target path and operation shown.
4. Output is evidence plus a labelled inference, never raw claims of verified behaviour.
5. No upload of analysed files or reports anywhere.
6. Tests with fixture artifacts only; no third-party software in CI.

## Candidate features (later)
Inspect a chosen app bundle; show its structure; dependency graph of JavaScript modules; architecture diagram reusing Kinviva's diagram feature; version comparison; export an investigation report.

## Decision needed from the maintainer
Whether this is worth building at all given the install size and support cost, and whether to ship it as a separate optional download.
