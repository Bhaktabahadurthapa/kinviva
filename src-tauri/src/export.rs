//! Markdown and plain-text export of a saved meeting.

use crate::db::MeetingDetail;

fn fmt_ts(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .map(|d| d.format("%Y-%m-%d %H:%M UTC").to_string())
        .unwrap_or_default()
}

fn fmt_offset(ms: i64) -> String {
    let s = ms.max(0) / 1000;
    format!("{:02}:{:02}", s / 60, s % 60)
}

fn action_title(action: &str) -> &str {
    match action {
        "explain" => "Simple meaning",
        "suggest" => "Suggested reply",
        "recap" => "Recap",
        "ask" => "Answer",
        _ => action,
    }
}

pub fn to_markdown(m: &MeetingDetail) -> String {
    let mut out = format!("# {}\n\n", m.meeting.title);
    if m.meeting.is_demo {
        out.push_str("> DEMO DATA — not a real meeting.\n\n");
    }
    out.push_str(&format!("- Started: {}\n", fmt_ts(m.meeting.started_at)));
    if let Some(end) = m.meeting.ended_at {
        out.push_str(&format!("- Ended: {}\n", fmt_ts(end)));
    }
    out.push_str("- Exported from MeetingLens\n\n");
    if !m.notes.trim().is_empty() {
        out.push_str("## Notes\n\n");
        out.push_str(m.notes.trim());
        out.push_str("\n\n");
    }
    out.push_str("## Transcript\n\n");
    if m.segments.is_empty() {
        out.push_str("_No transcript was captured._\n\n");
    }
    for s in &m.segments {
        out.push_str(&format!("**{}** `{}` {}\n\n", s.source.speaker_label(), fmt_offset(s.start_ms), s.text));
    }
    let done: Vec<_> = m.ai_messages.iter().filter(|a| a.status == "done").collect();
    if !done.is_empty() {
        out.push_str("## AI assistance\n\n");
        for a in done {
            out.push_str(&format!("### {}\n\n", action_title(&a.action)));
            if let Some(q) = &a.question {
                out.push_str(&format!("> {}\n\n", q));
            }
            out.push_str(a.response.trim());
            out.push_str(&format!("\n\n_Model: {}_\n\n", a.model));
        }
    }
    out
}

pub fn to_text(m: &MeetingDetail) -> String {
    let mut out = format!("{}\n{}\n", m.meeting.title, "=".repeat(m.meeting.title.chars().count().max(3)));
    if m.meeting.is_demo {
        out.push_str("DEMO DATA - not a real meeting.\n");
    }
    out.push_str(&format!("Started: {}\n", fmt_ts(m.meeting.started_at)));
    if let Some(end) = m.meeting.ended_at {
        out.push_str(&format!("Ended: {}\n", fmt_ts(end)));
    }
    if !m.notes.trim().is_empty() {
        out.push_str(&format!("\nNOTES\n{}\n", m.notes.trim()));
    }
    out.push_str("\nTRANSCRIPT\n");
    for s in &m.segments {
        out.push_str(&format!("[{}] {}: {}\n", fmt_offset(s.start_ms), s.source.speaker_label(), s.text));
    }
    let done: Vec<_> = m.ai_messages.iter().filter(|a| a.status == "done").collect();
    if !done.is_empty() {
        out.push_str("\nAI ASSISTANCE\n");
        for a in done {
            out.push_str(&format!("\n-- {} --\n", action_title(&a.action)));
            if let Some(q) = &a.question {
                out.push_str(&format!("Q: {q}\n"));
            }
            out.push_str(a.response.trim());
            out.push('\n');
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::Source;
    use crate::db::Db;

    fn sample() -> MeetingDetail {
        let db = Db::open_in_memory().unwrap();
        db.create_meeting("m", "Client call", 1_700_000_000_000, false).unwrap();
        db.add_segment("m", Source::System, "When can you deliver?", 65_000, 67_000).unwrap();
        db.add_segment("m", Source::Mic, "Next Friday.", 68_000, 69_000).unwrap();
        db.set_notes("m", "Deliverable: report").unwrap();
        db.add_ai_message("a", Some("m"), "suggest", None, "We can deliver next Friday.", "llama3", "done").unwrap();
        db.add_ai_message("b", Some("m"), "explain", None, "partial junk", "llama3", "cancelled").unwrap();
        db.end_meeting("m", 1_700_000_100_000).unwrap();
        db.get_meeting("m").unwrap()
    }

    #[test]
    fn markdown_contains_transcript_notes_and_completed_ai_only() {
        let md = to_markdown(&sample());
        assert!(md.starts_with("# Client call\n"));
        assert!(md.contains("**Them** `01:05` When can you deliver?"));
        assert!(md.contains("**Me** `01:08` Next Friday."));
        assert!(md.contains("## Notes\n\nDeliverable: report"));
        assert!(md.contains("### Suggested reply\n\nWe can deliver next Friday."));
        assert!(!md.contains("partial junk"));
        assert!(md.contains("2023-11-14 22:13 UTC"));
    }

    #[test]
    fn text_export_is_plain() {
        let t = to_text(&sample());
        assert!(t.contains("[01:05] Them: When can you deliver?"));
        assert!(t.contains("[01:08] Me: Next Friday."));
        assert!(!t.contains("**"));
        assert!(!t.contains("partial junk"));
    }
}
