//! Meeting session types. A session type decides which documents answers may
//! use and which extra instructions the model gets. Instructions live here,
//! apart from the application rules (`prompts::BASE`) and from the Interview
//! skills (`skills.rs`), so one cannot leak into the other.
//!
//! * Class   : answers use only the chosen course's saved resources and cite them.
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
- <document_excerpts> hold the student's saved course resources. Each is labelled [S1], [S2], ... with its file and page.\n\
- Use the excerpts as the primary source. After every sentence or bullet that relies on an excerpt, add its label, for example [S2]. Use only labels that exist; never invent a label, file name or page.\n\
- If the excerpts do not cover the question, say \"Not found in your course resources.\" first, then you may add a short answer from general knowledge under the line \"General knowledge (not from your resources):\". Never cite for general knowledge.\n\
- Do not put quotation marks around text unless it is copied exactly from an excerpt.\n\
- When you explain what the instructor said, add one bullet \"In your resources:\" with the matching excerpt and its label if one exists; leave it out if none matches."
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

/// Replaces [S1], [S2] ... markers with the real file and page. A marker that
/// points at no retrieved passage becomes "[unverified source]" instead of
/// passing off an invented citation.
pub fn resolve_citations(text: &str, passages: &[Passage]) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(i) = rest.find("[S") {
        out.push_str(&rest[..i]);
        let tail = &rest[i + 2..];
        let digits: String = tail.chars().take_while(|c| c.is_ascii_digit()).collect();
        if !digits.is_empty() && tail[digits.len()..].starts_with(']') {
            let n: usize = digits.parse().unwrap_or(0);
            match n.checked_sub(1).and_then(|k| passages.get(k)) {
                Some(p) => out.push_str(&format!("[{}]", citation_text(p))),
                None => out.push_str("[unverified source]"),
            }
            rest = &tail[digits.len() + 1..];
        } else {
            out.push_str("[S");
            rest = tail;
        }
    }
    out.push_str(rest);
    out
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
        assert!(i.contains("Not found in your course resources"));
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

    #[test]
    fn citations_resolve_to_file_and_page() {
        let ps = vec![p("week3.pdf", 0, Some(4)), p("notes.md", 1, None)];
        assert_eq!(resolve_citations("Paging maps pages [S1]. Also [S2].", &ps), "Paging maps pages [week3.pdf, p. 4]. Also [notes.md, part 2].");
        assert_eq!(resolve_citations("No marker here, array[S] and [Sx] stay.", &ps), "No marker here, array[S] and [Sx] stay.");
    }

    #[test]
    fn invented_citations_are_marked_unverified() {
        let ps = vec![p("a.pdf", 0, Some(1))];
        assert_eq!(resolve_citations("Claim [S2] and [S0] and [S99].", &ps), "Claim [unverified source] and [unverified source] and [unverified source].");
        assert_eq!(resolve_citations("Claim [S1]", &[]), "Claim [unverified source]");
    }
}
