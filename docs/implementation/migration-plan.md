# Migration plan: from the current app to the target platform

Principles: extend, never replace. Each increment ships on its own, keeps all existing screens working, adds an append-only database migration only when it needs one, and has tests before it is called done. Nothing is pushed or released without explicit approval. No screen appears in the sidebar until its feature works.

## Order and dependencies
| # | Increment | Why this order | Needs new dependency | Backend? |
|---|---|---|---|---|
| 1 | **Navigation shell + Dashboard.** Group the sidebar (Main / Workspace / Tools), breadcrumbs, keyboard navigation, global search box (sessions only at first), Dashboard as the home screen with metrics counted from real rows (sessions, interviews, diagrams, documents, notes). Only existing features are listed. | Everything else hangs off it | none | no |
| 2 | **Notes + Knowledge Base.** `notes` table (migration 6), notes from transcript selections, unified FTS5 search across sessions, notes, documents, diagrams, "All Notes" and "Documents" pages, real global search. | Dashboard, Discover and Learning all save into it | none | no |
| 3 | **Technical Copilot workspace.** Merge Architecture into it; add technical explain (simple, then deep), safe troubleshooting plans (causes, evidence to collect, read-only commands, expected result, risk level, verification), incident tracker (symptoms, hypotheses, evidence, actions, decisions, open questions, tasks), never executes commands, never states a root cause without evidence. | The flagship; builds on shipped Architecture work | none | no |
| 4 | **Whiteboard.** Excalidraw board with autosave, native board file, PNG/SVG export; structured diagram schema → Excalidraw objects with stable ids and source references; AI edit commands shown as a preview before applying; Mermaid source kept separately; revision history. Charts with Recharts, marked illustrative unless backed by numbers with provenance. | Needs the diagram schema from step 3 | `@excalidraw/excalidraw`, `recharts` (licence check first) | no |
| 5 | **Meeting extras.** Decisions vs suggestions, action items (owner and deadline only when stated), summaries, saved moments, send-to-Whiteboard and send-to-Notes. | Uses notes and whiteboard | none | no |
| 6 | **Classroom and Presentation modes.** Same engine, different prompts, schemas and permissions: lecture notes, study guides, practice questions, learning progress; slide/PDF ingestion, speaker notes, rehearsal, audience Q&A. | Use notes, documents, whiteboard | none | no |
| 7 | **Interview extras.** Job-description analysis, "verified experience" records from the user's documents, adaptive follow-ups, feedback history. | Builds on notes and documents | none | no |
| 8 | **My Learning.** Goals, paths, lessons, drills, quizzes, progress from real activity only. | Needs Interview, Classroom, Notes | none | no |
| 9 | **Discover.** Local collectors in Rust (RSS, GitHub API, official docs), deduplication, freshness and source-quality ranking, interest matching, saved and read state, refresh time. Trends come from counted data with a source and time window, not from the model. Off until the user opts in; each source is listed in Settings. | Largest new surface and the only one that needs the internet by default | none (reqwest exists) | no (runs locally) |
| 10 | ~~**Community / Pro, accounts, Stripe.**~~ Removed from scope by the owner. Only when a feature truly needs a server (sync, paid entitlements). | Needs product and legal decisions | server stack | **yes**: a single modular monolith with PostgreSQL |

## Cross-cutting work in every increment
- Shared engine gaps (once, in step 1 to 3): intent classification, per-mode context permissions, session recovery after a crash, explicit cloud-processing consent screen.
- Tests: Rust unit tests for every new validator and migration, frontend tests for pure logic, a real-browser check script for anything that renders, a CSP check for anything that loads code or data.
- Docs: update `docs/architecture/current-system.md` and the change log per increment.
- Keep the Mac app signed with the local certificate so permissions stay stable.

## Not planned unless a requirement appears
Kubernetes, microservices, Redis, a vector database, a separate Python service.

## Open questions for the owner
1. The brief was cut off at section 16 ("Knowledge Base: Create a unified local knowledge layer for…"). Sections for Projects, Repositories, Templates, Exports, Pro editions, security, testing and deliverables were not received.
2. Priority: the order above is a recommendation; which increment first?
3. Is a purple accent and a Dashboard-first home wanted even though the app currently uses a blue accent and opens on Meeting?
4. Release 0.1.5 was interrupted: finish it now, or fold it into the next increment?
