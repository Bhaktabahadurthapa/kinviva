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
        Action::Explain => "Explain what the other participants most recently said, in simple English.\n\
- Preserve the speaker's meaning. Do not add opinions or advice.\n\
- Use short, plain sentences (aim for under 15 words each). Avoid jargon; if a technical term is essential, define it in a few words.\n\
- Focus on the last thing \"Them\" said, using earlier lines only for context.\n\
- 2 to 4 sentences. No headings.\n\
- If they mentioned specific details (numbers, dates, names, steps, requirements), list them after the sentences \
as 1 to 4 short lines starting with \"- \".\n\
- If words seem missing, garbled or cut off, end with a line starting with \"Unclear:\" naming what is uncertain.",
        Action::Suggest => "Draft an answer the user could say next, for the user to review and edit.\n\
- Respond to the most recent question or point from \"Them\".\n\
- Ground every claim in the transcript, the user's notes, or the document excerpts.\n\
- Do NOT invent the user's experience, opinions, numbers or facts. Where a personal detail is needed but not provided, \
leave a clear placeholder in square brackets, e.g. [your years of experience].\n\
- Never write \"from my notes\" or describe the user's work unless it appears in <my_notes> or <document_excerpts>.\n\
- Use this simple format, first person, natural spoken tone:\n\
  1. One or two plain sentences that directly answer.\n\
  2. Then 2 to 4 short supporting details, each on its own line starting with \"- \" \
(facts, examples or steps from the material above, or a [placeholder] the user should fill in).\n\
- No headings, no quotation marks around the answer. If there is nothing to reply to, say: \"No question or point to reply to yet.\"",
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
        assert!(u.contains("supporting details"));
        assert!(m[0].content.contains("may contain recognition errors"));
    }

    #[test]
    fn explain_prompt_asks_for_uncertainty_and_plain_english() {
        let m = build(&PromptInput { action: Action::Explain, transcript: "", notes: "", passages: &[], question: None });
        let u = &m[1].content;
        assert!(u.contains("(no speech transcribed yet)"));
        assert!(u.contains("Unclear:"));
        assert!(u.contains("Preserve the speaker's meaning"));
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
