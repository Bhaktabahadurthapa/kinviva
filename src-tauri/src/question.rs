//! Optional detection of questions asked by other participants, with a
//! cooldown and duplicate suppression. Detection only raises a hint in the
//! UI; it never triggers an AI call or speaks into the meeting.

use std::collections::{HashSet, VecDeque};

const STARTERS: &[&str] = &[
    "what", "why", "how", "when", "where", "who", "which", "can you", "could you", "would you",
    "will you", "do you", "did you", "have you", "are you", "is there", "is it", "tell me",
    "walk me through", "explain", "describe", "any thoughts", "thoughts on", "design", "architect",
    "build a", "build an", "implement", "propose", "outline", "compare", "recommend", "suggest", "give me", "show me",
    "write a", "write an", "create a", "create an", "let's design", "i want you to", "your task",
];

/// Question openers that count anywhere in a sentence, not only at its start.
const INSIDE: &[&str] = &[
    " how do you ", " how would you ", " how can you ", " how did you ", " what is your ", " what would you ", " what do you ",
    " what are your ", " why do you ", " why would you ", " can you ", " could you ", " would you ", " do you ", " did you ",
    " have you ", " tell me ", " walk me through ", " what happens if ", " what happens when ",
    " design a ", " design an ", " design the ", " architect a ", " how would ", " your task is ", " the question is ",
];

pub struct QuestionDetector {
    cooldown_ms: i64,
    last_fired_ms: Option<i64>,
    recent: VecDeque<HashSet<String>>,
}

fn words(text: &str) -> HashSet<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.len() > 2)
        .map(String::from)
        .collect()
}

fn jaccard(a: &HashSet<String>, b: &HashSet<String>) -> f32 {
    if a.is_empty() && b.is_empty() {
        return 1.0;
    }
    a.intersection(b).count() as f32 / a.union(b).count() as f32
}

pub fn looks_like_question(text: &str) -> bool {
    let t = text.trim().to_lowercase();
    if t.split_whitespace().count() < 3 {
        return false;
    }
    if t.ends_with('?') {
        return true;
    }
    if STARTERS.iter().any(|s| t.starts_with(s)) {
        return true;
    }
    // Speech recognition drops question marks, and people lead into questions
    // ("okay, so the second one is how do you design ...").
    let padded = format!(" {} ", t.replace([',', '.'], " "));
    INSIDE.iter().any(|p| padded.contains(p))
}

impl QuestionDetector {
    pub fn new(cooldown_secs: u32) -> Self {
        Self { cooldown_ms: cooldown_secs as i64 * 1000, last_fired_ms: None, recent: VecDeque::new() }
    }

    pub fn set_cooldown(&mut self, secs: u32) {
        self.cooldown_ms = secs as i64 * 1000;
    }

    /// Returns true when `text` should be surfaced as a detected question.
    pub fn check(&mut self, text: &str, now_ms: i64) -> bool {
        if !looks_like_question(text) {
            return false;
        }
        let w = words(text);
        if self.recent.iter().any(|r| jaccard(r, &w) >= 0.8) {
            return false;
        }
        if let Some(last) = self.last_fired_ms {
            if now_ms - last < self.cooldown_ms {
                return false;
            }
        }
        self.last_fired_ms = Some(now_ms);
        self.recent.push_back(w);
        if self.recent.len() > 10 {
            self.recent.pop_front();
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_questions() {
        assert!(looks_like_question("What is your experience with Rust?"));
        assert!(looks_like_question("Can you walk us through the design"));
        assert!(!looks_like_question("Thanks everyone."));
        assert!(!looks_like_question("Why?"));
    }

    #[test]
    fn cooldown_and_duplicates() {
        let mut d = QuestionDetector::new(20);
        assert!(d.check("What is the deadline for this project?", 0));
        // Different question but inside the cooldown.
        assert!(!d.check("How big is the team today?", 5_000));
        // After cooldown, a near-duplicate is still suppressed.
        assert!(!d.check("What is the deadline for this project", 30_000));
        assert!(d.check("How big is the team today?", 31_000));
    }

    #[test]
    fn questions_without_a_mark_or_a_leading_question_word_are_found() {
        assert!(looks_like_question("Okay, so the second one would be how do you design a CI/CD pipeline that ships fast"));
        assert!(looks_like_question("So imagine your service is down. What is your first move"));
        assert!(!looks_like_question("We moved the tutorial behind the sign-up step"));
        assert!(!looks_like_question("I know how you design it but that is fine"));
    }

    #[test]
    fn design_and_other_imperative_prompts_are_questions() {
        assert!(looks_like_question("Design a multi-tenant CI/CD platform for internal teams across AWS and Azure. Focus on isolation, security and cost."));
        assert!(looks_like_question("Okay next one. Design a rate limiter for a public API"));
        assert!(looks_like_question("Compare Kubernetes namespaces and separate clusters for tenant isolation"));
        assert!(looks_like_question("Imagine you must design an audit pipeline for payments"));
        assert!(!looks_like_question("Thanks, that design looks good to me"));
    }
}
