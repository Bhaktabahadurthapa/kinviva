//! Optional detection of questions asked by other participants, with a
//! cooldown and duplicate suppression. Detection only raises a hint in the
//! UI; it never triggers an AI call or speaks into the meeting.

use std::collections::{HashSet, VecDeque};

const STARTERS: &[&str] = &[
    "what", "why", "how", "when", "where", "who", "which", "can you", "could you", "would you",
    "will you", "do you", "did you", "have you", "are you", "is there", "is it", "tell me",
    "walk me through", "explain", "describe", "any thoughts", "thoughts on",
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
    STARTERS.iter().any(|s| t.starts_with(s))
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
}
