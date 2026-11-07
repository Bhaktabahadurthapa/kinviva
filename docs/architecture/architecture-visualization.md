# Architecture visualisation (Mermaid)

New destination **Architecture** in the sidebar. It turns what people describe in a meeting or interview into a diagram, explains it in plain English, and says how sure it is. Nothing here replaces an existing screen; it reuses the live transcript, the answer-engine client, the document search and the SQLite store.

## Audit of what was reused
| Need | Existing piece reused |
|---|---|
| Finalized transcript | `AppState.live.transcript` (`recent_window`), filled by the existing capture and speech-to-text pipeline |
| Model calls | `assistant::llm_config` + `llm::stream_chat` (JSON mode, retries, error text) |
| Documents for "verified" | `Db::search_passages` (FTS5) |
| Storage | `db.rs` versioned migrations (new migration 5: `diagrams`) |
| Cancel | `AppState.ai_tasks` + `ai_cancel` |
| UI | `styles.css` tokens, `NotesDownload`/save-dialog helpers, `latestGuard` |

## Data flow
1. User presses **Generate** (or turns on **Update while we talk**).
2. `architecture_generate` (Rust) reads the recent transcript, finds up to four matching document passages and asks the answer engine for **one JSON architecture model** (components, relations, explanation, concerns, quotes).
3. `architecture::validate` rebuilds the model from scratch (see Security). It returns a clear error when fewer than two components were found.
4. The front end converts the model to Mermaid with `toMermaid` (deterministic code, `src/lib/architecture.ts`). **Model text never becomes Mermaid syntax**; only fixed ids `n1…n24` and escaped labels are emitted.
5. `checkSource` then `mermaid.parse` then `mermaid.render` (lazy-loaded) then `sanitizeSvg`, then the SVG is inserted as DOM nodes (no `innerHTML`).
6. The diagram is saved to history automatically (generated) or on **Save to history** (edited).

## Evidence labels
Every component and link is one of: **verified** (a selected document mentions it), **mentioned** (the conversation used its words), **inferred** (suggested by the assistant; drawn dashed with a different fill). The label is decided by code, not by the model: a claim of "verified" needs a matching document passage; "mentioned" needs the words in the transcript; a link is never stronger than its weakest end. Quotes in "From the conversation" are kept only if they really appear in the transcript. Thin evidence (mostly inferred, or no evidence) is marked **Illustrative** and confidence is capped.

## Features
Zoom (buttons, wheel, +/-), pan (drag, arrow keys), fit, full screen (Esc exits), copy Mermaid source, edit source (checked before apply), regenerate, cancel, export SVG and PNG (2x, theme background), saved diagrams list (open, delete), light and dark themes, empty/loading/error states. Diagram kinds: flowchart and sequence (generated); flowchart, sequence, state and ER (accepted in the editor).

## Live behaviour
`shouldAutoGenerate`: only finalized speech, at least three distinct technical terms in the new speech, a 6 s quiet moment, at least 45 s since the last attempt, nothing already running. Off by default. Partial transcripts never trigger anything. A newer request cancels the older one and stale answers are ignored (`latestGuard`).

## Security review (Mermaid 12.3.0, MIT)
- Config: `securityLevel: "strict"`, `htmlLabels: false`, `secure: [...]` so a diagram directive cannot change security settings, `maxTextSize`, `maxEdges`, `suppressErrorRendering`.
- **Finding:** in the installed version, `strict` mode stops script and HTML in labels (checked: no `<img>`, no script, `window.__pwn` stayed 0) **but still renders `click … href "https://…"` as a clickable `<a>` link**. Kinviva therefore also (a) rejects any source with `click`/`href`/`call`/links, directives, HTML, `javascript:`/`data:` URLs, `http(s)://`, `url(`, unsupported diagram types, over 12,000 characters, 150 lines or 80 connections, and (b) strips `<a>`, `<script>`, `<foreignObject>`, `<image>`, event attributes and external `href`/`url()` from the SVG before display.
- Backend: ids regenerated, labels limited to letters, digits and `. , - _ / + '`, counts capped (24 components, 40 links), unknown links dropped, hint limited to 200 characters, transcript and documents declared to the model as data.
- CSP is unchanged (`default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`). Checked: a production build of Mermaid renders flowchart, sequence and ER diagrams under that exact header with zero violations. PNG export uses a `data:` image.
- Generated diagrams never execute or suggest commands; they are pictures.
- Licences: Mermaid and its 114 production dependencies are listed in `THIRD_PARTY_NOTICES.md` (MIT, ISC, Apache-2.0, BSD-3-Clause, Unlicense, and two dual-licensed packages used under permissive terms: `elkjs` EPL-2.0, `dompurify` Apache-2.0).

## Performance
Mermaid loads only when the Architecture screen first opens (separate chunks; the main bundle did not grow: 252 kB). Rendering is serialised, cached (24 entries) and ignores stale results. A 24-node, 38-link diagram rendered in about 90 ms in Chrome. Capture and transcription run in other tasks and are not touched. Installed app size is about 26 MB.

## Files
Rust: `src-tauri/src/architecture.rs` (model, validation, prompt, tests), `db.rs` (migration 5, save/list/delete), `commands.rs` (`architecture_generate/save/list/delete/write_file`), `lib.rs`.
TypeScript: `src/lib/{architecture,mermaidRender,latest}.ts` (+ tests), `src/components/architecture/{ArchitecturePanel,MermaidRenderer,DiagramToolbar,DiagramEditor,ArchitectureExplanation,DiagramHistory}.tsx`, `App.tsx`, `api.ts`, `download.ts`, `styles.css`, `dev/mock.ts`.
Scripts: `scripts/architecture-browser-check.mjs`, `scripts/architecture-security-check.mjs` (real Chrome against the dev server).

## Known limits
- Diagram quality depends on the answer engine and on how much was said. Short or vague talk produces an error or an "Illustrative" diagram.
- Saved diagrams are linked to the meeting id when one exists, but they are not yet shown inside the Sessions detail page or included in the Markdown/Word export.
- AWS, Azure and Kubernetes icons are not drawn; kinds use shapes (cylinder for databases, rounded boxes for gateways and so on).
- Only flowchart and sequence are generated automatically.
