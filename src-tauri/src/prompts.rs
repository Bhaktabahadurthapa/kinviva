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
        Action::Explain => "Say what the other participants just said, in very simple English.\n\
- Write for someone reading quickly while listening: everyday words, like explaining to a 12-year-old.\n\
- At most 3 sentences. Each sentence under 12 words, one idea per sentence.\n\
- Keep the speaker's meaning. Do not add opinions or advice.\n\
- Start with the main point. Skip filler and repetition.\n\
- If a hard word is essential, add at most 2 lines starting with \"- \" that explain it in under 10 words, e.g. \"- API: a way for apps to talk\".\n\
- If words were missing or garbled, end with \"Unclear: \" and a few words.\n\
- No headings, no long lists, no quotes of the transcript.",
        Action::Suggest => "Write a short answer the user could say next, for the user to review and edit.\n\
- Answer the most recent question from \"Them\" directly.\n\
- Use only facts from the transcript, the user's notes, or the document excerpts.\n\
- Do NOT invent the user's experience, opinions, numbers or facts. If a personal detail is needed, \
use a placeholder in square brackets, e.g. [your years of experience].\n\
- Never write \"from my notes\" or describe the user's work unless it appears in <my_notes> or <document_excerpts>.\n\
- Simple format, first person, plain spoken English:\n\
  1. One short sentence that answers (under 20 words).\n\
  2. Then at most 3 short points, each on its own line starting with \"- \" and under 10 words.\n\
- No headings, no quotation marks. If there is nothing to reply to, say: \"No question to answer yet.\"",
        Action::Recap => "Summarise the meeting so far for the user.\n\
- Use 3 to 6 short bullet points: main topics, decisions, open questions, and any action items with owners if stated.\n\
- Only include what is in the transcript. Mark anything uncertain due to transcription with \"(unclear)\".",
        Action::Ask => "Answer the user's question using the meeting transcript, the user's notes and the document excerpts.\n\
- Be brief and direct.\n\
- If the answer is not supported by that material, say so instead of guessing.",
    }
}

pub struct PromptInput<'a> {
    pub action: Action,
    pub transcript: &'a str,
    pub notes: &'a str,
    pub passages: &'a [Passage],
    pub question: Option<&'a str>,
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
    ctx.push_str(instructions(input.action));
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
        });
        assert_eq!(m.len(), 2);
        let u = &m[1].content;
        assert!(u.contains("Them: How long have you used Rust?"));
        assert!(u.contains("<my_notes>\nMention the audio project"));
        assert!(u.contains("[cv.md #3]\nFive years of Rust."));
        assert!(u.contains("Do NOT invent"));
        assert!(u.contains("at most 3 short points"));
        assert!(m[0].content.contains("may contain recognition errors"));
    }

    #[test]
    fn explain_prompt_asks_for_uncertainty_and_plain_english() {
        let m = build(&PromptInput { action: Action::Explain, transcript: "", notes: "", passages: &[], question: None });
        let u = &m[1].content;
        assert!(u.contains("(no speech transcribed yet)"));
        assert!(u.contains("Unclear:"));
        assert!(u.contains("Keep the speaker's meaning"));
        assert!(!u.contains("<document_excerpts>"));
        assert!(u.contains("No notes or documents were provided"));
    }

    #[test]
    fn ask_includes_question() {
        let m = build(&PromptInput { action: Action::Ask, transcript: "Them: hi", notes: "", passages: &[], question: Some(" Who owns the budget? ") });
        assert!(m[1].content.ends_with("User's question: Who owns the budget?"));
    }

    #[test]
    fn slots() {
        assert_eq!(Action::Suggest.slot(), "reply");
        assert_eq!(Action::Explain.slot(), "meaning");
    }
}
