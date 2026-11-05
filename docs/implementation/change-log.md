# Change log (this pass)
- Navigation: five destinations (Meeting, Interview, Sessions, Knowledge, Settings). Sessions and Knowledge were tabs inside Meeting.
- Visual system: light default, dark via system setting, blue accent, navy sidebar, system font stack, 14px body, 6/8/10px radii. Removed grid overlay and one-sided accent borders flagged by Impeccable.
- Panel headers wrap instead of clipping controls.
- Earlier in the same session (committed `c8a74f9`): hard-word explanations, 429 retry and visible AI errors, fully clear overlay.

## Phase 2
- Transcript search with highlight; draggable and keyboard-resizable transcript/answer split (remembered).
- Editable meeting name while recording.
- Settings split into six sections.
- Interview answer styles Simple / Professional / Technical / STAR (STAR is told never to invent facts).
- Pause / Resume transcription: provider gets 1.2 s of silence to close any open sentence, then audio is dropped (and not recorded) until resume. Capture stays open; the indicator shows Paused.
- Tests: pause gate, search, split math, interview style prompt, invalid-credentials.
- Impeccable skills installed into `.claude/` (project scope, no hooks).

## Architecture visualisation (Mermaid)
- New sidebar destination **Architecture**: conversation to checked architecture model to Mermaid diagram, with evidence labels, explanation, concerns, zoom/pan/fit/full screen, edit source, copy, SVG and PNG export, saved history. See `docs/architecture/architecture-visualization.md`.
- Added `mermaid` 12.3.0 (lazy-loaded), dev-only `jsdom` for tests; notices updated.
- DB migration 5 (`diagrams`). Existing data untouched.

## Platform transformation (local, not pushed)
Milestones, each committed locally: storage and generator (migration 6, `store.rs`, `studio.rs`); Dashboard, grouped sidebar, purple light theme, global search; Notes and Knowledge Base; Technical Copilot (explain, troubleshoot, incidents, architecture); Whiteboard (Excalidraw) and charts (Recharts); Classroom, Presentation, decisions and actions, job analysis; Discover and My Learning. See `docs/architecture/platform-overview.md`.

