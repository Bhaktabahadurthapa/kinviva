//! Meeting session types. A session type decides which documents answers may
//! use and which extra instructions the model gets. Instructions live here,
//! apart from the application rules (`prompts::BASE`) and from the Interview
//! skills (`skills.rs`), so one cannot leak into the other.
//!
//! * Class   : answers combine the model's expertise with the chosen course's saved resources, citing the resource parts.
//! * Work    : currently behaves like General (no extra instructions yet).
//! * General : the original behaviour (the general library, no extra instructions).

use crate::db::{Passage, Scope};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum SessionKind {
    Class,
    Work,
    #[default]
    General,
}

impl SessionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            SessionKind::Class => "class",
            SessionKind::Work => "work",
            SessionKind::General => "general",
        }
    }
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
pub struct SessionInfo {
    pub kind: SessionKind,
    pub course_id: Option<String>,
    pub course_name: Option<String>,
    pub week: Option<i64>,
}

pub const MAX_WEEK: i64 = 60;

impl SessionInfo {
    pub fn is_class(&self) -> bool {
        self.kind == SessionKind::Class && self.course_id.is_some()
    }

    /// Which documents a search may use for this session.
    pub fn scope(&self) -> Scope {
        match (&self.kind, &self.course_id) {
            (SessionKind::Class, Some(id)) => Scope::Course { id: id.clone(), week: self.week },
            _ => Scope::Library,
        }
    }

    /// Extra system instructions for this session type (separate from the base rules).
    pub fn instructions(&self) -> Option<String> {
        if !self.is_class() {
            return None;
        }
        let course = self.course_name.as_deref().unwrap_or("the course");
        let week = self.week.map(|w| format!(", week {w}")).unwrap_or_default();
        Some(format!(
            "SESSION: a university class session for \"{course}\"{week}. The user is a student. \"Them\" is usually the instructor or classmates.\n\
Source rules:\n\
- Write the best, most complete answer by combining your own expert knowledge with the student's saved course resources in <document_excerpts>. Never limit the answer to the excerpts, and never refuse because the excerpts are thin.\n\
- Each excerpt is labelled [S1], [S2], ... (file and page). When a sentence uses an excerpt's definitions, examples, numbers or terminology, put its label right after that sentence. Use only labels that exist; never invent a label, file name or page. The app checks every label and removes any that is not a real retrieved excerpt.\n\
- Points from your own knowledge carry no label. Use the course's terms where the excerpts give them. If an excerpt disagrees with what is generally taught, follow the excerpt and say so briefly.\n\
- If no excerpt answers the question, answer from your own knowledge and say so in one short clause. If excerpts conflict, say so briefly.\n\
- Never copy an excerpt's sentences; explain the idea in your own words, in simple language.\n\
- When you explain what the instructor said, add one bullet \"Course link:\" saying in your own words how it connects to an excerpt, with its label. Leave it out if none matches."
        ))
    }
}

/// Short citation text for a passage: "notes.pdf, p. 4" or "notes.md, part 2".
pub fn citation_text(p: &Passage) -> String {
    match p.page {
        Some(page) => format!("{}, p. {}", p.document, page),
        None => format!("{}, part {}", p.document, p.chunk + 1),
    }
}

/// How a finished answer shows its sources.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CiteStyle {
    /// Markers become "[file, p. 4]" inside the text (used for short explanations).
    Inline,
    /// Markers are removed from the text and a SOURCES section lists only valid ones.
    /// `complete` is false while the answer is still streaming (no section yet).
    Section { complete: bool },
}

#[derive(Debug, Clone, PartialEq)]
pub struct Normalized {
    pub text: String,
    /// 0-based indexes into the retrieved sources that the answer really cited.
    pub cited: Vec<usize>,
}

/// A bracket group such as "[S2]" or "[S1, S3]" holding only source markers.
fn marker_group(inner: &str) -> Option<Vec<usize>> {
    let mut ids = Vec::new();
    for tok in inner.split(|c: char| c == ',' || c == ';' || c.is_whitespace()).filter(|t| !t.is_empty()) {
        let n = tok.strip_prefix('S')?;
        if n.is_empty() || !n.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        ids.push(n.parse::<usize>().ok()?);
    }
    (!ids.is_empty()).then_some(ids)
}

/// Removes every source marker from `text` and returns the marker numbers (1-based) in order.
fn take_markers(text: &str) -> (String, Vec<usize>) {
    let mut out = String::with_capacity(text.len());
    let mut found = Vec::new();
    let mut rest = text;
    while let Some(i) = rest.find('[') {
        out.push_str(&rest[..i]);
        match rest[i..].find(']').map(|e| i + e) {
            Some(end) => match marker_group(&rest[i + 1..end]) {
                Some(ids) => {
                    found.extend(ids);
                    // Drop the space before the marker so "word [S1]." becomes "word."
                    let after = rest[end + 1..].chars().next();
                    if out.ends_with(' ') && after.is_none_or(|c| c.is_whitespace() || ".,;:!?)".contains(c)) {
                        out.pop();
                    }
                }
                None => out.push_str(&rest[i..=end]),
            },
            None => {
                out.push_str(&rest[i..]);
                return (out, found);
            }
        }
        rest = match rest[i..].find(']') {
            Some(e) => &rest[i + e + 1..],
            None => "",
        };
    }
    out.push_str(rest);
    (out, found)
}

fn is_sources_header(line: &str) -> bool {
    line.trim().trim_matches('*').trim_end_matches(':').trim().eq_ignore_ascii_case("sources")
}

/// Makes an answer safe to show. Only citations that match retrieved sources
/// (`labels`, in the order they were given to the model) are ever displayed;
/// any other marker is dropped, so an invented citation or page cannot appear.
pub fn normalize_answer(text: &str, labels: &[String], style: CiteStyle) -> Normalized {
    let valid = |n: usize| n >= 1 && n <= labels.len();
    if style == CiteStyle::Inline {
        let (mut out, mut cited) = (String::new(), Vec::new());
        let mut rest = text;
        while let Some(i) = rest.find('[') {
            out.push_str(&rest[..i]);
            let end = rest[i..].find(']').map(|e| i + e);
            match end.and_then(|e| marker_group(&rest[i + 1..e]).map(|ids| (e, ids))) {
                Some((e, ids)) => {
                    let names: Vec<&str> = ids.iter().filter(|&&n| valid(n)).map(|&n| labels[n - 1].as_str()).collect();
                    cited.extend(ids.iter().filter(|&&n| valid(n)).map(|n| n - 1));
                    if !names.is_empty() {
                        out.push_str(&format!("[{}]", names.join("; ")));
                    } else if out.ends_with(' ') {
                        out.pop();
                    }
                    rest = &rest[e + 1..];
                }
                None => {
                    out.push('[');
                    rest = &rest[i + 1..];
                }
            }
        }
        out.push_str(rest);
        cited.dedup();
        return Normalized { text: out, cited };
    }
    let complete = matches!(style, CiteStyle::Section { complete: true });
    let lines: Vec<&str> = text.lines().collect();
    let split = lines.iter().position(|l| is_sources_header(l));
    let (body_lines, source_lines) = match split {
        Some(p) => (&lines[..p], &lines[p + 1..]),
        None => (&lines[..], &[][..]),
    };
    let (body, mut ids) = take_markers(&body_lines.join("\n"));
    let mut general: Vec<String> = Vec::new();
    for l in source_lines {
        let (clean, found) = take_markers(l);
        ids.extend(found);
        let t = clean.trim().trim_start_matches(['-', '*', '•']).trim();
        if t.to_lowercase().starts_with("general knowledge") {
            general.push(t.chars().take(200).collect());
        }
    }
    let mut cited: Vec<usize> = Vec::new();
    for n in ids.into_iter().filter(|&n| valid(n)) {
        if !cited.contains(&(n - 1)) {
            cited.push(n - 1);
        }
    }
    let body = body.trim_end().to_string();
    if split.is_none() && !complete {
        return Normalized { text: body, cited };
    }
    let mut out = body;
    out.push_str("\n\nSOURCES\n");
    if cited.is_empty() && general.is_empty() {
        out.push_str(if labels.is_empty() { "General knowledge. No document was provided." } else { "General knowledge. The provided documents were not used." });
    } else {
        let mut lines: Vec<String> = cited.iter().map(|&k| format!("- {}", labels[k])).collect();
        lines.extend(general.iter().map(|g| format!("- {g}")));
        out.push_str(&lines.join("\n"));
    }
    Normalized { text: out, cited }
}

/// Labels for the sources given to the model: your files first, then web results.
pub fn source_labels(passages: &[Passage], web: &[crate::db::SourceRef]) -> Vec<String> {
    passages.iter().map(citation_text).chain(web.iter().map(|w| w.label.clone())).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(doc: &str, chunk: i64, page: Option<i64>) -> Passage {
        Passage { document: doc.into(), chunk, text: "t".into(), page, week: None }
    }

    fn class() -> SessionInfo {
        SessionInfo { kind: SessionKind::Class, course_id: Some("c1".into()), course_name: Some("Operating Systems".into()), week: Some(3) }
    }

    #[test]
    fn only_class_sessions_get_instructions_and_course_scope() {
        let i = class().instructions().unwrap();
        assert!(i.contains("Operating Systems") && i.contains("week 3") && i.contains("[S1]"));
        assert!(i.contains("own expert knowledge") && i.contains("Never limit the answer to the excerpts"));
        assert!(i.contains("carry no label"));
        assert_eq!(class().scope(), Scope::Course { id: "c1".into(), week: Some(3) });
        for kind in [SessionKind::Work, SessionKind::General] {
            let s = SessionInfo { kind, course_id: Some("c1".into()), ..Default::default() };
            assert_eq!(s.instructions(), None);
            assert_eq!(s.scope(), Scope::Library, "{kind:?} must not read course files");
        }
        // A class session without a course falls back to the library rather than failing.
        let no_course = SessionInfo { kind: SessionKind::Class, ..Default::default() };
        assert_eq!(no_course.scope(), Scope::Library);
        assert_eq!(no_course.instructions(), None);
    }

    #[test]
    fn kind_round_trips_and_rejects_unknown_values() {
        assert_eq!(serde_json::from_str::<SessionKind>("\"class\"").unwrap(), SessionKind::Class);
        assert!(serde_json::from_str::<SessionKind>("\"exam\"").is_err());
        assert_eq!(SessionKind::default(), SessionKind::General);
    }

    fn labels() -> Vec<String> {
        vec!["week3.pdf, p. 4".into(), "notes.md, part 2".into()]
    }

    #[test]
    fn answers_list_only_real_sources_in_a_sources_section() {
        let text = "Round robin gives each process a time slice [S1]. It prevents starvation [S2, S1].\n\nKEY TAKEAWAY\nShort slices share the CPU fairly.\n\nSOURCES\n- [S2]\n- General knowledge: typical quantum sizes";
        let n = normalize_answer(text, &labels(), CiteStyle::Section { complete: true });
        assert!(!n.text.contains("[S"), "inline markers are removed from the spoken text: {}", n.text);
        assert!(n.text.contains("time slice. It prevents starvation."));
        assert!(n.text.ends_with("SOURCES\n- week3.pdf, p. 4\n- notes.md, part 2\n- General knowledge: typical quantum sizes"));
        assert_eq!(n.cited, vec![0, 1]);
    }

    #[test]
    fn invented_citations_never_reach_the_screen() {
        let text = "A claim [S9] and another [S0] and [S3].\n\nSOURCES\n- [S7] fake.pdf, p. 99\n- Textbook p. 12";
        let n = normalize_answer(text, &labels(), CiteStyle::Section { complete: true });
        assert!(!n.text.contains("S9") && !n.text.contains("fake.pdf") && !n.text.contains("p. 99") && !n.text.contains("Textbook"));
        assert!(n.text.ends_with("SOURCES\nGeneral knowledge. The provided documents were not used."));
        assert!(n.cited.is_empty());
        // With no documents at all the wording says so.
        let none = normalize_answer("Answer [S1].", &[], CiteStyle::Section { complete: true });
        assert!(none.text.ends_with("General knowledge. No document was provided."));
    }

    #[test]
    fn a_missing_sources_section_is_added_when_complete_but_not_while_streaming() {
        let streaming = normalize_answer("Part one [S1]", &labels(), CiteStyle::Section { complete: false });
        assert_eq!(streaming.text, "Part one");
        let done = normalize_answer("Part one [S1]", &labels(), CiteStyle::Section { complete: true });
        assert_eq!(done.text, "Part one\n\nSOURCES\n- week3.pdf, p. 4");
        let mid = normalize_answer("Text\n\nSOURCES\n- [S2]", &labels(), CiteStyle::Section { complete: false });
        assert!(mid.text.ends_with("SOURCES\n- notes.md, part 2"));
    }

    #[test]
    fn inline_style_resolves_markers_and_drops_invalid_ones() {
        let n = normalize_answer("Paging maps pages [S1]. More [S2]. Odd [S9] ok.", &labels(), CiteStyle::Inline);
        assert_eq!(n.text, "Paging maps pages [week3.pdf, p. 4]. More [notes.md, part 2]. Odd ok.");
        assert_eq!(n.cited, vec![0, 1]);
        assert_eq!(normalize_answer("array[S] and [Sx] and [1]", &labels(), CiteStyle::Inline).text, "array[S] and [Sx] and [1]");
    }

    #[test]
    fn source_labels_put_files_before_web_results() {
        let ps = vec![p("a.pdf", 0, Some(2))];
        let web = vec![crate::db::SourceRef { label: "Site (example.com)".into(), url: Some("https://example.com".into()) }];
        assert_eq!(source_labels(&ps, &web), vec!["a.pdf, p. 2", "Site (example.com)"]);
    }
}
