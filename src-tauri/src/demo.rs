//! Clearly labelled demo meeting for exploring the UI without audio or a
//! speech provider. Demo meetings are flagged `is_demo` in the database and
//! shown with a DEMO badge; they never come from a real integration.

use crate::audio::Source;
use crate::db::{now_ms, Db};

const LINES: &[(Source, &str)] = &[
    (Source::System, "Thanks for joining. Today we want to look at the onboarding numbers from last month."),
    (Source::Mic, "Sure. I pulled the report this morning."),
    (Source::System, "Activation dropped a bit after we moved the tutorial behind the sign up step, so we think the extra friction hurt."),
    (Source::System, "Before we decide anything, can you walk us through how the new export feature affects onboarding?"),
];

pub fn create(db: &Db) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let start = now_ms();
    db.create_meeting(&id, "[DEMO] Sample onboarding review", start, true)?;
    for (i, (src, text)) in LINES.iter().enumerate() {
        let t = i as i64 * 6000;
        db.add_segment(&id, *src, text, t, t + 5000)?;
    }
    db.set_notes(&id, "DEMO notes: export ships next sprint; onboarding owner is the growth team.")?;
    db.end_meeting(&id, start + 30_000)?;
    Ok(id)
}
