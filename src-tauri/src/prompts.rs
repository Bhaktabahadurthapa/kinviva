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
If something needed is missing, say so briefly. \
Write at senior-professional level: precise and concrete, with no filler and no beginner definitions of common industry terms.";

fn instructions(action: Action) -> &'static str {
    match action {
        Action::Explain => "Give the key points of what the speaker just said (inside <latest>).\n\
Use exactly this layout:\n\
Key points:\n\
- 2 to 5 bullets, the most important first. Each is one short, specific fact, step, number, name or decision the speaker actually said.\n\
Terms:\n\
- Only for uncommon or ambiguous terms a senior professional might not know; never define common industry words (Kubernetes, deploy, API, CI/CD). Otherwise leave the Terms section out.\n\
Unclear: only if words were missing or garbled; say what is uncertain. Leave this line out otherwise.\n\
Rules:\n\
- If the speaker asked a question, output ONLY \"Answer:\" with the expert answer in 4 to 6 prioritised bullets (decisive first action first, each with its reason, tool or command). No Key points, and do not restate the question.\n\
- Do not paraphrase. Keep the speaker's exact names, numbers and terms; do not restate the whole sentence in vaguer words.\n\
- Be accurate: only what the speaker said or clearly meant. No added facts, opinions or advice.\n\
- Use <transcript> only as background for understanding <latest>. Do not re-summarise the whole meeting.\n\
- Everyday words, each bullet under 15 words.",
        Action::Suggest => "Write an answer the user could say to the question in <latest> (if there is no <latest>, the most recent question from \"Them\").\n\
Output exactly NO_ANSWER only when the question is clearly rhetorical, the speaker answers it themselves, \
or it is clearly addressed to someone else. Any question about what or how the user would do, decide, design or recommend is addressed to the user: answer it.\n\
Otherwise use exactly this layout:\n\
Answer:\n\
- 4 to 6 bullets in priority order, the way a senior engineer or manager would answer out loud. The first bullet is the decisive first action or the core of the answer.\n\
- Each bullet is the action or point, then a short reason or the proof: the tool, command, metric, signal or trade-off in the form \"<action>: <why, with the tool, command, metric or trade-off>\". Under 25 words each.\n\
- Name concrete tools, commands, metrics and trade-offs. No generic advice, no introduction, and do not repeat or reword the question.\n\
Fill in: only if a personal detail is missing, list the placeholders in square brackets, e.g. [your years of experience]. Leave this line out otherwise.\n\
Rules:\n\
- Do NOT invent the user's experience, opinions, numbers or facts; use a [placeholder] instead.\n\
- If the question asks about the user's own past work, experience or choices and <my_notes> or <document_excerpts> \
do not contain those facts, give a clear structure with [placeholders] for every specific detail \
(e.g. \"I captured system audio using [method] and the microphone using [method].\") and list them under Fill in.\n\
- A scenario, how, what or why question that does not ask about the user's past (for example \"your service is down, what is your first move?\") \
is answered directly with the best practical steps or reasons, as an expert would. That is not inventing facts about the user.\n\
- Never write \"from my notes\" or describe the user's work unless it appears in <my_notes> or <document_excerpts>.\n\
- Write it as a script the user can read aloud: everyday words, short sentences (under 20 words each).\n\
- When <document_excerpts> contain relevant facts, build the answer from them first and use their exact names and numbers.\n\
- If the excerpts or notes already give every fact the answer needs, leave the Fill in line out completely.\n\
- If the question asks to design, architect or build a system or platform, use up to 8 bullets: first the overall approach, then at least one bullet for every focus area the interviewer named (for example isolation, security, cost), then the main trade-off.\n\
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

/// True when the line asks about the user's own history, experience or opinion
/// (facts only the user can supply). Scenario and how/what/why questions are not.
pub fn about_user(text: &str) -> bool {
    let t = format!(" {} ", text.to_lowercase().replace(['\u{2019}', '\''], ""));
    [
        " have you ", " did you ", " do you have ", " yourself", " about your ", " your experience", " your background",
        " your role", " your project", " your work", " your team", " your career", " you worked", " you built",
        " you used", " youve ", " why did you ", " walk me through your ", " whats your take", " what is your take",
        " your opinion", " do you think", " would you recommend",
    ]
    .iter()
    .any(|p| t.contains(p))
}

pub struct PromptInput<'a> {
    pub action: Action,
    pub transcript: &'a str,
    pub notes: &'a str,
    pub passages: &'a [Passage],
    pub question: Option<&'a str>,
    /// The newest lines to focus on (auto-assist); the transcript is context.
    pub focus: Option<&'a str>,
    /// Session type and course. Class sessions add their own instructions and cited excerpts.
    pub session: &'a crate::session::SessionInfo,
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
        for (i, p) in input.passages.iter().enumerate() {
            if input.session.is_class() {
                ctx.push_str(&format!("[S{}] {}\n{}\n\n", i + 1, crate::session::citation_text(p), p.text.trim()));
            } else {
                ctx.push_str(&format!("[{} #{}]\n{}\n\n", p.document, p.chunk + 1, p.text.trim()));
            }
        }
        ctx.push_str("</document_excerpts>\n");
    }
    if input.session.is_class() && input.passages.is_empty() {
        ctx.push_str("\nNo course resources matched this topic. Say \"Not found in your course resources.\" before any general-knowledge answer.\n");
    } else if input.notes.trim().is_empty() && input.passages.is_empty() {
        ctx.push_str("\nNo notes or documents were provided. You know nothing about the user beyond the transcript; do not claim they have notes, experience, results or opinions.\n");
    }
    ctx.push('\n');
    let asked = input
        .focus
        .unwrap_or_else(|| input.transcript.lines().rev().find(|l| l.starts_with("Them:")).unwrap_or(""));
    let no_context = input.notes.trim().is_empty() && input.passages.is_empty();
    if input.action == Action::Suggest && no_context && about_user(asked) && !input.session.is_class() {
        ctx.push_str(COACH);
    } else {
        ctx.push_str(instructions(input.action));
    }
    if let Some(q) = input.question.filter(|q| !q.trim().is_empty()) {
        ctx.push_str("\n\nUser's question: ");
        ctx.push_str(q.trim());
    }
    let mut system = BASE.to_string();
    if let Some(extra) = input.session.instructions() {
        system.push_str("\n\n");
        system.push_str(&extra);
    }
    vec![
        ChatMessage { role: "system", content: system },
        ChatMessage { role: "user", content: ctx },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suggest_prompt_contains_grounding_rules_and_context() {
        let passages = vec![Passage { document: "cv.md".into(), chunk: 2, text: "Five years of Rust.".into(), page: None, week: None }];
        let m = build(&PromptInput {
            action: Action::Suggest,
            transcript: "Them: How long have you used Rust?",
            notes: "Mention the audio project",
            passages: &passages,
            question: None,
            focus: None,
            session: &Default::default(),
        });
        assert_eq!(m.len(), 2);
        let u = &m[1].content;
        assert!(u.contains("Them: How long have you used Rust?"));
        assert!(u.contains("<my_notes>\nMention the audio project"));
        assert!(u.contains("[cv.md #3]\nFive years of Rust."));
        assert!(u.contains("Do NOT invent"));
        assert!(u.contains("decisive first action"));
        assert!(u.contains("NO_ANSWER"));
        assert!(u.contains("read aloud"));
        assert!(u.contains("build the answer from them first"));
        assert!(m[0].content.contains("may contain recognition errors"));
    }

    #[test]
    fn explain_prompt_asks_for_uncertainty_and_plain_english() {
        let m = build(&PromptInput { action: Action::Explain, transcript: "", notes: "", passages: &[], question: None, focus: None, session: &Default::default() });
        let u = &m[1].content;
        assert!(u.contains("(no speech transcribed yet)"));
        assert!(u.contains("Unclear:"));
        assert!(u.contains("Key points:"));
        assert!(u.contains("Do not paraphrase"));
        assert!(!u.contains("<document_excerpts>"));
        assert!(u.contains("No notes or documents were provided"));
    }

    #[test]
    fn personal_question_without_notes_gets_coaching_not_an_answer() {
        let m = build(&PromptInput { action: Action::Suggest, transcript: "Them: How did you do it?", notes: "", passages: &[], question: None, focus: None, session: &Default::default() });
        assert!(m[1].content.contains("Points to cover:"));
        assert!(!m[1].content.contains("decisive first action"));
        // With notes about the user, a real answer is allowed.
        let m = build(&PromptInput { action: Action::Suggest, transcript: "Them: How did you do it?", notes: "I used ScreenCaptureKit", passages: &[], question: None, focus: None, session: &Default::default() });
        assert!(m[1].content.contains("decisive first action"));
        // A question about the topic itself is answered normally.
        let m = build(&PromptInput { action: Action::Suggest, transcript: "Them: So what is an API used for?", notes: "", passages: &[], question: None, focus: None, session: &Default::default() });
        assert!(!m[1].content.contains("Points to cover:"));
    }

    #[test]
    fn detects_questions_addressed_to_the_user() {
        assert!(about_user("What's your take?"));
        assert!(about_user("Have you tried it before?"));
        assert!(about_user("Tell me about your experience with Kubernetes."));
        // Scenario and how/what/why questions get a direct answer, not coaching.
        assert!(!about_user("Your service is down after a deploy. What's your first move?"));
        assert!(!about_user("Can you walk us through it?"));
        assert!(!about_user("So what happens in this case?"));
        assert!(!about_user("Young teams use it"));
    }

    #[test]
    fn ask_includes_question() {
        let m = build(&PromptInput { action: Action::Ask, transcript: "Them: hi", notes: "", passages: &[], question: Some(" Who owns the budget? "), focus: None, session: &Default::default() });
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
            session: &Default::default(),
        });
        assert!(m[1].content.contains("</transcript>\n<latest>\nThem: the new point\n</latest>"));
        // No focus, no block.
        let m = build(&PromptInput { action: Action::Explain, transcript: "Them: x", notes: "", passages: &[], question: None, focus: None, session: &Default::default() });
        assert!(!m[1].content.contains("</transcript>\n<latest>"));
    }

    #[test]
    fn slots() {
        assert_eq!(Action::Suggest.slot(), "reply");
        assert_eq!(Action::Explain.slot(), "meaning");
    }

    fn class_session() -> crate::session::SessionInfo {
        crate::session::SessionInfo {
            kind: crate::session::SessionKind::Class,
            course_id: Some("os".into()),
            course_name: Some("Operating Systems".into()),
            week: Some(2),
        }
    }

    #[test]
    fn class_sessions_label_excerpts_for_citation_and_add_their_own_instructions() {
        let passages = vec![
            Passage { document: "week2.pdf".into(), chunk: 0, text: "Round robin uses a time quantum.".into(), page: Some(4), week: Some(2) },
            Passage { document: "notes.md".into(), chunk: 1, text: "Aging prevents starvation.".into(), page: None, week: None },
        ];
        let s = class_session();
        let m = build(&PromptInput { action: Action::Suggest, transcript: "Them: How does round robin work?", notes: "", passages: &passages, question: None, focus: None, session: &s });
        // Session instructions are in the system message; data stays in the user message.
        assert!(m[0].content.contains("Operating Systems") && m[0].content.contains("week 2") && m[0].content.contains("[S1]"));
        assert!(m[0].content.contains("may contain recognition errors"), "base rules are still present");
        assert!(!m[1].content.contains("SESSION:"));
        assert!(m[1].content.contains("[S1] week2.pdf, p. 4\nRound robin uses a time quantum."));
        assert!(m[1].content.contains("[S2] notes.md, part 2\nAging prevents starvation."));
        // The personal-history coaching mode never replaces a class answer.
        let m = build(&PromptInput { action: Action::Suggest, transcript: "Them: Tell me about your experience", notes: "", passages: &[], question: None, focus: None, session: &s });
        assert!(!m[1].content.contains("Points to cover"));
        assert!(m[1].content.contains("Not found in your course resources"));
    }

    #[test]
    fn general_and_work_sessions_keep_the_original_prompt() {
        let passages = vec![Passage { document: "cv.md".into(), chunk: 2, text: "Five years of Rust.".into(), page: None, week: None }];
        for kind in [crate::session::SessionKind::General, crate::session::SessionKind::Work] {
            let s = crate::session::SessionInfo { kind, ..Default::default() };
            let a = build(&PromptInput { action: Action::Suggest, transcript: "Them: How long have you used Rust?", notes: "", passages: &passages, question: None, focus: None, session: &s });
            let b = build(&PromptInput { action: Action::Suggest, transcript: "Them: How long have you used Rust?", notes: "", passages: &passages, question: None, focus: None, session: &Default::default() });
            assert_eq!(a[0].content, b[0].content);
            assert_eq!(a[1].content, b[1].content);
            assert!(a[1].content.contains("[cv.md #3]"));
            assert!(!a[0].content.contains("SESSION:"));
        }
    }
}
