//! Prompt construction for the four assist actions. Kept separate from I/O so
//! the grounding rules can be tested and reviewed in one place.

use crate::db::Passage;
use crate::llm::ChatMessage;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Ask,
    Explain,
    Suggest,
    Recap,
}

impl Action {
    pub fn as_str(&self) -> &'static str {
        match self {
            Action::Ask => "ask",
            Action::Explain => "explain",
            Action::Suggest => "suggest",
            Action::Recap => "recap",
        }
    }
    /// Which panel shows the result.
    pub fn slot(&self) -> &'static str {
        match self {
            Action::Suggest => "reply",
            _ => "meaning",
        }
    }
}

const BASE: &str = "You are MeetingLens, a private assistant that helps the user (\"Me\") follow a live meeting. \
The transcript comes from automatic speech recognition and may contain recognition errors, missing words, \
or unfinished sentences. Lines from \"Them\" are other participants (computer audio); lines from \"Me\" are the user's microphone. \
Never invent facts, numbers, names, experience, or opinions that are not in the transcript, the user's notes, or the document excerpts. \
If something needed is missing, say so briefly.";

fn instructions(action: Action) -> &'static str {
    match action {
        Action::Explain => "Explain what the speaker just said (inside <latest>) so the user understands it clearly and correctly.\n\
Use exactly this layout:\n\
Meaning: one or two clear sentences stating the speaker's main point in plain English.\n\
Details:\n\
- 2 to 4 lines. Each is one short, complete sentence with a specific fact, step, reason or example the speaker actually said.\n\
Terms:\n\
- Only for technical words the speaker used: the word, then a dash, then what it means in plain words. At most 3 lines. Leave out the Terms section if there are none.\n\
Unclear: only if words were missing or garbled; say what is uncertain. Leave this line out otherwise.\n\
Rules:\n\
- Be accurate. State only what the speaker said or clearly meant. No added facts, opinions or advice.\n\
- Use <transcript> only as background for understanding <latest>. Do not re-summarise the whole meeting.\n\
- Everyday words and short sentences (under 20 words each).",
        Action::Suggest => "Write an answer the user could say to the question in <latest> (if there is no <latest>, the most recent question from \"Them\").\n\
First decide whether it is a real question asked to the user. If it is rhetorical, the speaker answers it themselves, \
or it is not directed at the user, output exactly: NO_ANSWER\n\
Otherwise use exactly this layout:\n\
Answer: one or two clear sentences that directly answer the question, first person, natural spoken English.\n\
Details:\n\
- 2 to 4 short, complete sentences with specific supporting facts, examples or steps from the transcript, the user's notes or the document excerpts.\n\
Fill in: only if a personal detail is missing, list the placeholders in square brackets, e.g. [your years of experience]. Leave this line out otherwise.\n\
Rules:\n\
- Do NOT invent the user's experience, opinions, numbers or facts; use a [placeholder] instead.\n\
- If the question asks about the user's own work, experience, choices or plans and <my_notes> or <document_excerpts> \
do not contain those facts, give a clear structure with [placeholders] for every specific detail \
(e.g. \"I captured system audio using [method] and the microphone using [method].\") and list them under Fill in.\n\
- Never write \"from my notes\" or describe the user's work unless it appears in <my_notes> or <document_excerpts>.\n\
- Be specific and correct. Prefer the exact names, numbers and terms used in the meeting.",
        Action::Recap => "Summarise the meeting so far for the user.\n\
- Use 3 to 6 short bullet points: main topics, decisions, open questions, and any action items with owners if stated.\n\
- Only include what is in the transcript. Mark anything uncertain due to transcription with \"(unclear)\".",
        Action::Ask => "Answer the user's question using the meeting transcript, the user's notes and the document excerpts.\n\
- Be brief and direct.\n\
- If the answer is not supported by that material, say so instead of guessing.",
    }
}

/// Used instead of the answer layout when the question is about the user and
/// the app holds no notes or documents about them: a local model cannot be
/// trusted not to invent the user's own facts, so it coaches instead.
const COACH: &str = "The other participant asked the user about the user's own work, experience, choices or opinion.\n\
You know nothing about the user, so do NOT answer for them and do NOT state any fact about what they did, used or think.\n\
Use exactly this layout:\n\
Asking: one sentence saying what they want to know.\n\
Points to cover:\n\
- 2 to 4 short tips telling the user what to mention, each starting with a verb (e.g. \"Say which method you used\", \"Give one example\"). Tips only.";

/// True when a line from the other side is addressed to the user ("you", "your").
pub fn about_user(text: &str) -> bool {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric() && c != '\'')
        .any(|w| matches!(w, "you" | "your" | "yours" | "you've" | "you're" | "you'd" | "yourself"))
}

pub struct PromptInput<'a> {
    pub action: Action,
    pub transcript: &'a str,
    pub notes: &'a str,
    pub passages: &'a [Passage],
    pub question: Option<&'a str>,
    /// The newest lines to focus on (auto-assist); the transcript is context.
    pub focus: Option<&'a str>,
}

pub fn build(input: &PromptInput) -> Vec<ChatMessage> {
    let mut ctx = String::new();
    ctx.push_str("<transcript>\n");
    if input.transcript.trim().is_empty() {
        ctx.push_str("(no speech transcribed yet)\n");
    } else {
        ctx.push_str(input.transcript.trim());
        ctx.push('\n');
    }
    ctx.push_str("</transcript>\n");
    if let Some(focus) = input.focus.filter(|f| !f.trim().is_empty()) {
        ctx.push_str("<latest>\n");
        ctx.push_str(focus.trim());
        ctx.push_str("\n</latest>\n");
    }
    if !input.notes.trim().is_empty() {
        ctx.push_str("<my_notes>\n");
        ctx.push_str(input.notes.trim());
        ctx.push_str("\n</my_notes>\n");
    }
    if !input.passages.is_empty() {
        ctx.push_str("<document_excerpts>\n");
        for p in input.passages {
            ctx.push_str(&format!("[{} #{}]\n{}\n\n", p.document, p.chunk + 1, p.text.trim()));
        }
        ctx.push_str("</document_excerpts>\n");
    }
    if input.notes.trim().is_empty() && input.passages.is_empty() {
        ctx.push_str("\nNo notes or documents were provided. You know nothing about the user beyond the transcript; do not claim they have notes, experience, results or opinions.\n");
    }
    ctx.push('\n');
    let asked = input
        .focus
        .unwrap_or_else(|| input.transcript.lines().rev().find(|l| l.starts_with("Them:")).unwrap_or(""));
    let no_context = input.notes.trim().is_empty() && input.passages.is_empty();
    if input.action == Action::Suggest && no_context && about_user(asked) {
        ctx.push_str(COACH);
    } else {
        ctx.push_str(instructions(input.action));
    }
    if let Some(q) = input.question.filter(|q| !q.trim().is_empty()) {
        ctx.push_str("\n\nUser's question: ");
        ctx.push_str(q.trim());
    }
    vec![
        ChatMessage { role: "system", content: BASE.to_string() },
        ChatMessage { role: "user", content: ctx },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suggest_prompt_contains_grounding_rules_and_context() {
        let passages = vec![Passage { document: "cv.md".into(), chunk: 2, text: "Five years of Rust.".into() }];
        let m = build(&PromptInput {
            action: Action::Suggest,
            transcript: "Them: How long have you used Rust?",
            notes: "Mention the audio project",
            passages: &passages,
            question: None,
            focus: None,
        });
        assert_eq!(m.len(), 2);
        let u = &m[1].content;
        assert!(u.contains("Them: How long have you used Rust?"));
        assert!(u.contains("<my_notes>\nMention the audio project"));
        assert!(u.contains("[cv.md #3]\nFive years of Rust."));
        assert!(u.contains("Do NOT invent"));
        assert!(u.contains("Answer: one or two clear sentences"));
        assert!(u.contains("NO_ANSWER"));
        assert!(m[0].content.contains("may contain recognition errors"));
    }

    #[test]
    fn explain_prompt_asks_for_uncertainty_and_plain_english() {
        let m = build(&PromptInput { action: Action::Explain, transcript: "", notes: "", passages: &[], question: None, focus: None });
        let u = &m[1].content;
        assert!(u.contains("(no speech transcribed yet)"));
        assert!(u.contains("Unclear:"));
        assert!(u.contains("Meaning:"));
        assert!(u.contains("Details:"));
        assert!(!u.contains("<document_excerpts>"));
        assert!(u.contains("No notes or documents were provided"));
    }

    #[test]
    fn personal_question_without_notes_gets_coaching_not_an_answer() {
        let m = build(&PromptInput { action: Action::Suggest, transcript: "Them: How did you do it?", notes: "", passages: &[], question: None, focus: None });
        assert!(m[1].content.contains("Points to cover:"));
        assert!(!m[1].content.contains("Answer: one or two clear sentences"));
        // With notes about the user, a real answer is allowed.
        let m = build(&PromptInput { action: Action::Suggest, transcript: "Them: How did you do it?", notes: "I used ScreenCaptureKit", passages: &[], question: None, focus: None });
        assert!(m[1].content.contains("Answer: one or two clear sentences"));
        // A question about the topic itself is answered normally.
        let m = build(&PromptInput { action: Action::Suggest, transcript: "Them: So what is an API used for?", notes: "", passages: &[], question: None, focus: None });
        assert!(!m[1].content.contains("Points to cover:"));
    }

    #[test]
    fn detects_questions_addressed_to_the_user() {
        assert!(about_user("Can you walk us through it?"));
        assert!(about_user("What's your take?"));
        assert!(about_user("Have you've tried it")); 
        assert!(!about_user("So what happens in this case?"));
        assert!(!about_user("Young teams use it"));
    }

    #[test]
    fn ask_includes_question() {
        let m = build(&PromptInput { action: Action::Ask, transcript: "Them: hi", notes: "", passages: &[], question: Some(" Who owns the budget? "), focus: None });
        assert!(m[1].content.ends_with("User's question: Who owns the budget?"));
    }

    #[test]
    fn focus_is_marked_as_latest() {
        let m = build(&PromptInput {
            action: Action::Explain,
            transcript: "Them: earlier context\nThem: the new point",
            notes: "",
            passages: &[],
            question: None,
            focus: Some("Them: the new point"),
        });
        assert!(m[1].content.contains("</transcript>\n<latest>\nThem: the new point\n</latest>"));
        // No focus, no block.
        let m = build(&PromptInput { action: Action::Explain, transcript: "Them: x", notes: "", passages: &[], question: None, focus: None });
        assert!(!m[1].content.contains("</transcript>\n<latest>"));
    }

    #[test]
    fn slots() {
        assert_eq!(Action::Suggest.slot(), "reply");
        assert_eq!(Action::Explain.slot(), "meaning");
    }
}
