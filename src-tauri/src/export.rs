//! Study notes you can download after a meeting or an interview practice
//! session: Markdown, plain text, or Word (.docx). A notes document is built
//! once (`Doc`), then drawn in each format, so the three always match.

use crate::db::{AiMessage, InterviewEntry, MeetingDetail, SourceRef};
use std::io::Write;

#[derive(Debug, Clone, PartialEq)]
pub enum Block {
    Para(String),
    Bullets(Vec<String>),
    Quote(String),
    /// A small bold label such as "Say it".
    Label(String),
    Code(String),
    Small(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Section {
    pub heading: String,
    pub blocks: Vec<Block>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Doc {
    pub title: String,
    pub meta: Vec<String>,
    pub sections: Vec<Section>,
}

fn fmt_ts(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms).map(|d| d.format("%Y-%m-%d %H:%M UTC").to_string()).unwrap_or_default()
}

fn fmt_offset(ms: i64) -> String {
    let s = ms.max(0) / 1000;
    format!("{:02}:{:02}", s / 60, s % 60)
}

/// The three headings of a meeting answer, on a line of their own.
fn is_heading(line: &str) -> bool {
    matches!(line.trim().trim_matches('*').trim_end_matches(':').to_uppercase().as_str(), "YOU COULD SAY" | "KEY TAKEAWAY" | "HARD WORDS" | "SOURCES" | "CLARIFICATION")
}

fn title_case(line: &str) -> String {
    let t = line.trim().trim_matches('*').trim_end_matches(':').to_lowercase();
    let mut c = t.chars();
    c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
}

/// Model text to blocks: "- " lines become bullets, other lines paragraphs.
pub fn blocks_from_text(text: &str) -> Vec<Block> {
    let mut out = Vec::new();
    let mut bullets: Vec<String> = Vec::new();
    for raw in text.lines() {
        let line = raw.trim();
        let bullet = line.strip_prefix("- ").or_else(|| line.strip_prefix("• ")).or_else(|| line.strip_prefix("* "));
        match bullet {
            Some(b) => bullets.push(b.trim().to_string()),
            None => {
                if !bullets.is_empty() {
                    out.push(Block::Bullets(std::mem::take(&mut bullets)));
                }
                if is_heading(line) {
                    out.push(Block::Label(title_case(line)));
                } else if !line.is_empty() {
                    out.push(Block::Para(line.to_string()));
                }
            }
        }
    }
    if !bullets.is_empty() {
        out.push(Block::Bullets(bullets));
    }
    out
}

fn session_line(m: &MeetingDetail) -> Option<String> {
    let mt = &m.meeting;
    match mt.session_type.as_str() {
        "class" => Some(format!(
            "Session: Class{}{}",
            mt.course_name.as_ref().map(|c| format!(" · {c}")).unwrap_or_default(),
            mt.week.map(|w| format!(" · Week {w}")).unwrap_or_default()
        )),
        "work" => Some("Session: Work".into()),
        _ => None,
    }
}

fn usable(a: &&AiMessage) -> bool {
    a.status == "done" && !crate::prompts::is_no_answer(&a.response) && !a.response.trim().is_empty()
}

fn ai_section(heading: &str, items: &[&AiMessage], asked_label: &str) -> Option<Section> {
    if items.is_empty() {
        return None;
    }
    let mut blocks = Vec::new();
    for a in items {
        if let Some(q) = a.question.as_ref().filter(|q| !q.trim().is_empty()) {
            blocks.push(Block::Quote(format!("{asked_label}{}", q.trim())));
        }
        blocks.extend(blocks_from_text(&a.response));
    }
    Some(Section { heading: heading.into(), blocks })
}

fn reference_label(r: &SourceRef) -> String {
    match &r.url {
        Some(u) => format!("{} ({u})", r.label),
        None => r.label.clone(),
    }
}

/// The study-notes document for a saved meeting.
pub fn meeting_doc(m: &MeetingDetail) -> Doc {
    let mut meta = Vec::new();
    if m.meeting.is_demo {
        meta.push("DEMO DATA: not a real meeting.".to_string());
    }
    meta.extend(session_line(m));
    meta.push(format!("Started: {}", fmt_ts(m.meeting.started_at)));
    if let Some(end) = m.meeting.ended_at {
        meta.push(format!("Ended: {}", fmt_ts(end)));
    }
    meta.push("Exported from Kinviva".into());

    let by = |action: &str| m.ai_messages.iter().filter(|a| a.action == action).filter(usable).collect::<Vec<_>>();
    let mut sections = Vec::new();
    sections.extend(ai_section("Scripts you can say", &by("suggest"), "They asked: "));
    sections.extend(ai_section("Key points", &by("explain"), "They said: "));
    sections.extend(ai_section("Answers to your questions", &by("ask"), "You asked: "));
    sections.extend(ai_section("Recap", &by("recap"), ""));

    // References: every file (with page) and web page behind a saved answer, once each.
    let mut seen = std::collections::HashSet::new();
    let refs: Vec<String> = m
        .ai_messages
        .iter()
        .filter(usable)
        .flat_map(|a| a.sources.iter())
        .map(reference_label)
        .filter(|l| seen.insert(l.clone()))
        .collect();
    sections.push(Section {
        heading: "References".into(),
        blocks: if refs.is_empty() {
            vec![Block::Small("No files or web pages were used for these answers.".into())]
        } else {
            vec![Block::Bullets(refs)]
        },
    });
    if !m.notes.trim().is_empty() {
        sections.push(Section { heading: "Your notes".into(), blocks: blocks_from_text(m.notes.trim()) });
    }
    let mut transcript: Vec<Block> = m
        .segments
        .iter()
        .map(|s| Block::Para(format!("{} [{}] {}", s.source.speaker_label(), fmt_offset(s.start_ms), s.text)))
        .collect();
    if transcript.is_empty() {
        transcript.push(Block::Small("No transcript was captured.".into()));
    }
    sections.push(Section { heading: "Full transcript".into(), blocks: transcript });
    Doc { title: m.meeting.title.clone(), meta, sections }
}

fn category_label(c: &str) -> &str {
    match c {
        "cloud_devops" => "Cloud / DevOps",
        "system_design" => "System design",
        "ai_engineering" => "AI engineering",
        "coding" => "Coding",
        other => other,
    }
}

fn role_label(r: &str) -> &str {
    match r {
        "cloud_devops_engineer" => "Cloud / DevOps engineer",
        "backend_engineer" => "Backend engineer",
        "ai_engineer" => "AI engineer",
        "software_engineer" => "Software engineer",
        other => other,
    }
}

fn strings(v: &serde_json::Value, key: &str) -> Vec<String> {
    v.get(key).and_then(|x| x.as_array()).map(|a| a.iter().filter_map(|s| s.as_str().map(String::from)).collect()).unwrap_or_default()
}

fn text_of(v: &serde_json::Value, key: &str) -> String {
    v.get(key).and_then(|x| x.as_str()).unwrap_or("").trim().to_string()
}

fn labelled(blocks: &mut Vec<Block>, label: &str, text: &str) {
    if !text.is_empty() {
        blocks.push(Block::Label(label.into()));
        blocks.extend(blocks_from_text(text));
    }
}

/// The study-notes document for saved interview practice.
pub fn interview_doc(entries: &[InterviewEntry]) -> Doc {
    let mut meta = vec![format!("{} saved answer{}", entries.len(), if entries.len() == 1 { "" } else { "s" })];
    if let (Some(a), Some(b)) = (entries.first(), entries.last()) {
        meta.push(format!("From {} to {}", fmt_ts(a.created_at), fmt_ts(b.created_at)));
    }
    meta.push("Generated coaching, not verified facts. Scores are coaching feedback, not a hiring assessment.".into());
    meta.push("Exported from Kinviva".into());
    let mut sections = Vec::new();
    for (i, e) in entries.iter().enumerate() {
        let mut blocks = vec![Block::Small(
            [
                Some(category_label(&e.category).to_string()),
                e.role.as_deref().map(|r| role_label(r).to_string()),
                e.language.as_deref().map(|l| format!("Answer language: {l}")),
                Some(if e.mode == "practice" { "Practice: your answer reviewed".to_string() } else { "Explained answer".to_string() }),
            ]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(" · "),
        )];
        blocks.push(Block::Quote(e.question.trim().to_string()));
        if let Some(a) = e.answer.as_ref().filter(|a| !a.trim().is_empty()) {
            labelled(&mut blocks, "Your answer", a);
        }
        match serde_json::from_str::<serde_json::Value>(&e.result) {
            Ok(v) if v.get("kind").and_then(|k| k.as_str()) == Some("answer") => {
                labelled(&mut blocks, "Say it", &text_of(&v, "say_it"));
                labelled(&mut blocks, "Understand it", &text_of(&v, "understand_it"));
                if let Some(code) = Some(text_of(&v, "code")).filter(|c| !c.is_empty()) {
                    blocks.push(Block::Label("Code".into()));
                    blocks.push(Block::Code(code));
                }
                let t = strings(&v, "tradeoffs");
                if !t.is_empty() {
                    blocks.push(Block::Label("Tradeoffs and assumptions".into()));
                    blocks.push(Block::Bullets(t));
                }
                let w = strings(&v, "hard_words");
                if !w.is_empty() {
                    blocks.push(Block::Label("Hard words, made simple".into()));
                    blocks.push(Block::Bullets(w));
                }
                labelled(&mut blocks, "Likely follow-up question", &text_of(&v, "follow_up"));
            }
            Ok(v) if v.get("kind").and_then(|k| k.as_str()) == Some("feedback") => {
                let score = v.get("coaching_score").and_then(|s| s.as_u64());
                blocks.push(Block::Small(format!(
                    "Coaching feedback{}. Not a calibrated hiring assessment.",
                    score.map(|s| format!(" · practice score {s}/10")).unwrap_or_default()
                )));
                labelled(&mut blocks, "Correctness", &text_of(&v, "correctness"));
                let m = strings(&v, "missing_points");
                if !m.is_empty() {
                    blocks.push(Block::Label("Missing points".into()));
                    blocks.push(Block::Bullets(m));
                }
                labelled(&mut blocks, "Structure", &text_of(&v, "structure"));
                labelled(&mut blocks, "Clarity", &text_of(&v, "clarity"));
                labelled(&mut blocks, "A stronger way to say it", &text_of(&v, "improved_say_it"));
                labelled(&mut blocks, "Likely follow-up question", &text_of(&v, "follow_up"));
            }
            // A model that did not follow the format: keep its plain text.
            _ => labelled(&mut blocks, "Answer (plain text)", e.result.trim()),
        }
        sections.push(Section { heading: format!("{}. {}", i + 1, clip(&e.question, 70)), blocks });
    }
    if sections.is_empty() {
        sections.push(Section { heading: "Nothing saved yet".into(), blocks: vec![Block::Small("Answers you explain or practise are saved here automatically.".into())] });
    }
    Doc { title: "Interview practice notes".into(), meta, sections }
}

fn clip(s: &str, n: usize) -> String {
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if s.chars().count() <= n { s } else { format!("{}…", s.chars().take(n).collect::<String>().trim_end()) }
}

// ---- renderers ---------------------------------------------------------------

pub fn render_markdown(d: &Doc) -> String {
    let mut out = format!("# {}\n\n", d.title);
    for m in &d.meta {
        out.push_str(&format!("- {m}\n"));
    }
    out.push('\n');
    for s in &d.sections {
        out.push_str(&format!("## {}\n\n", s.heading));
        for b in &s.blocks {
            match b {
                Block::Para(t) => out.push_str(&format!("{t}\n\n")),
                Block::Bullets(v) => {
                    for i in v {
                        out.push_str(&format!("- {i}\n"));
                    }
                    out.push('\n');
                }
                Block::Quote(t) => out.push_str(&format!("> {t}\n\n")),
                Block::Label(t) => out.push_str(&format!("**{t}**\n\n")),
                Block::Code(t) => out.push_str(&format!("```\n{t}\n```\n\n")),
                Block::Small(t) => out.push_str(&format!("_{t}_\n\n")),
            }
        }
    }
    out
}

pub fn render_text(d: &Doc) -> String {
    let mut out = format!("{}\n{}\n", d.title, "=".repeat(d.title.chars().count().max(3)));
    for m in &d.meta {
        out.push_str(&format!("{m}\n"));
    }
    for s in &d.sections {
        out.push_str(&format!("\n{}\n{}\n", s.heading.to_uppercase(), "-".repeat(s.heading.chars().count().max(3))));
        for b in &s.blocks {
            match b {
                Block::Para(t) | Block::Small(t) => out.push_str(&format!("{t}\n")),
                Block::Bullets(v) => {
                    for i in v {
                        out.push_str(&format!("  * {i}\n"));
                    }
                }
                Block::Quote(t) => out.push_str(&format!("  \"{t}\"\n")),
                Block::Label(t) => out.push_str(&format!("\n{t}:\n")),
                Block::Code(t) => {
                    for l in t.lines() {
                        out.push_str(&format!("    {l}\n"));
                    }
                }
            }
        }
    }
    out
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// One paragraph: `size` in half-points, optional bold/italic, left indent in twips, optional font.
fn para(text: &str, size: u32, bold: bool, italic: bool, indent: u32, font: Option<&str>, space_after: u32) -> String {
    let mut rpr = String::new();
    if let Some(f) = font {
        rpr.push_str(&format!("<w:rFonts w:ascii=\"{f}\" w:hAnsi=\"{f}\"/>"));
    }
    if bold {
        rpr.push_str("<w:b/>");
    }
    if italic {
        rpr.push_str("<w:i/>");
    }
    rpr.push_str(&format!("<w:sz w:val=\"{size}\"/>"));
    let runs = text
        .split('\n')
        .map(|l| format!("<w:t xml:space=\"preserve\">{}</w:t>", esc(l)))
        .collect::<Vec<_>>()
        .join("<w:br/>");
    format!("<w:p><w:pPr><w:spacing w:after=\"{space_after}\"/><w:ind w:left=\"{indent}\"/></w:pPr><w:r><w:rPr>{rpr}</w:rPr>{runs}</w:r></w:p>")
}

/// A small, valid Word document (no styles part): headings, paragraphs, bullets, quotes, code.
pub fn render_docx(d: &Doc) -> Result<Vec<u8>, String> {
    let mut body = para(&d.title, 40, true, false, 0, None, 120);
    for m in &d.meta {
        body.push_str(&para(m, 20, false, true, 0, None, 40));
    }
    for s in &d.sections {
        body.push_str(&para(&s.heading, 30, true, false, 0, None, 100));
        for b in &s.blocks {
            match b {
                Block::Para(t) => body.push_str(&para(t, 22, false, false, 0, None, 100)),
                Block::Bullets(v) => v.iter().for_each(|i| body.push_str(&para(&format!("\u{2022} {i}"), 22, false, false, 360, None, 60))),
                Block::Quote(t) => body.push_str(&para(t, 22, false, true, 360, None, 100)),
                Block::Label(t) => body.push_str(&para(t, 22, true, false, 0, None, 40)),
                Block::Code(t) => body.push_str(&para(t, 20, false, false, 360, Some("Courier New"), 100)),
                Block::Small(t) => body.push_str(&para(t, 20, false, true, 0, None, 100)),
            }
        }
    }
    let document = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>{body}<w:sectPr><w:pgSz w:w=\"12240\" w:h=\"15840\"/><w:pgMar w:top=\"1200\" w:right=\"1200\" w:bottom=\"1200\" w:left=\"1200\"/></w:sectPr></w:body></w:document>"
    );
    let types = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>";
    let rels = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>";
    let mut buf = std::io::Cursor::new(Vec::new());
    {
        let mut z = zip::ZipWriter::new(&mut buf);
        let opts = zip::write::SimpleFileOptions::default();
        for (name, data) in [("[Content_Types].xml", types.to_string()), ("_rels/.rels", rels.to_string()), ("word/document.xml", document)] {
            z.start_file(name, opts).map_err(|e| e.to_string())?;
            z.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        }
        z.finish().map_err(|e| e.to_string())?;
    }
    Ok(buf.into_inner())
}

/// Bytes of the file for `format` ("md", "txt" or "docx").
pub fn render(d: &Doc, format: &str) -> Result<Vec<u8>, String> {
    match format {
        "md" => Ok(render_markdown(d).into_bytes()),
        "txt" => Ok(render_text(d).into_bytes()),
        "docx" => render_docx(d),
        other => Err(format!("Unknown export format \"{other}\".")),
    }
}

// Kept for callers and tests that want the meeting directly.
pub fn to_markdown(m: &MeetingDetail) -> String {
    render_markdown(&meeting_doc(m))
}

pub fn to_text(m: &MeetingDetail) -> String {
    render_text(&meeting_doc(m))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::Source;
    use crate::db::Db;

    fn sample() -> MeetingDetail {
        let db = Db::open_in_memory().unwrap();
        db.create_meeting("m", "Operating Systems week 3", 1_700_000_000_000, false).unwrap();
        db.create_course("c", "Operating Systems", "CS350", "").unwrap();
        db.set_meeting_session("m", "class", Some("c"), Some(3)).unwrap();
        db.add_segment("m", Source::System, "How does round robin scheduling work?", 65_000, 67_000).unwrap();
        db.add_segment("m", Source::Mic, "Next Friday.", 68_000, 69_000).unwrap();
        db.set_notes("m", "Read chapter 5\n- bring laptop").unwrap();
        db.add_ai_message("a", Some("m"), "suggest", Some("How does round robin scheduling work?"), "Answer:\n- Each process gets a time quantum [week3.pdf, p. 4]\n- Preempted processes rejoin the queue", "gemini", "done").unwrap();
        db.set_ai_message_sources("a", &[SourceRef { label: "week3.pdf, p. 4".into(), url: None }, SourceRef { label: "OS notes".into(), url: Some("https://example.edu/os".into()) }]).unwrap();
        db.add_ai_message("e", Some("m"), "explain", Some("Quantum is the time slice"), "Key points:\n- A quantum is the time slice", "gemini", "done").unwrap();
        db.add_ai_message("n", Some("m"), "suggest", Some("Thanks everyone"), "NO_ANSWER", "gemini", "done").unwrap();
        db.add_ai_message("b", Some("m"), "explain", None, "partial junk", "gemini", "cancelled").unwrap();
        db.end_meeting("m", 1_700_000_100_000).unwrap();
        db.get_meeting("m").unwrap()
    }

    #[test]
    fn meeting_notes_lead_with_scripts_key_points_and_references() {
        let md = to_markdown(&sample());
        assert!(md.starts_with("# Operating Systems week 3\n"));
        assert!(md.contains("- Session: Class · Operating Systems · Week 3"));
        let scripts = md.find("## Scripts you can say").unwrap();
        let points = md.find("## Key points").unwrap();
        let refs = md.find("## References").unwrap();
        let transcript = md.find("## Full transcript").unwrap();
        assert!(scripts < points && points < refs && refs < transcript);
        assert!(md.contains("> They asked: How does round robin scheduling work?"));
        assert!(md.contains("- Each process gets a time quantum [week3.pdf, p. 4]"));
        assert!(md.contains("- week3.pdf, p. 4\n"));
        assert!(md.contains("- OS notes (https://example.edu/os)"));
        assert!(md.contains("## Your notes\n\nRead chapter 5\n\n- bring laptop"));
        assert!(md.contains("Them [01:05] How does round robin scheduling work?"));
        assert!(!md.contains("partial junk"), "cancelled answers are left out");
        assert!(!md.contains("NO_ANSWER") && !md.contains("Thanks everyone"), "no-answer markers are left out");
    }

    #[test]
    fn a_meeting_without_references_says_so() {
        let db = Db::open_in_memory().unwrap();
        db.create_meeting("m", "Chat", 1, false).unwrap();
        db.add_ai_message("a", Some("m"), "suggest", None, "Answer:\n- Yes", "x", "done").unwrap();
        let md = to_markdown(&db.get_meeting("m").unwrap());
        assert!(md.contains("No files or web pages were used"));
        assert!(!md.contains("Session:"), "general sessions have no session line");
    }

    #[test]
    fn text_export_is_plain() {
        let t = to_text(&sample());
        assert!(t.contains("SCRIPTS YOU CAN SAY"));
        assert!(t.contains("  * Each process gets a time quantum"));
        assert!(t.contains("Them [01:05] How does round robin scheduling work?"));
        assert!(!t.contains("**") && !t.contains("```"));
    }

    #[test]
    fn docx_is_a_valid_zip_that_our_own_reader_can_open() {
        let bytes = render(&meeting_doc(&sample()), "docx").unwrap();
        let path = tempfile::tempdir().unwrap().keep().join("notes.docx");
        std::fs::write(&path, &bytes).unwrap();
        let x = crate::docs::extract(&path).unwrap();
        assert_eq!(x.kind, "docx");
        assert!(x.text.contains("Scripts you can say"));
        assert!(x.text.contains("Each process gets a time quantum [week3.pdf, p. 4]"));
        assert!(x.text.contains("References"));
        assert!(render(&meeting_doc(&sample()), "pdf").is_err());
    }

    #[test]
    fn xml_in_text_is_escaped_in_docx() {
        let d = Doc { title: "A & B <c>".into(), meta: vec![], sections: vec![Section { heading: "h".into(), blocks: vec![Block::Code("if (a < b && c > d) {\n}".into())] }] };
        let bytes = render_docx(&d).unwrap();
        let path = tempfile::tempdir().unwrap().keep().join("x.docx");
        std::fs::write(&path, bytes).unwrap();
        let x = crate::docs::extract(&path).unwrap();
        assert!(x.text.contains("A & B <c>") && x.text.contains("if (a < b && c > d) {"));
    }

    fn entry(mode: &str, result: &str, answer: Option<&str>) -> InterviewEntry {
        InterviewEntry {
            id: "i".into(),
            created_at: 1_700_000_000_000,
            category: "coding".into(),
            role: Some("software_engineer".into()),
            mode: mode.into(),
            language: Some("python".into()),
            question: "Find two numbers that add up to a target.".into(),
            answer: answer.map(String::from),
            result: result.into(),
        }
    }

    #[test]
    fn interview_notes_include_the_four_parts_code_and_feedback() {
        let answer = r#"{"kind":"answer","say_it":"Use a hash map.","understand_it":"Single pass.","code":"def f():\n    pass","tradeoffs":["Tradeoff: memory"],"follow_up":"What if sorted?"}"#;
        let feedback = r#"{"kind":"feedback","correctness":"Mostly right.","missing_points":["edge cases"],"structure":"ok","clarity":"clear","coaching_score":7,"improved_say_it":"Better.","follow_up":"q"}"#;
        let doc = interview_doc(&[entry("explain", answer, None), entry("practice", feedback, Some("I loop twice."))]);
        let md = render_markdown(&doc);
        assert!(md.contains("2 saved answers"));
        assert!(md.contains("## 1. Find two numbers that add up to a target."));
        assert!(md.contains("**Say it**\n\nUse a hash map."));
        assert!(md.contains("```\ndef f():\n    pass\n```"));
        assert!(md.contains("- Tradeoff: memory"));
        assert!(md.contains("**Your answer**\n\nI loop twice."));
        assert!(md.contains("practice score 7/10. Not a calibrated hiring assessment."));
        assert!(md.contains("- edge cases"));
        assert!(md.contains("Coding · Software engineer · Answer language: python"));
    }

    #[test]
    fn interview_notes_keep_plain_text_when_the_model_broke_format() {
        let md = render_markdown(&interview_doc(&[entry("explain", "Just use a dict.", None)]));
        assert!(md.contains("**Answer (plain text)**\n\nJust use a dict."));
        assert!(render_markdown(&interview_doc(&[])).contains("Nothing saved yet"));
    }

    #[test]
    fn answer_headings_become_labels_in_the_notes() {
        let b = blocks_from_text("YOU COULD SAY\nUse a queue to absorb bursts.\n\nKEY TAKEAWAY\nQueues decouple load.\n\nSOURCES\n- week3.pdf, p. 4");
        assert_eq!(b[0], Block::Label("You could say".into()));
        assert_eq!(b[2], Block::Label("Key takeaway".into()));
        assert_eq!(b[4], Block::Label("Sources".into()));
        assert_eq!(b[5], Block::Bullets(vec!["week3.pdf, p. 4".into()]));
    }
}
