//! Live transcript state shared by the main window and the overlay.

use crate::audio::Source;
use serde::Serialize;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Segment {
    pub id: i64,
    pub source: Source,
    pub text: String,
    pub start_ms: i64,
    pub end_ms: i64,
}

#[derive(Debug, Default, Clone, Serialize)]
pub struct Transcript {
    pub finals: Vec<Segment>,
    /// In-progress (not yet final) text per source.
    pub partials: HashMap<Source, String>,
}

impl Transcript {
    pub fn clear(&mut self) {
        self.finals.clear();
        self.partials.clear();
    }

    pub fn set_partial(&mut self, source: Source, text: &str) {
        if text.trim().is_empty() {
            self.partials.remove(&source);
        } else {
            self.partials.insert(source, text.trim().to_string());
        }
    }

    /// Append a final segment; it replaces that source's partial text.
    pub fn push_final(&mut self, seg: Segment) {
        self.partials.remove(&seg.source);
        self.finals.push(seg);
    }

    /// Render the most recent conversation for a prompt, newest last, bounded
    /// by `max_chars`. In-progress text is marked so the model can treat it
    /// as possibly incomplete.
    pub fn recent_window(&self, max_chars: usize) -> String {
        let mut lines: Vec<String> = Vec::new();
        let mut used = 0usize;
        let mut partials: Vec<(&Source, &String)> = self.partials.iter().collect();
        partials.sort_by_key(|(s, _)| s.as_str());
        for (src, text) in partials.iter().rev() {
            let line = format!("{} (still speaking, may be incomplete): {}", src.speaker_label(), text);
            used += line.len() + 1;
            lines.push(line);
        }
        for seg in self.finals.iter().rev() {
            let line = format!("{}: {}", seg.source.speaker_label(), seg.text);
            if used + line.len() + 1 > max_chars {
                if lines.is_empty() {
                    // Always include at least the tail of the newest segment.
                    let tail: String = line.chars().rev().take(max_chars).collect::<Vec<_>>().into_iter().rev().collect();
                    lines.push(tail);
                }
                break;
            }
            used += line.len() + 1;
            lines.push(line);
        }
        lines.reverse();
        lines.join("\n")
    }

    /// Text of the last final segment from `source`, if any.
    pub fn last_from(&self, source: Source) -> Option<&Segment> {
        self.finals.iter().rev().find(|s| s.source == source)
    }
}


/// Words too common to show that two lines are the same speech.
const COMMON: &[&str] = &[
    "that", "this", "with", "have", "your", "what", "when", "then", "they", "them", "from", "would", "could", "there",
    "their", "about", "which", "will", "just", "like", "been", "were", "into", "also", "some", "than", "more", "here",
    "right", "okay", "yeah", "well",
];

fn content_words(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .map(|w| w.to_lowercase())
        .filter(|w| w.len() >= 4 && !COMMON.contains(&w.as_str()))
        .collect()
}

impl Transcript {
    /// True when `text` (from the microphone) is the other side's speech
    /// coming out of the speakers and back into the mic: nearly all of its
    /// content words appear in what the system audio carried at that time.
    /// `window` is the span the mic line covers; `None` means "just now".
    pub fn is_speaker_echo(&self, text: &str, window: Option<(i64, i64)>) -> bool {
        let mine = content_words(text);
        if mine.len() < 2 {
            return false;
        }
        let mut theirs: Vec<String> = Vec::new();
        let system: Vec<&Segment> = self.finals.iter().filter(|s| s.source == Source::System).collect();
        match window {
            Some((a, b)) => system
                .iter()
                .filter(|s| s.end_ms >= a - 6000 && s.start_ms <= b + 6000)
                .for_each(|s| theirs.extend(content_words(&s.text))),
            None => system.iter().rev().take(4).for_each(|s| theirs.extend(content_words(&s.text))),
        }
        if let Some(p) = self.partials.get(&Source::System) {
            theirs.extend(content_words(p));
        }
        let matched = mine.iter().filter(|w| theirs.contains(w)).count();
        matched * 10 >= mine.len() * 7
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(id: i64, source: Source, text: &str) -> Segment {
        Segment { id, source, text: text.into(), start_ms: id * 1000, end_ms: id * 1000 + 900 }
    }

    #[test]
    fn final_replaces_partial_for_same_source_only() {
        let mut t = Transcript::default();
        t.set_partial(Source::System, "what is your");
        t.set_partial(Source::Mic, "um");
        t.push_final(seg(1, Source::System, "What is your timeline?"));
        assert!(!t.partials.contains_key(&Source::System));
        assert_eq!(t.partials.get(&Source::Mic).unwrap(), "um");
        assert_eq!(t.finals.len(), 1);
    }

    #[test]
    fn empty_partial_clears() {
        let mut t = Transcript::default();
        t.set_partial(Source::Mic, "hello");
        t.set_partial(Source::Mic, "  ");
        assert!(t.partials.is_empty());
    }

    #[test]
    fn window_is_chronological_labelled_and_bounded() {
        let mut t = Transcript::default();
        for i in 0..50 {
            t.push_final(seg(i, if i % 2 == 0 { Source::System } else { Source::Mic }, &format!("line number {i}")));
        }
        t.set_partial(Source::System, "and what about");
        let w = t.recent_window(120);
        assert!(w.len() <= 140, "{}", w.len());
        let lines: Vec<&str> = w.lines().collect();
        assert!(lines.last().unwrap().starts_with("Them (still speaking"));
        assert!(lines[lines.len() - 2].ends_with("line number 49"));
        assert!(!w.contains("line number 10"));
    }

    #[test]
    fn window_includes_tail_of_oversized_segment() {
        let mut t = Transcript::default();
        t.push_final(seg(1, Source::System, &"x".repeat(500)));
        assert_eq!(t.recent_window(50).len(), 50);
    }
    #[test]
    fn speaker_echo_is_recognised_but_real_replies_are_kept() {
        let mut t = Transcript::default();
        let seg = |id, source, text: &str, a, b| Segment { id, source, text: text.into(), start_ms: a, end_ms: b };
        t.push_final(seg(1, Source::System, "Your Kubernetes service is down after a deploy. What's your first move?", 33_000, 38_000));
        // The speakers leaked into the mic.
        assert!(t.is_speaker_echo("What's your first move?", Some((34_000, 36_000))));
        assert!(t.is_speaker_echo("Your Kubernetes service is down after a deploy.", None));
        // A genuine answer reuses few of their words.
        assert!(!t.is_speaker_echo("I would check the deployment logs and roll back the release first.", Some((40_000, 46_000))));
        // Too short to judge.
        assert!(!t.is_speaker_echo("Mmm.", None));
        // Echo of something said long before is not echo of this moment.
        assert!(!t.is_speaker_echo("What's your first move?", Some((90_000, 92_000))));
    }

}
