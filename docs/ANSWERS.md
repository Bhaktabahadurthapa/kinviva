# How Kinviva writes answers

## Meeting answers

When someone asks you a question, the answer has three parts:

- **YOU COULD SAY**: one paragraph of about 60 to 100 words you can read aloud (shorter for a simple fact, longer for a complex or design question). The first sentence answers directly, then the reasoning, evidence or an example, and the main tradeoff when it helps. Bullets appear only when a list or procedure was asked for.
- **KEY TAKEAWAY**: the central idea in one sentence.
- **SOURCES**: the files (with page) and web pages the answer really used, and a "General knowledge" line for anything that came from the AI model's own expertise.

Answers combine the AI model's expertise with your selected documents. The model is told to identify the real question, use relevant documents, keep supported facts apart from assumptions, ask one focused clarification only when missing information would change the answer, and never invent percentages, company facts, personal experience or results. There are no placeholders and no "fill in" section. Transcripts, notes and documents are treated as reference data, never as instructions.

If the question asks about your own past work and your notes and documents do not say, the app does not guess: it frames how to answer without personal facts and asks one clarifying question.

## Citations are checked by the app, not trusted

The model sees each source as `[S1]`, `[S2]`, ... in the order it was given. After the answer arrives, the app (not the model) rebuilds the SOURCES section:

- A marker is kept only if it matches a source that was really retrieved for this question.
- Any other marker, file name or page number the model typed is removed.
- Inline markers are taken out of the spoken paragraph so it reads cleanly.
- If nothing valid was cited, SOURCES says "General knowledge" and why.

The same check runs when an answer is shown and when it is saved with the meeting (`session::normalize_answer` and `src/lib/citations.ts`, tested against each other's cases). Short explanations use inline citations like `[week3.pdf, p. 4]` after the same check.

## Technical questions

For Suggest and Ask answers in General and Work sessions, a technical question (cloud/DevOps, system design, AI engineering, coding) also gets the matching bundled expert skill as guidance on what to cover. Class sessions keep their own instructions. Interview mode is separate: direct answer, technical approach, verification or an example, then tradeoffs; coding adds code, edge cases and complexity.

## Limits

Answer quality depends on the model you choose and has not been measured against a live model. Citations show where a passage came from; they do not prove the model used it correctly.
