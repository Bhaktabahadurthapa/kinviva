//! Local records for the platform screens: notes, whiteboards, charts, incidents
//! (one generic `records` table), learning items, quiz attempts, plus the
//! numbers shown on the Dashboard and the global search.

use crate::db::Db;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

type R<T> = Result<T, String>;
fn e(x: rusqlite::Error) -> String {
    x.to_string()
}

pub const KINDS: &[&str] = &["note", "board", "board_rev", "chart", "incident"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Record {
    pub id: String,
    pub kind: String,
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub meta: Option<String>,
    #[serde(default)]
    pub meeting_id: Option<String>,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LearningItem {
    pub id: String,
    /// goal | lesson | drill | resource
    pub kind: String,
    pub title: String,
    /// todo | doing | done
    #[serde(default = "todo")]
    pub status: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub detail: Option<String>,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
    #[serde(default)]
    pub completed_at: Option<i64>,
}
fn todo() -> String {
    "todo".into()
}

#[derive(Debug, Clone, Serialize)]
pub struct QuizStats {
    pub attempts: i64,
    pub total: i64,
    pub correct: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct TopicScore {
    pub topic: String,
    pub attempts: i64,
    pub total: i64,
    pub correct: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct RecentSession {
    pub id: String,
    pub title: String,
    pub session_type: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub segments: i64,
    pub notes: i64,
    pub diagrams: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Stats {
    pub sessions: i64,
    pub interviews: i64,
    pub notes: i64,
    pub diagrams: i64,
    pub whiteboards: i64,
    pub charts: i64,
    pub documents: i64,
    pub incidents: i64,
    pub learning_total: i64,
    pub learning_done: i64,
    pub learning_doing: i64,
    pub saved_articles: i64,
    /// Created in the last 7 days.
    pub sessions_week: i64,
    pub notes_week: i64,
    pub diagrams_week: i64,
    pub whiteboards_week: i64,
    pub recent: Vec<RecentSession>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SearchHit {
    /// session | transcript | note | whiteboard | chart | incident | diagram | document | learning | discover
    pub kind: String,
    pub id: String,
    pub title: String,
    pub snippet: String,
    pub when: i64,
}

fn snippet(text: &str, q: &str) -> String {
    let lower = text.to_lowercase();
    let at = lower.find(&q.to_lowercase()).unwrap_or(0);
    let start = text.char_indices().map(|(i, _)| i).rfind(|&i| i <= at.saturating_sub(40)).unwrap_or(0);
    let s: String = text[start..].chars().take(140).collect();
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

impl Db {
    pub fn save_record(&self, r: &Record, now: i64) -> R<Record> {
        if !KINDS.contains(&r.kind.as_str()) {
            return Err(format!("Unknown record kind \"{}\".", r.kind));
        }
        if r.title.chars().count() > 200 || r.body.len() > 8_000_000 {
            return Err("That item is too large to save.".into());
        }
        let conn = self.conn.lock().unwrap();
        let created: Option<i64> = conn.query_row("SELECT created_at FROM records WHERE id = ?1", [&r.id], |x| x.get(0)).optional().map_err(e)?;
        let created = created.unwrap_or(if r.created_at > 0 { r.created_at } else { now });
        conn.execute(
            "INSERT INTO records(id, kind, title, body, meta, meeting_id, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
             ON CONFLICT(id) DO UPDATE SET title = ?3, body = ?4, meta = ?5, meeting_id = ?6, updated_at = ?8",
            params![r.id, r.kind, r.title, r.body, r.meta, r.meeting_id, created, now],
        )
        .map_err(e)?;
        Ok(Record { created_at: created, updated_at: now, ..r.clone() })
    }

    pub fn get_record(&self, id: &str) -> R<Option<Record>> {
        self.conn
            .lock()
            .unwrap()
            .query_row("SELECT id, kind, title, body, meta, meeting_id, created_at, updated_at FROM records WHERE id = ?1", [id], row)
            .optional()
            .map_err(e)
    }

    /// Newest first. `with_body` false returns an empty body (lists of boards stay small).
    pub fn list_records(&self, kind: &str, search: Option<&str>, meeting_id: Option<&str>, with_body: bool, limit: usize) -> R<Vec<Record>> {
        let conn = self.conn.lock().unwrap();
        let pattern = search.filter(|s| !s.trim().is_empty()).map(|s| format!("%{}%", s.trim()));
        let mut stmt = conn
            .prepare(
                "SELECT id, kind, title, CASE WHEN ?5 THEN body ELSE '' END, meta, meeting_id, created_at, updated_at FROM records
                 WHERE kind = ?1 AND (?2 IS NULL OR title LIKE ?2 OR (kind IN ('note','incident') AND body LIKE ?2)) AND (?3 IS NULL OR meeting_id = ?3)
                 ORDER BY updated_at DESC LIMIT ?4",
            )
            .map_err(e)?;
        let rows = stmt.query_map(params![kind, pattern, meeting_id, limit as i64, with_body], row).map_err(e)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(e)
    }

    pub fn delete_record(&self, id: &str) -> R<()> {
        let conn = self.conn.lock().unwrap();
        // A board takes its saved revisions with it.
        conn.execute("DELETE FROM records WHERE id = ?1 OR (kind = 'board_rev' AND meta = ?1)", [id]).map(|_| ()).map_err(e)
    }

    /// Keeps only the newest `keep` revisions of a board.
    pub fn trim_revisions(&self, board_id: &str, keep: usize) -> R<()> {
        self.conn
            .lock()
            .unwrap()
            .execute(
                "DELETE FROM records WHERE kind = 'board_rev' AND meta = ?1 AND id NOT IN
                 (SELECT id FROM records WHERE kind = 'board_rev' AND meta = ?1 ORDER BY updated_at DESC LIMIT ?2)",
                params![board_id, keep as i64],
            )
            .map(|_| ())
            .map_err(e)
    }

    pub fn list_revisions(&self, board_id: &str) -> R<Vec<Record>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, kind, title, '', meta, meeting_id, created_at, updated_at FROM records WHERE kind = 'board_rev' AND meta = ?1 ORDER BY updated_at DESC")
            .map_err(e)?;
        let rows = stmt.query_map([board_id], row).map_err(e)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(e)
    }

    pub fn save_learning(&self, x: &LearningItem, now: i64) -> R<LearningItem> {
        if !["goal", "lesson", "drill", "resource"].contains(&x.kind.as_str()) || !["todo", "doing", "done"].contains(&x.status.as_str()) {
            return Err("Unknown learning item type or status.".into());
        }
        let conn = self.conn.lock().unwrap();
        let prev: Option<(i64, Option<i64>, String)> = conn
            .query_row("SELECT created_at, completed_at, status FROM learning_items WHERE id = ?1", [&x.id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .optional()
            .map_err(e)?;
        let created = prev.as_ref().map(|p| p.0).unwrap_or(now);
        // Completion time is set by the app when the status changes to done, never by the caller.
        let completed = match (x.status.as_str(), prev.as_ref()) {
            ("done", Some((_, Some(c), s))) if s == "done" => Some(*c),
            ("done", _) => Some(now),
            _ => None,
        };
        conn.execute(
            "INSERT INTO learning_items(id, kind, title, status, parent_id, source, url, detail, created_at, updated_at, completed_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
             ON CONFLICT(id) DO UPDATE SET title = ?3, status = ?4, parent_id = ?5, source = ?6, url = ?7, detail = ?8, updated_at = ?10, completed_at = ?11",
            params![x.id, x.kind, x.title, x.status, x.parent_id, x.source, x.url, x.detail, created, now, completed],
        )
        .map_err(e)?;
        Ok(LearningItem { created_at: created, updated_at: now, completed_at: completed, ..x.clone() })
    }

    pub fn list_learning(&self) -> R<Vec<LearningItem>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, kind, title, status, parent_id, source, url, detail, created_at, updated_at, completed_at FROM learning_items ORDER BY created_at")
            .map_err(e)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(LearningItem { id: r.get(0)?, kind: r.get(1)?, title: r.get(2)?, status: r.get(3)?, parent_id: r.get(4)?, source: r.get(5)?, url: r.get(6)?, detail: r.get(7)?, created_at: r.get(8)?, updated_at: r.get(9)?, completed_at: r.get(10)? })
            })
            .map_err(e)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(e)
    }

    pub fn delete_learning(&self, id: &str) -> R<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM learning_items WHERE id = ?1 OR parent_id = ?1", [id]).map(|_| ()).map_err(e)
    }

    pub fn add_quiz_attempt(&self, topic: &str, total: i64, correct: i64, now: i64) -> R<()> {
        if total <= 0 || correct < 0 || correct > total {
            return Err("A quiz result needs a positive total and a score between 0 and the total.".into());
        }
        self.conn
            .lock()
            .unwrap()
            .execute("INSERT INTO quiz_attempts(id, topic, total, correct, created_at) VALUES (?1,?2,?3,?4,?5)", params![uuid::Uuid::new_v4().to_string(), topic.chars().take(120).collect::<String>(), total, correct, now])
            .map(|_| ())
            .map_err(e)
    }

    pub fn quiz_stats(&self) -> R<QuizStats> {
        self.conn
            .lock()
            .unwrap()
            .query_row("SELECT COUNT(*), COALESCE(SUM(total),0), COALESCE(SUM(correct),0) FROM quiz_attempts", [], |r| Ok(QuizStats { attempts: r.get(0)?, total: r.get(1)?, correct: r.get(2)? }))
            .map_err(e)
    }

    /// Quiz results per topic (lowest accuracy first), used for knowledge-gap suggestions.
    pub fn quiz_topics(&self) -> R<Vec<TopicScore>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT topic, COUNT(*), SUM(total), SUM(correct) FROM quiz_attempts GROUP BY lower(topic) ORDER BY CAST(SUM(correct) AS REAL) / SUM(total)")
            .map_err(e)?;
        let rows = stmt.query_map([], |r| Ok(TopicScore { topic: r.get(0)?, attempts: r.get(1)?, total: r.get(2)?, correct: r.get(3)? })).map_err(e)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(e)
    }

    /// Every number comes from rows in this database.
    pub fn stats(&self, now: i64) -> R<Stats> {
        let since = now - 7 * 86_400_000;
        let conn = self.conn.lock().unwrap();
        let n = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap_or(0) };
        let mut stmt = conn
            .prepare(
                "SELECT m.id, m.title, m.session_type, m.started_at, m.ended_at,
                        (SELECT COUNT(*) FROM segments s WHERE s.meeting_id = m.id),
                        (SELECT COUNT(*) FROM records r WHERE r.kind = 'note' AND r.meeting_id = m.id),
                        (SELECT COUNT(*) FROM diagrams d WHERE d.meeting_id = m.id)
                 FROM meetings m WHERE m.is_demo = 0 ORDER BY m.started_at DESC LIMIT 6",
            )
            .map_err(e)?;
        let recent = stmt
            .query_map([], |r| Ok(RecentSession { id: r.get(0)?, title: r.get(1)?, session_type: r.get(2)?, started_at: r.get(3)?, ended_at: r.get(4)?, segments: r.get(5)?, notes: r.get(6)?, diagrams: r.get(7)? }))
            .map_err(e)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(e)?;
        Ok(Stats {
            sessions: n("SELECT COUNT(*) FROM meetings WHERE is_demo = 0"),
            interviews: n("SELECT COUNT(*) FROM interview_entries"),
            notes: n("SELECT COUNT(*) FROM records WHERE kind = 'note'"),
            diagrams: n("SELECT COUNT(*) FROM diagrams"),
            whiteboards: n("SELECT COUNT(*) FROM records WHERE kind = 'board'"),
            charts: n("SELECT COUNT(*) FROM records WHERE kind = 'chart'"),
            documents: n("SELECT COUNT(*) FROM documents"),
            incidents: n("SELECT COUNT(*) FROM records WHERE kind = 'incident'"),
            learning_total: n("SELECT COUNT(*) FROM learning_items WHERE kind IN ('lesson','drill')"),
            learning_done: n("SELECT COUNT(*) FROM learning_items WHERE kind IN ('lesson','drill') AND status = 'done'"),
            learning_doing: n("SELECT COUNT(*) FROM learning_items WHERE kind IN ('lesson','drill') AND status = 'doing'"),
            saved_articles: n("SELECT COUNT(*) FROM discover_items WHERE saved = 1"),
            sessions_week: n(&format!("SELECT COUNT(*) FROM meetings WHERE is_demo = 0 AND started_at >= {since}")),
            notes_week: n(&format!("SELECT COUNT(*) FROM records WHERE kind = 'note' AND created_at >= {since}")),
            diagrams_week: n(&format!("SELECT COUNT(*) FROM diagrams WHERE created_at >= {since}")),
            whiteboards_week: n(&format!("SELECT COUNT(*) FROM records WHERE kind = 'board' AND created_at >= {since}")),
            recent,
        })
    }

    /// Plain substring search over everything stored locally (and the document index).
    pub fn global_search(&self, query: &str, per_kind: usize) -> R<Vec<SearchHit>> {
        let q = query.trim();
        if q.chars().count() < 2 {
            return Ok(Vec::new());
        }
        let like = format!("%{}%", q.replace(['%', '_'], ""));
        let lim = per_kind as i64;
        let mut hits = Vec::new();
        {
            let conn = self.conn.lock().unwrap();
            let mut run = |sql: &str, kind: &str, text_col: usize| -> R<()> {
                let mut stmt = conn.prepare(sql).map_err(e)?;
                let rows = stmt
                    .query_map(params![like, lim], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?.unwrap_or_default(), r.get::<_, i64>(3)?)))
                    .map_err(e)?;
                for x in rows {
                    let (id, title, text, when) = x.map_err(e)?;
                    let _ = text_col;
                    let snip = if text.is_empty() { String::new() } else { snippet(&text, q) };
                    hits.push(SearchHit { kind: kind.into(), id, title, snippet: snip, when });
                }
                Ok(())
            };
            run("SELECT id, title, notes, started_at FROM meetings WHERE is_demo = 0 AND (title LIKE ?1 OR notes LIKE ?1) ORDER BY started_at DESC LIMIT ?2", "session", 2)?;
            run("SELECT m.id, m.title, s.text, m.started_at FROM segments s JOIN meetings m ON m.id = s.meeting_id WHERE m.is_demo = 0 AND s.text LIKE ?1 GROUP BY m.id ORDER BY m.started_at DESC LIMIT ?2", "transcript", 2)?;
            run("SELECT id, title, body, updated_at FROM records WHERE kind = 'note' AND (title LIKE ?1 OR body LIKE ?1) ORDER BY updated_at DESC LIMIT ?2", "note", 2)?;
            run("SELECT id, title, body, updated_at FROM records WHERE kind = 'incident' AND (title LIKE ?1 OR body LIKE ?1) ORDER BY updated_at DESC LIMIT ?2", "incident", 2)?;
            run("SELECT id, title, '', updated_at FROM records WHERE kind = 'board' AND title LIKE ?1 ORDER BY updated_at DESC LIMIT ?2", "whiteboard", 2)?;
            run("SELECT id, title, '', updated_at FROM records WHERE kind = 'chart' AND title LIKE ?1 ORDER BY updated_at DESC LIMIT ?2", "chart", 2)?;
            run("SELECT id, title, source, created_at FROM diagrams WHERE title LIKE ?1 OR source LIKE ?1 ORDER BY created_at DESC LIMIT ?2", "diagram", 2)?;
            run("SELECT id, name, '', created_at FROM documents WHERE name LIKE ?1 ORDER BY created_at DESC LIMIT ?2", "document", 2)?;
            run("SELECT id, title, detail, updated_at FROM learning_items WHERE title LIKE ?1 OR detail LIKE ?1 ORDER BY updated_at DESC LIMIT ?2", "learning", 2)?;
            run("SELECT id, title, summary, COALESCE(published_at, fetched_at) FROM discover_items WHERE title LIKE ?1 OR summary LIKE ?1 ORDER BY COALESCE(published_at, fetched_at) DESC LIMIT ?2", "discover", 2)?;
        }
        Ok(hits)
    }
}

fn row(r: &rusqlite::Row) -> rusqlite::Result<Record> {
    Ok(Record { id: r.get(0)?, kind: r.get(1)?, title: r.get(2)?, body: r.get(3)?, meta: r.get(4)?, meeting_id: r.get(5)?, created_at: r.get(6)?, updated_at: r.get(7)? })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> (tempfile::TempDir, Db) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(&dir.path().join("t.sqlite")).unwrap();
        (dir, db)
    }
    fn rec(id: &str, kind: &str, title: &str, body: &str) -> Record {
        Record { id: id.into(), kind: kind.into(), title: title.into(), body: body.into(), meta: None, meeting_id: None, created_at: 0, updated_at: 0 }
    }

    #[test]
    fn records_are_saved_updated_listed_searched_and_deleted() {
        let (_d, db) = db();
        let a = db.save_record(&rec("a", "note", "Kubernetes ingress", "Traffic enters through the ingress controller."), 100).unwrap();
        assert_eq!((a.created_at, a.updated_at), (100, 100));
        db.save_record(&rec("a", "note", "Kubernetes ingress", "Edited body"), 200).unwrap();
        let got = db.get_record("a").unwrap().unwrap();
        assert_eq!((got.created_at, got.updated_at, got.body.as_str()), (100, 200, "Edited body"));
        db.save_record(&rec("b", "note", "Budget", "five thousand"), 300).unwrap();
        assert_eq!(db.list_records("note", None, None, true, 10).unwrap().iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), vec!["b", "a"]);
        assert_eq!(db.list_records("note", Some("edited"), None, true, 10).unwrap().len(), 1);
        assert_eq!(db.list_records("note", None, None, false, 10).unwrap()[0].body, "");
        assert!(db.save_record(&rec("x", "bogus", "t", ""), 1).is_err());
        db.delete_record("a").unwrap();
        assert!(db.get_record("a").unwrap().is_none());
    }

    #[test]
    fn deleting_a_board_removes_its_revisions_and_old_revisions_are_trimmed() {
        let (_d, db) = db();
        db.save_record(&rec("board1", "board", "Arch", "{}"), 1).unwrap();
        for i in 0..5 {
            let mut r = rec(&format!("rev{i}"), "board_rev", "v", "{}");
            r.meta = Some("board1".into());
            db.save_record(&r, 10 + i).unwrap();
        }
        db.trim_revisions("board1", 3).unwrap();
        assert_eq!(db.list_revisions("board1").unwrap().len(), 3);
        db.delete_record("board1").unwrap();
        assert!(db.list_revisions("board1").unwrap().is_empty());
    }

    #[test]
    fn learning_completion_time_is_set_by_the_app_and_stats_count_real_rows() {
        let (_d, db) = db();
        let mut item = LearningItem { id: "l1".into(), kind: "lesson".into(), title: "Pods".into(), status: "doing".into(), parent_id: None, source: None, url: None, detail: None, created_at: 0, updated_at: 0, completed_at: Some(1) };
        let saved = db.save_learning(&item, 100).unwrap();
        assert_eq!(saved.completed_at, None); // a caller cannot invent completion
        item.status = "done".into();
        assert_eq!(db.save_learning(&item, 200).unwrap().completed_at, Some(200));
        assert_eq!(db.save_learning(&item, 300).unwrap().completed_at, Some(200)); // kept
        let mut bad = item.clone();
        bad.status = "finished".into();
        assert!(db.save_learning(&bad, 1).is_err());
        db.add_quiz_attempt("Kubernetes", 5, 4, 1).unwrap();
        assert!(db.add_quiz_attempt("x", 5, 6, 1).is_err());
        let q = db.quiz_stats().unwrap();
        assert_eq!((q.attempts, q.total, q.correct), (1, 5, 4));
        db.save_record(&rec("n1", "note", "T", ""), 1).unwrap();
        let s = db.stats(1_000_000).unwrap();
        assert_eq!((s.notes, s.learning_total, s.learning_done, s.sessions, s.whiteboards), (1, 1, 1, 0, 0));
        assert_eq!(s.notes_week, 1); // saved at time 1, within 7 days of 1_000_000
    }

    #[test]
    fn global_search_finds_notes_learning_and_titles_and_ignores_tiny_queries() {
        let (_d, db) = db();
        db.save_record(&rec("n1", "note", "Postgres backups", "We take nightly snapshots."), 5).unwrap();
        db.save_record(&rec("b1", "board", "Postgres layout", "{\"huge\":\"scene snapshots\"}"), 6).unwrap();
        db.create_meeting("m1", "Standup", 10, false).unwrap();
        db.add_segment("m1", crate::audio::Source::System, "The snapshots run at midnight.", 0, 900).unwrap();
        let hits = db.global_search("snapshots", 5).unwrap();
        let kinds: Vec<&str> = hits.iter().map(|h| h.kind.as_str()).collect();
        assert!(kinds.contains(&"note") && kinds.contains(&"transcript"));
        assert!(!kinds.contains(&"whiteboard")); // board scene JSON is not searched, only its title
        assert!(db.global_search("postgres", 5).unwrap().iter().any(|h| h.kind == "whiteboard"));
        assert!(db.global_search("a", 5).unwrap().is_empty());
        assert!(db.global_search("100%", 5).is_ok());
    }
}
