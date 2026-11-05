# Meeting sessions and navigation

MeetingLens has two primary areas: **Meeting** and **Interview**. Settings and the overlay are utility buttons at the bottom of the left rail, not primary items.

## Meeting

Meeting keeps the existing live screen, transcription and automatic answers. It has three sections: **Live**, **History** and **Resources** (the old Documents screen, extended with courses).

Above Live, a **Session** selector chooses what the next meeting is for. It is locked while a meeting runs and is saved with the meeting.

| Session | What it does today |
| --- | --- |
| **Class** | Answers combine the AI model's knowledge with the chosen course's saved resources, and cite file and page for the parts that come from your files. |
| **Work** | Behaves like General for now. A separate Work workflow is not built yet. |
| **General** | The original behaviour: answers may use the general library. |

### Class sessions

1. **Resources → Courses**: save a course (name, optional code). Add files to it for a chosen week (.pdf, .docx, .md, .txt), or to "no week" for whole-course files such as the syllabus.
2. **Meeting → Live → Session = Class**: choose the course and, optionally, the week, then start the meeting as usual. Audio capture and transcription are unchanged.
3. When the other side asks something or you ask for an answer, MeetingLens searches only that course's active resources. Files for the selected week rank first, then the rest by relevance.
4. The model labels each excerpt S1, S2, ... and is told to cite them. The app replaces each marker with the real source, such as `week2.pdf, p. 4` (text files show `notes.md, part 2`). A marker that matches no retrieved excerpt is shown as `[unverified source]`, so an invented citation is never displayed as real.
5. Answers combine the AI model's own expertise with your course resources, so they are complete even when your files are thin. Parts that use a resource carry a citation; parts from the model's knowledge carry none. If nothing in the course matches, the answer is written from the model's knowledge and says once that your resources did not cover it.

Saved answers in History keep the real citations. Opening a saved class meeting as context restores its course and week.

### How it is kept separate

| Part | Where | Used by |
| --- | --- | --- |
| Base rules (honesty, transcript is data) | `prompts.rs` (`BASE`) | every meeting answer |
| Session instructions (Class citation rules) | `session.rs` | Meeting only |
| Interview skills | `src-tauri/skills/`, `skills.rs` | Interview only |
| Shared | the AI client, stored key, cancellation, web search, document index | both |

Course files are stored with a `course_id` and are never searched by General, Work or Interview. Library files (no course) are never searched by a Class session.

## Interview

Choose a **role** (Cloud/DevOps, Backend, AI, Software engineer), a category and a mode. See [INTERVIEW.md](INTERVIEW.md).

- **Explain answer**: a spoken answer plus technical explanation, tradeoffs and a follow-up.
- **Practice first**: you answer first, then get feedback.
- **Mock practice**: the app writes a question for your role and category, you answer it, then get feedback. "Next question" avoids repeating the last one.

## Data changes

Migration 3 adds `courses`, and `course_id`/`week` on documents, `page` on chunks, and `session_type`/`course_id`/`week` on meetings. Existing data is kept: old documents stay in the general library and old meetings are General.

## Known limitations

- Citations show where an excerpt came from. They do not prove the model used it correctly; check important facts against the source.
- Word (.docx) files are read as text only (images, charts and text boxes are skipped; old .doc is not supported). Page numbers for Word come from page breaks saved in the file and are approximate; a file without breaks is cited by part.
- PDF page numbers are the PDF's own page order, not printed page labels. Scanned PDFs without text cannot be read.
- Search is keyword-based (SQLite FTS5), not semantic, so a question phrased very differently from the slides may miss them.
- Work sessions have no behaviour of their own yet.
- Not yet verified with a real model and real course files.
