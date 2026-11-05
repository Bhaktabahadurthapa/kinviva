# Platform overview (after the transformation milestones)

Local-first, one desktop app, no accounts, no subscriptions, no commercial backend. The only network use outside the answer engine you configure is Discover, and only after you turn it on.

## Navigation
Main: Dashboard (home), Meetings, Interviews, Classroom, Technical Copilot, Presentation, Discover, My Learning, Whiteboard. Workspace: Knowledge Base, All Notes, Visuals & Diagrams, Session history, Documents. Settings and the overlay toggle stay at the bottom. Only screens that work are listed (`src/lib/nav.ts`, `ready` flag). Not built: Projects, Repositories, Templates, Exports (session export still lives in Session history), a separate AI Assistant page (it is a panel on the Dashboard).

## Storage (additive migration 6, migrations 1 to 5 untouched)
`records` (kind note, board, board_rev, chart, incident), `learning_items`, `quiz_attempts`, `discover_items`. Settings gained `profile_role`, `profile_level`, `interests`, `discover_enabled` (all defaulted, so old settings load unchanged). Rust: `store.rs`, `discover.rs`, `studio.rs`, `architecture.rs`.

## Shared structured generator (`studio.rs`)
One command, `studio_generate(kind, input, meeting)`, builds a prompt from the live or saved transcript, your notes and your documents, calls the configured answer engine, and **validates the reply before the UI sees it**:
| Kind | Used by | Checks |
|---|---|---|
| technical_explain, lecture_notes, study_guide, speaker_notes, audience_qa, rehearsal_feedback, job_analysis, explain_item, assistant | Technical, Classroom, Presentation, Interviews, Discover, Dashboard | non-empty text; "untrusted data" rules |
| troubleshoot | Technical → Troubleshoot | causes are hypotheses; every command must pass `is_read_only` (no chaining, redirection, sudo, deletes, restarts, applies); unsafe ones are removed and counted |
| incident_extract | Technical → Incidents | short strings only, capped |
| decisions | Meetings, Session history | a decision or action needs a quote found in the material; an owner or deadline is kept only if those words appear |
| quiz | Classroom | exactly four choices, valid answer index |
| learning_plan | My Learning | 2 to 12 steps, kinds limited to lesson or drill |
| board_diagram, board_ops | Whiteboard | rebuilt ids, safe labels, limits; operations limited to six known types |
| chart | Visuals | a number counts as sourced only if it appears in the material as a whole number; otherwise flagged and the chart labelled illustrative |

## Screens
- **Dashboard**: metrics counted from rows (sessions, interview answers, diagrams, documents, learning progress), recent sessions with transcript, note and diagram indicators, continue learning, Discover highlights, quick create, assistant (Ask, Explain, Summarize, Visualize, Plan, Code; uses your Documents and names the file).
- **Global search** (top bar and Knowledge Base): substring search over sessions, transcripts, notes, incidents, whiteboard and chart titles, diagrams, documents (names and the existing FTS5 text index), learning and Discover.
- **Notes**: autosaved notes; "Save to notes" under answers, plans, decisions and Discover items.
- **Technical Copilot**: Explain, Troubleshoot (read-only commands, never run), Architecture (Mermaid, see `architecture-visualization.md`), Incidents (a root cause field is locked until a hypothesis is marked supported and evidence exists).
- **Classroom** and **Presentation**: tools on the same engine. Interview gained job description analysis. Meetings and Session history gained Decisions & actions.
- **Whiteboard**: Excalidraw (MIT). Autosave, versions (30 kept, saved before every AI change), export PNG, SVG, .excalidraw and Mermaid. AI can generate a diagram from the conversation, a note, a description or a saved architecture diagram; it is previewed and added **beside** your drawing. "Edit with words" returns a list of operations that are shown in plain words and applied only after you press Apply; only the targeted objects change.
- **Visuals & Diagrams**: lists diagrams and boards; Recharts charts (bar, line, pie) with an editable data table, per-number provenance, "entered or edited by you" flags, PNG and SVG export.
- **Discover**: eight official feeds plus GitHub topic search for your interests, parsed locally, deduplicated by URL and title, ranked by freshness, source quality and interests; sections For you, Latest news, GitHub, Trending skills (counts per topic over two 30-day windows from stored items), Learning & certifications (links to official pages), Saved; read/unread, save, explain, visualize, save to notes, add to learning plan.
- **My Learning**: goals, steps (lesson or drill), progress from steps marked done, quiz accuracy per topic, knowledge-gap suggestions (under 70% after five answers), saved resources.

## Privacy and security
Raw audio stays local unless you pick Deepgram. Answers use only the context you provide. Discover is off by default and lists its sources before the first download; external links open only if they are stored Discover items. CSP now allows same-origin fonts, `blob:` images and same-origin fetch (needed by the whiteboard); nothing external is allowed. Whiteboard fonts are bundled (`public/excalidraw-assets`, generated by `scripts/copy-excalidraw-assets.mjs`); Excalidraw still tries its CDN as a fallback for the omitted CJK font and the app's CSP blocks it.

## Not implemented or limited
Accounts, Pro, billing (out of scope by decision). Projects, Repositories, Templates and Exports pages. Practice action on Discover items. PDF export of boards (Excalidraw has none; PNG and SVG work). CJK handwriting font. Apple Pencil is supported only through Sidecar or a compatible iPad (not tested). Per-person speaker diarization (only Them and Me). Intent classification and crash recovery in the shared engine. Cross-session retrieval beyond keyword search. The new screens were exercised in Chrome against a mock backend and the Rust side by unit tests; the live app window could not be driven (macOS Accessibility permission), so real end-to-end runs with a model are pending.
