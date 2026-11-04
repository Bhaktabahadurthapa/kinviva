//! Optional automatic assistance. When another participant ("Them") finishes
//! speaking, explain what they said and, for questions, draft an answer —
//! without a click. On by default (the user asked for hands-free help); every
//! utterance from the other side is then sent to the configured AI provider,
//! which the UI states plainly. Nothing is ever spoken or typed into the call.

use crate::assistant;
use crate::prompts::Action;
use crate::question::looks_like_question;
use crate::state::AppState;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// Quiet time after the last finished sentence before answering, so a
/// speaker's whole thought gets one calm answer instead of several quick ones.
pub const SETTLE: Duration = Duration::from_millis(600);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Off,
    Explain,
    ExplainAndAnswer,
}

impl Mode {
    pub fn parse(s: &str) -> Self {
        match s {
            "explain" => Mode::Explain,
            "explain_reply" => Mode::ExplainAndAnswer,
            _ => Mode::Off,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct Plan {
    pub explain: bool,
    pub answer: bool,
}

/// What to run for one finished utterance from the other side.
pub fn plan(mode: Mode, text: &str, min_words: usize) -> Option<Plan> {
    if mode == Mode::Off || text.split_whitespace().count() < min_words {
        return None;
    }
    Some(Plan { explain: true, answer: mode == Mode::ExplainAndAnswer && looks_like_question(text) })
}

/// "Them" lines after `since` up to and including `until`, labelled for the prompt.
pub fn new_lines(finals: &[crate::transcript::Segment], since: i64, until: i64) -> String {
    finals
        .iter()
        .filter(|s| s.source == crate::audio::Source::System && s.id > since && s.id <= until)
        .map(|s| format!("Them: {}", s.text))
        .collect::<Vec<_>>()
        .join("\n")
}

#[derive(Default)]
pub struct AutoAssist {
    generation: AtomicU64,
    /// Last "Them" segment already explained; later lines are the new focus.
    last_explained: AtomicI64,
    answer_pending: AtomicBool,
    last_error: Mutex<Option<String>>,
}

impl AutoAssist {
    pub fn reset(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        self.answer_pending.store(false, Ordering::SeqCst);
        self.last_explained.store(-1, Ordering::SeqCst);
        *self.last_error.lock().unwrap() = None;
    }
}

/// Called for every final segment from the other participants.
pub fn on_their_final(app: &AppHandle, segment_id: i64, text: &str) {
    let state = app.state::<AppState>();
    let settings = state.settings();
    let Some(plan) = plan(Mode::parse(&settings.auto_assist), text, settings.auto_min_words as usize) else {
        return;
    };
    if plan.answer {
        state.auto.answer_pending.store(true, Ordering::SeqCst);
    }
    let generation = state.auto.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(SETTLE).await;
        let state = app.state::<AppState>();
        // Newer speech arrived; its own timer will answer with fuller context.
        if state.auto.generation.load(Ordering::SeqCst) != generation {
            return;
        }
        let answer = state.auto.answer_pending.swap(false, Ordering::SeqCst);
        // Explain only what is new since the last explanation.
        let since = state.auto.last_explained.swap(segment_id, Ordering::SeqCst);
        let focus = {
            let live = state.live.lock().unwrap();
            new_lines(&live.transcript.finals, since, segment_id)
        };
        let mut actions = vec![Action::Explain];
        if answer {
            actions.push(Action::Suggest);
        }
        for action in actions {
            if let Err(e) = assistant::start_with(&app, &state, action, None, Some(segment_id), Some(focus.clone())) {
                // Report each distinct problem once, not on every sentence.
                let mut last = state.auto.last_error.lock().unwrap();
                if last.as_deref() != Some(e.as_str()) {
                    let _ = app.emit("app-error", format!("Auto-assist: {e}"));
                    *last = Some(e);
                }
                break;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn off_or_short_utterances_do_nothing() {
        assert_eq!(plan(Mode::Off, "What is the deadline for this project?", 4), None);
        assert_eq!(plan(Mode::ExplainAndAnswer, "Okay, sure.", 4), None);
    }

    #[test]
    fn explains_statements_and_answers_questions() {
        assert_eq!(
            plan(Mode::ExplainAndAnswer, "We moved the tutorial behind the sign-up step.", 4),
            Some(Plan { explain: true, answer: false })
        );
        assert_eq!(
            plan(Mode::ExplainAndAnswer, "Can you walk us through the export feature?", 4),
            Some(Plan { explain: true, answer: true })
        );
        assert_eq!(
            plan(Mode::Explain, "Can you walk us through the export feature?", 4),
            Some(Plan { explain: true, answer: false })
        );
    }

    #[test]
    fn focus_contains_only_new_lines_from_them() {
        use crate::audio::Source;
        use crate::transcript::Segment;
        let seg = |id, source, text: &str| Segment { id, source, text: text.into(), start_ms: 0, end_ms: 0 };
        let finals = vec![
            seg(1, Source::System, "old point"),
            seg(2, Source::Mic, "my words"),
            seg(3, Source::System, "new point"),
            seg(4, Source::System, "and its detail"),
            seg(5, Source::System, "not yet"),
        ];
        assert_eq!(new_lines(&finals, 1, 4), "Them: new point\nThem: and its detail");
        assert_eq!(new_lines(&finals, -1, 1), "Them: old point");
    }

    #[test]
    fn mode_parsing_defaults_to_off() {
        assert_eq!(Mode::parse("explain_reply"), Mode::ExplainAndAnswer);
        assert_eq!(Mode::parse("explain"), Mode::Explain);
        assert_eq!(Mode::parse(""), Mode::Off);
        assert_eq!(Mode::parse("anything"), Mode::Off);
    }
}
