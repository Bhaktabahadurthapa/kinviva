//! Local SQLite persistence with ordered, versioned migrations.

use crate::audio::Source;
use crate::transcript::Segment;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;

/// Each entry is applied once, in order; `PRAGMA user_version` records progress.
/// Never edit a shipped migration; append a new one.
const MIGRATIONS: &[&str] = &[
    // 1: core schema
    r#"
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE meetings (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        notes TEXT NOT NULL DEFAULT '',
        is_demo INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE segments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        text TEXT NOT NULL,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        created_at INTEGER NOT NULL
    );
    CREATE INDEX segments_meeting ON segments(meeting_id, id);
    CREATE TABLE ai_messages (
        id TEXT PRIMARY KEY,
        meeting_id TEXT REFERENCES meetings(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        question TEXT,
        response TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
    );
    CREATE INDEX ai_messages_meeting ON ai_messages(meeting_id, created_at);
    "#,
    // 2: context documents with full-text index for retrieval
    r#"
    CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        path TEXT NOT NULL,
        chars INTEGER NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
    );
    CREATE TABLE doc_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        ord INTEGER NOT NULL,
        text TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE doc_chunks_fts USING fts5(text, content='doc_chunks', content_rowid='id', tokenize='porter unicode61');
    CREATE TRIGGER doc_chunks_ai AFTER INSERT ON doc_chunks BEGIN
        INSERT INTO doc_chunks_fts(rowid, text) VALUES (new.id, new.text);
    END;
    CREATE TRIGGER doc_chunks_ad AFTER DELETE ON doc_chunks BEGIN
        INSERT INTO doc_chunks_fts(doc_chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
    END;
    "#,
];

pub struct Db {
    conn: Mutex<Connection>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MeetingSummary {
    pub id: String,
    pub title: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub segment_count: i64,
    pub is_demo: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct AiMessage {
    pub id: String,
    pub action: String,
    pub question: Option<String>,
    pub response: String,
    pub model: String,
    pub status: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct MeetingDetail {
    pub meeting: MeetingSummary,
    pub notes: String,
    pub segments: Vec<Segment>,
    pub ai_messages: Vec<AiMessage>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DocumentInfo {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub chars: i64,
    pub chunks: i64,
    pub active: bool,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Passage {
    pub document: String,
    pub chunk: i64,
    pub text: String,
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

type R<T> = Result<T, String>;
fn e(err: rusqlite::Error) -> String {
    format!("Database error: {err}")
}

impl Db {
    pub fn open(path: &Path) -> R<Self> {
        let conn = Connection::open(path).map_err(e)?;
        Self::init(conn)
    }

    pub fn open_in_memory() -> R<Self> {
        Self::init(Connection::open_in_memory().map_err(e)?)
    }

    fn init(mut conn: Connection) -> R<Self> {
        conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;").map_err(e)?;
        migrate(&mut conn)?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    pub fn schema_version(&self) -> i64 {
        self.conn.lock().unwrap().query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap_or(0)
    }

    // ---- settings ----
    pub fn get_setting(&self, key: &str) -> R<Option<String>> {
        self.conn
            .lock()
            .unwrap()
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0))
            .optional()
            .map_err(e)
    }
    pub fn set_setting(&self, key: &str, value: &str) -> R<()> {
        self.conn
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO settings(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value],
            )
            .map(|_| ())
            .map_err(e)
    }

    // ---- meetings ----
    pub fn create_meeting(&self, id: &str, title: &str, started_at: i64, is_demo: bool) -> R<()> {
        self.conn
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO meetings(id, title, started_at, is_demo) VALUES (?1, ?2, ?3, ?4)",
                params![id, title, started_at, is_demo as i64],
            )
            .map(|_| ())
            .map_err(e)
    }
    pub fn end_meeting(&self, id: &str, ended_at: i64) -> R<()> {
        self.conn
            .lock()
            .unwrap()
            .execute("UPDATE meetings SET ended_at = ?2 WHERE id = ?1 AND ended_at IS NULL", params![id, ended_at])
            .map(|_| ())
            .map_err(e)
    }
    pub fn rename_meeting(&self, id: &str, title: &str) -> R<()> {
        self.conn
            .lock()
            .unwrap()
            .execute("UPDATE meetings SET title = ?2 WHERE id = ?1", params![id, title])
            .map(|_| ())
            .map_err(e)
    }
    pub fn set_notes(&self, id: &str, notes: &str) -> R<()> {
        self.conn
            .lock()
            .unwrap()
            .execute("UPDATE meetings SET notes = ?2 WHERE id = ?1", params![id, notes])
            .map(|_| ())
            .map_err(e)
    }
    pub fn delete_meeting(&self, id: &str) -> R<()> {
        self.conn
            .lock()
            .unwrap()
            .execute("DELETE FROM meetings WHERE id = ?1", [id])
            .map(|_| ())
            .map_err(e)
    }
    /// Meetings left open by a crash are closed at their last segment time.
    pub fn close_dangling_meetings(&self) -> R<()> {
        self.conn
            .lock()
            .unwrap()
            .execute(
                "UPDATE meetings SET ended_at = COALESCE((SELECT MAX(created_at) FROM segments s WHERE s.meeting_id = meetings.id), started_at)
                 WHERE ended_at IS NULL",
                [],
            )
            .map(|_| ())
            .map_err(e)
    }

    pub fn add_segment(&self, meeting_id: &str, source: Source, text: &str, start_ms: i64, end_ms: i64) -> R<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO segments(meeting_id, source, text, start_ms, end_ms, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![meeting_id, source.as_str(), text, start_ms, end_ms, now_ms()],
        )
        .map_err(e)?;
        Ok(conn.last_insert_rowid())
    }

    pub fn list_meetings(&self, search: Option<&str>) -> R<Vec<MeetingSummary>> {
        let conn = self.conn.lock().unwrap();
        let pattern = search.filter(|s| !s.trim().is_empty()).map(|s| format!("%{}%", s.trim()));
        let mut stmt = conn
            .prepare(
                "SELECT m.id, m.title, m.started_at, m.ended_at, m.is_demo,
                        (SELECT COUNT(*) FROM segments s WHERE s.meeting_id = m.id)
                 FROM meetings m
                 WHERE ?1 IS NULL OR m.title LIKE ?1 OR m.notes LIKE ?1
                    OR EXISTS (SELECT 1 FROM segments s WHERE s.meeting_id = m.id AND s.text LIKE ?1)
                 ORDER BY m.started_at DESC",
            )
            .map_err(e)?;
        let rows = stmt
            .query_map([pattern], |r| {
                Ok(MeetingSummary {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    started_at: r.get(2)?,
                    ended_at: r.get(3)?,
                    is_demo: r.get::<_, i64>(4)? != 0,
                    segment_count: r.get(5)?,
                })
            })
            .map_err(e)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(e)
    }

    pub fn get_meeting(&self, id: &str) -> R<MeetingDetail> {
        let summary = self
            .list_meetings(None)?
            .into_iter()
            .find(|m| m.id == id)
            .ok_or_else(|| "Meeting not found.".to_string())?;
        let conn = self.conn.lock().unwrap();
        let notes: String = conn
            .query_row("SELECT notes FROM meetings WHERE id = ?1", [id], |r| r.get(0))
            .map_err(e)?;
        let mut stmt = conn
            .prepare("SELECT id, source, text, start_ms, end_ms FROM segments WHERE meeting_id = ?1 ORDER BY id")
            .map_err(e)?;
        let segments = stmt
            .query_map([id], |r| {
                let src: String = r.get(1)?;
                Ok(Segment {
                    id: r.get(0)?,
                    source: Source::parse(&src).unwrap_or(Source::System),
                    text: r.get(2)?,
                    start_ms: r.get(3)?,
                    end_ms: r.get(4)?,
                })
            })
            .map_err(e)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(e)?;
        let mut stmt = conn
            .prepare(
                "SELECT id, action, question, response, model, status, created_at FROM ai_messages
                 WHERE meeting_id = ?1 ORDER BY created_at",
            )
            .map_err(e)?;
        let ai_messages = stmt
            .query_map([id], |r| {
                Ok(AiMessage {
                    id: r.get(0)?,
                    action: r.get(1)?,
                    question: r.get(2)?,
                    response: r.get(3)?,
                    model: r.get(4)?,
                    status: r.get(5)?,
                    created_at: r.get(6)?,
                })
            })
            .map_err(e)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(e)?;
        Ok(MeetingDetail { meeting: summary, notes, segments, ai_messages })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_ai_message(
        &self,
        id: &str,
        meeting_id: Option<&str>,
        action: &str,
        question: Option<&str>,
        response: &str,
        model: &str,
        status: &str,
    ) -> R<()> {
        self.conn
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO ai_messages(id, meeting_id, action, question, response, model, status, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![id, meeting_id, action, question, response, model, status, now_ms()],
            )
            .map(|_| ())
            .map_err(e)
    }

    // ---- documents ----
    pub fn add_document(&self, id: &str, name: &str, kind: &str, path: &str, chunks: &[String]) -> R<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction().map_err(e)?;
        let chars: usize = chunks.iter().map(|c| c.chars().count()).sum();
        tx.execute(
            "INSERT INTO documents(id, name, kind, path, chars, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, name, kind, path, chars as i64, now_ms()],
        )
        .map_err(e)?;
        for (i, c) in chunks.iter().enumerate() {
            tx.execute("INSERT INTO doc_chunks(document_id, ord, text) VALUES (?1, ?2, ?3)", params![id, i as i64, c])
                .map_err(e)?;
        }
        tx.commit().map_err(e)
    }

    pub fn list_documents(&self) -> R<Vec<DocumentInfo>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT d.id, d.name, d.kind, d.chars, d.active, d.created_at,
                        (SELECT COUNT(*) FROM doc_chunks c WHERE c.document_id = d.id)
                 FROM documents d ORDER BY d.created_at DESC",
            )
            .map_err(e)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(DocumentInfo {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    kind: r.get(2)?,
                    chars: r.get(3)?,
                    active: r.get::<_, i64>(4)? != 0,
                    created_at: r.get(5)?,
                    chunks: r.get(6)?,
                })
            })
            .map_err(e)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(e)
    }

    pub fn set_document_active(&self, id: &str, active: bool) -> R<()> {
        self.conn
            .lock()
            .unwrap()
            .execute("UPDATE documents SET active = ?2 WHERE id = ?1", params![id, active as i64])
            .map(|_| ())
            .map_err(e)
    }

    pub fn delete_document(&self, id: &str) -> R<()> {
        self.conn
            .lock()
            .unwrap()
            .execute("DELETE FROM documents WHERE id = ?1", [id])
            .map(|_| ())
            .map_err(e)
    }

    /// Full-text retrieval over active documents, best matches first.
    pub fn search_passages(&self, fts_query: &str, limit: usize) -> R<Vec<Passage>> {
        if fts_query.trim().is_empty() {
            return Ok(Vec::new());
        }
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT d.name, c.ord, c.text FROM doc_chunks_fts f
                 JOIN doc_chunks c ON c.id = f.rowid
                 JOIN documents d ON d.id = c.document_id
                 WHERE doc_chunks_fts MATCH ?1 AND d.active = 1
                 ORDER BY bm25(doc_chunks_fts) LIMIT ?2",
            )
            .map_err(e)?;
        let rows = stmt
            .query_map(params![fts_query, limit as i64], |r| {
                Ok(Passage { document: r.get(0)?, chunk: r.get(1)?, text: r.get(2)? })
            })
            .map_err(e)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(e)
    }
}

fn migrate(conn: &mut Connection) -> R<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).map_err(e)?;
    for (i, sql) in MIGRATIONS.iter().enumerate() {
        let version = i as i64 + 1;
        if version <= current {
            continue;
        }
        let tx = conn.transaction().map_err(e)?;
        tx.execute_batch(sql).map_err(|err| format!("Migration {version} failed: {err}"))?;
        tx.execute_batch(&format!("PRAGMA user_version = {version}")).map_err(e)?;
        tx.commit().map_err(e)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_are_idempotent_and_survive_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.sqlite");
        {
            let db = Db::open(&path).unwrap();
            assert_eq!(db.schema_version(), MIGRATIONS.len() as i64);
            db.create_meeting("m1", "Standup", 1000, false).unwrap();
            db.add_segment("m1", Source::System, "What did you ship?", 0, 900).unwrap();
            db.add_segment("m1", Source::Mic, "The export feature.", 1000, 1900).unwrap();
            db.add_ai_message("a1", Some("m1"), "suggest", None, "I shipped export.", "test-model", "done").unwrap();
            db.set_notes("m1", "my notes").unwrap();
            db.end_meeting("m1", 5000).unwrap();
        }
        // Simulates an app restart.
        let db = Db::open(&path).unwrap();
        assert_eq!(db.schema_version(), MIGRATIONS.len() as i64);
        let m = db.get_meeting("m1").unwrap();
        assert_eq!(m.meeting.title, "Standup");
        assert_eq!(m.meeting.ended_at, Some(5000));
        assert_eq!(m.notes, "my notes");
        assert_eq!(m.segments.len(), 2);
        assert_eq!(m.segments[0].source, Source::System);
        assert_eq!(m.segments[1].text, "The export feature.");
        assert_eq!(m.ai_messages[0].response, "I shipped export.");
    }

    #[test]
    fn search_and_delete_cascade() {
        let db = Db::open_in_memory().unwrap();
        db.create_meeting("m1", "Design review", 1, false).unwrap();
        db.create_meeting("m2", "Hiring sync", 2, false).unwrap();
        db.add_segment("m2", Source::System, "budget for contractors", 0, 1).unwrap();
        assert_eq!(db.list_meetings(Some("budget")).unwrap().len(), 1);
        assert_eq!(db.list_meetings(Some("review")).unwrap()[0].id, "m1");
        assert_eq!(db.list_meetings(None).unwrap()[0].id, "m2");
        db.delete_meeting("m2").unwrap();
        assert!(db.get_meeting("m2").is_err());
        let n: i64 = db.conn.lock().unwrap().query_row("SELECT COUNT(*) FROM segments", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn dangling_meetings_are_closed() {
        let db = Db::open_in_memory().unwrap();
        db.create_meeting("m1", "Crash", 100, false).unwrap();
        db.close_dangling_meetings().unwrap();
        assert_eq!(db.get_meeting("m1").unwrap().meeting.ended_at, Some(100));
    }

    #[test]
    fn fts_retrieves_only_active_documents() {
        let db = Db::open_in_memory().unwrap();
        db.add_document("d1", "resume.md", "md", "/x", &["Led migration to PostgreSQL in 2023.".into(), "Hobbies: cycling.".into()]).unwrap();
        db.add_document("d2", "other.txt", "txt", "/y", &["PostgreSQL tuning notes.".into()]).unwrap();
        let hits = db.search_passages("\"postgresql\"", 5).unwrap();
        assert_eq!(hits.len(), 2);
        db.set_document_active("d2", false).unwrap();
        let hits = db.search_passages("\"postgresql\"", 5).unwrap();
        assert_eq!(hits, vec![Passage { document: "resume.md".into(), chunk: 0, text: "Led migration to PostgreSQL in 2023.".into() }]);
        db.delete_document("d1").unwrap();
        assert!(db.search_passages("\"postgresql\"", 5).unwrap().is_empty());
        assert_eq!(db.list_documents().unwrap().len(), 1);
    }
}
