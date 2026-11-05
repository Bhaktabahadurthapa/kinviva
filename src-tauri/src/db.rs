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
    // 3: Class sessions: courses, weekly resources, page citations, session type on meetings
    r#"
    CREATE TABLE courses (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        code TEXT NOT NULL DEFAULT '',
        term TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
    );
    ALTER TABLE documents ADD COLUMN course_id TEXT;
    ALTER TABLE documents ADD COLUMN week INTEGER;
    ALTER TABLE doc_chunks ADD COLUMN page INTEGER;
    ALTER TABLE meetings ADD COLUMN session_type TEXT NOT NULL DEFAULT 'general';
    ALTER TABLE meetings ADD COLUMN course_id TEXT;
    ALTER TABLE meetings ADD COLUMN week INTEGER;
    CREATE INDEX documents_course ON documents(course_id, week);
    "#,
    // 4: references kept with each answer; saved interview practice for later review
    r#"
    ALTER TABLE ai_messages ADD COLUMN sources TEXT;
    CREATE TABLE interview_entries (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        category TEXT NOT NULL,
        role TEXT,
        mode TEXT NOT NULL,
        language TEXT,
        question TEXT NOT NULL,
        answer TEXT,
        result TEXT NOT NULL
    );
    CREATE INDEX interview_entries_time ON interview_entries(created_at);
    "#,
    // 5: saved architecture diagrams (Mermaid source plus the checked model they came from)
    r#"
    CREATE TABLE diagrams (
        id TEXT PRIMARY KEY,
        meeting_id TEXT REFERENCES meetings(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL,
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        source TEXT NOT NULL,
        model TEXT,
        origin TEXT NOT NULL
    );
    CREATE INDEX diagrams_time ON diagrams(created_at);
    CREATE INDEX diagrams_meeting ON diagrams(meeting_id);
    "#,
    // 6: notes, whiteboards, charts and incidents (one generic table), learning, discover
    r#"
    CREATE TABLE records (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        meta TEXT,
        meeting_id TEXT REFERENCES meetings(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE INDEX records_kind ON records(kind, updated_at);
    CREATE TABLE learning_items (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'todo',
        parent_id TEXT,
        source TEXT,
        url TEXT,
        detail TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER
    );
    CREATE TABLE quiz_attempts (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        total INTEGER NOT NULL,
        correct INTEGER NOT NULL,
        created_at INTEGER NOT NULL
    );
    CREATE TABLE discover_items (
        id TEXT PRIMARY KEY,
        url TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        source TEXT NOT NULL,
        summary TEXT,
        published_at INTEGER,
        fetched_at INTEGER NOT NULL,
        topic TEXT,
        kind TEXT NOT NULL,
        score REAL NOT NULL DEFAULT 0,
        stars INTEGER,
        language TEXT,
        is_read INTEGER NOT NULL DEFAULT 0,
        saved INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX discover_time ON discover_items(published_at);
    "#,
    // 7: a small picture for each Discover item (stored locally so the app never loads remote images)
    r#"
    ALTER TABLE discover_items ADD COLUMN image TEXT;
    "#,
    // 8: sessions go to a Trash first (deleted_at) and are only erased for good from there
    r#"
    ALTER TABLE meetings ADD COLUMN deleted_at INTEGER;
    CREATE INDEX meetings_deleted ON meetings(deleted_at);
    "#,
];

#[derive(Debug, Clone, Serialize, serde::Deserialize, PartialEq)]
pub struct DiagramRecord {
    pub id: String,
    pub meeting_id: Option<String>,
    pub created_at: i64,
    pub title: String,
    /// flowchart | sequence
    pub kind: String,
    /// The Mermaid source that was shown.
    pub source: String,
    /// The checked architecture model (JSON), when the diagram was generated.
    pub model: Option<String>,
    /// generated | edited
    pub origin: String,
}

#[derive(Clone, Copy)]
enum Scope3 {
    Active = 0,
    Trash = 1,
    Any = 2,
}

pub struct Db {
    pub(crate) conn: Mutex<Connection>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MeetingSummary {
    pub id: String,
    pub title: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub segment_count: i64,
    pub is_demo: bool,
    /// class | work | general
    pub session_type: String,
    pub course_id: Option<String>,
    pub course_name: Option<String>,
    pub week: Option<i64>,
    /// When it was moved to the Trash (`None` for a normal session).
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, serde::Deserialize, PartialEq)]
pub struct SourceRef {
    /// "notes.pdf, p. 4" or a web page title.
    pub label: String,
    /// Web address for web sources; `None` for your own files.
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct InterviewEntry {
    pub id: String,
    pub created_at: i64,
    pub category: String,
    pub role: Option<String>,
    pub mode: String,
    pub language: Option<String>,
    pub question: String,
    pub answer: Option<String>,
    /// The structured result as JSON, or plain text when the model did not follow the format.
    pub result: String,
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
    pub sources: Vec<SourceRef>,
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
    /// The course this resource belongs to; `None` for the general library.
    pub course_id: Option<String>,
    pub week: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Course {
    pub id: String,
    pub name: String,
    pub code: String,
    pub term: String,
    pub created_at: i64,
    pub resources: i64,
}

/// Which documents a search may use.
#[derive(Debug, Clone, PartialEq)]
pub enum Scope {
    /// The general library (documents that belong to no course).
    Library,
    /// One course's resources; resources for `week` rank first.
    Course { id: String, week: Option<i64> },
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Passage {
    pub document: String,
    pub chunk: i64,
    pub text: String,
    /// PDF page (1-based); `None` for text files.
    pub page: Option<i64>,
    /// Course week the document belongs to, if any.
    pub week: Option<i64>,
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
    /// Moves sessions to the Trash. Nothing is erased; they can be restored.
    pub fn trash_meetings(&self, ids: &[String], now: i64) -> R<usize> {
        let conn = self.conn.lock().unwrap();
        let mut n = 0;
        for id in ids {
            n += conn.execute("UPDATE meetings SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL", params![id, now]).map_err(e)?;
        }
        Ok(n)
    }

    pub fn restore_meetings(&self, ids: &[String]) -> R<usize> {
        let conn = self.conn.lock().unwrap();
        let mut n = 0;
        for id in ids {
            n += conn.execute("UPDATE meetings SET deleted_at = NULL WHERE id = ?1 AND deleted_at IS NOT NULL", [id]).map_err(e)?;
        }
        Ok(n)
    }

    /// Ids that are in the Trash (all of them when `ids` is empty and `all` is true).
    pub fn trashed_ids(&self, ids: &[String], all: bool) -> R<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut out = Vec::new();
        let mut stmt = conn.prepare("SELECT id FROM meetings WHERE deleted_at IS NOT NULL").map_err(e)?;
        for r in stmt.query_map([], |r| r.get::<_, String>(0)).map_err(e)? {
            let id = r.map_err(e)?;
            if all || ids.contains(&id) {
                out.push(id);
            }
        }
        Ok(out)
    }

    /// Erases sessions for good, but only ones already in the Trash. With `with_linked`, notes, whiteboards,
    /// charts, incidents and diagrams saved from those sessions go too; otherwise they stay, unlinked.
    pub fn purge_meetings(&self, ids: &[String], with_linked: bool) -> R<usize> {
        let ids = self.trashed_ids(ids, false)?;
        let conn = self.conn.lock().unwrap();
        let mut n = 0;
        for id in &ids {
            if with_linked {
                conn.execute("DELETE FROM records WHERE meeting_id = ?1 AND kind != 'board_rev'", [id]).map_err(e)?;
                conn.execute("DELETE FROM records WHERE kind = 'board_rev' AND meta NOT IN (SELECT id FROM records WHERE kind = 'board')", []).map_err(e)?;
                conn.execute("DELETE FROM diagrams WHERE meeting_id = ?1", [id]).map_err(e)?;
            } else {
                conn.execute("UPDATE records SET meeting_id = NULL WHERE meeting_id = ?1", [id]).map_err(e)?;
                conn.execute("UPDATE diagrams SET meeting_id = NULL WHERE meeting_id = ?1", [id]).map_err(e)?;
            }
            n += conn.execute("DELETE FROM meetings WHERE id = ?1 AND deleted_at IS NOT NULL", [id]).map_err(e)?;
        }
        // Free the space the erased text used.
        let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
        Ok(n)
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

    /// Normal sessions (not in the Trash).
    pub fn list_meetings(&self, search: Option<&str>) -> R<Vec<MeetingSummary>> {
        self.list_meetings_in(search, Scope3::Active)
    }

    pub fn list_trash(&self) -> R<Vec<MeetingSummary>> {
        self.list_meetings_in(None, Scope3::Trash)
    }

    fn list_meetings_in(&self, search: Option<&str>, scope: Scope3) -> R<Vec<MeetingSummary>> {
        let conn = self.conn.lock().unwrap();
        let pattern = search.filter(|s| !s.trim().is_empty()).map(|s| format!("%{}%", s.trim()));
        let mut stmt = conn
            .prepare(
                "SELECT m.id, m.title, m.started_at, m.ended_at, m.is_demo,
                        (SELECT COUNT(*) FROM segments s WHERE s.meeting_id = m.id),
                        m.session_type, (SELECT c.name FROM courses c WHERE c.id = m.course_id), m.week, m.course_id, m.deleted_at
                 FROM meetings m
                 WHERE (?1 IS NULL OR m.title LIKE ?1 OR m.notes LIKE ?1
                    OR EXISTS (SELECT 1 FROM segments s WHERE s.meeting_id = m.id AND s.text LIKE ?1))
                   AND (?2 = 2 OR (?2 = 0 AND m.deleted_at IS NULL) OR (?2 = 1 AND m.deleted_at IS NOT NULL))
                 ORDER BY COALESCE(m.deleted_at, m.started_at) DESC",
            )
            .map_err(e)?;
        let rows = stmt
            .query_map(params![pattern, scope as i64], |r| {
                Ok(MeetingSummary {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    started_at: r.get(2)?,
                    ended_at: r.get(3)?,
                    is_demo: r.get::<_, i64>(4)? != 0,
                    segment_count: r.get(5)?,
                    session_type: r.get(6)?,
                    course_name: r.get(7)?,
                    week: r.get(8)?,
                    course_id: r.get(9)?,
                    deleted_at: r.get(10)?,
                })
            })
            .map_err(e)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(e)
    }

    pub fn get_meeting(&self, id: &str) -> R<MeetingDetail> {
        let summary = self
            .list_meetings_in(None, Scope3::Any)?
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
                "SELECT id, action, question, response, model, status, created_at, sources FROM ai_messages
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
                    sources: r.get::<_, Option<String>>(7)?.and_then(|j| serde_json::from_str(&j).ok()).unwrap_or_default(),
                })
            })
            .map_err(e)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(e)?;
        Ok(MeetingDetail { meeting: summary, notes, segments, ai_messages })
    }

    /// Keeps the references (your files with page, web pages) used for an answer.
    pub fn set_ai_message_sources(&self, id: &str, sources: &[SourceRef]) -> R<()> {
        if sources.is_empty() {
            return Ok(());
        }
        let json = serde_json::to_string(sources).map_err(|e| e.to_string())?;
        self.conn.lock().unwrap().execute("UPDATE ai_messages SET sources = ?2 WHERE id = ?1", params![id, json]).map(|_| ()).map_err(e)
    }

    pub fn add_diagram(&self, d: &DiagramRecord) -> R<()> {
        self.conn
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO diagrams(id, meeting_id, created_at, title, kind, source, model, origin) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                params![d.id, d.meeting_id, d.created_at, d.title, d.kind, d.source, d.model, d.origin],
            )
            .map(|_| ())
            .map_err(e)
    }

    /// Newest first. With a meeting id, only that session's diagrams.
    pub fn list_diagrams(&self, meeting_id: Option<&str>, limit: usize) -> R<Vec<DiagramRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, meeting_id, created_at, title, kind, source, model, origin FROM diagrams WHERE (?1 IS NULL OR meeting_id = ?1) ORDER BY created_at DESC LIMIT ?2")
            .map_err(e)?;
        let rows = stmt
            .query_map(params![meeting_id, limit as i64], |r| {
                Ok(DiagramRecord { id: r.get(0)?, meeting_id: r.get(1)?, created_at: r.get(2)?, title: r.get(3)?, kind: r.get(4)?, source: r.get(5)?, model: r.get(6)?, origin: r.get(7)? })
            })
            .map_err(e)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(e)
    }

    pub fn delete_diagram(&self, id: &str) -> R<()> {
        self.conn.lock().unwrap().execute("DELETE FROM diagrams WHERE id = ?1", [id]).map(|_| ()).map_err(e)
    }

    pub fn add_interview_entry(&self, x: &InterviewEntry) -> R<()> {
        self.conn
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO interview_entries(id, created_at, category, role, mode, language, question, answer, result) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                params![x.id, x.created_at, x.category, x.role, x.mode, x.language, x.question, x.answer, x.result],
            )
            .map(|_| ())
            .map_err(e)
    }

    /// Saved interview practice, oldest first, optionally only entries at or after `since_ms`.
    pub fn list_interview_entries(&self, since_ms: Option<i64>) -> R<Vec<InterviewEntry>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, created_at, category, role, mode, language, question, answer, result FROM interview_entries WHERE created_at >= ?1 ORDER BY created_at")
            .map_err(e)?;
        let rows = stmt
            .query_map([since_ms.unwrap_or(0)], |r| {
                Ok(InterviewEntry { id: r.get(0)?, created_at: r.get(1)?, category: r.get(2)?, role: r.get(3)?, mode: r.get(4)?, language: r.get(5)?, question: r.get(6)?, answer: r.get(7)?, result: r.get(8)? })
            })
            .map_err(e)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(e)
    }

    pub fn delete_interview_entries(&self, since_ms: Option<i64>) -> R<()> {
        self.conn.lock().unwrap().execute("DELETE FROM interview_entries WHERE created_at >= ?1", [since_ms.unwrap_or(0)]).map(|_| ()).map_err(e)
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
    #[allow(clippy::too_many_arguments)]
    pub fn add_document(&self, id: &str, name: &str, kind: &str, path: &str, chunks: &[(Option<i64>, String)], course_id: Option<&str>, week: Option<i64>) -> R<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction().map_err(e)?;
        let chars: usize = chunks.iter().map(|c| c.1.chars().count()).sum();
        tx.execute(
            "INSERT INTO documents(id, name, kind, path, chars, created_at, course_id, week) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![id, name, kind, path, chars as i64, now_ms(), course_id, week],
        )
        .map_err(e)?;
        for (i, (page, text)) in chunks.iter().enumerate() {
            tx.execute("INSERT INTO doc_chunks(document_id, ord, text, page) VALUES (?1, ?2, ?3, ?4)", params![id, i as i64, text, page])
                .map_err(e)?;
        }
        tx.commit().map_err(e)
    }

    // ---- courses ----
    pub fn create_course(&self, id: &str, name: &str, code: &str, term: &str) -> R<()> {
        self.conn
            .lock()
            .unwrap()
            .execute("INSERT INTO courses(id, name, code, term, created_at) VALUES (?1, ?2, ?3, ?4, ?5)", params![id, name, code, term, now_ms()])
            .map(|_| ())
            .map_err(e)
    }

    pub fn list_courses(&self) -> R<Vec<Course>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT c.id, c.name, c.code, c.term, c.created_at, (SELECT COUNT(*) FROM documents d WHERE d.course_id = c.id) FROM courses c ORDER BY c.created_at DESC")
            .map_err(e)?;
        let rows = stmt
            .query_map([], |r| Ok(Course { id: r.get(0)?, name: r.get(1)?, code: r.get(2)?, term: r.get(3)?, created_at: r.get(4)?, resources: r.get(5)? }))
            .map_err(e)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(e)
    }

    /// Deletes a course and its resources. Saved meetings keep their text; they just lose the course link.
    pub fn delete_course(&self, id: &str) -> R<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction().map_err(e)?;
        tx.execute("DELETE FROM documents WHERE course_id = ?1", [id]).map_err(e)?;
        tx.execute("UPDATE meetings SET course_id = NULL WHERE course_id = ?1", [id]).map_err(e)?;
        tx.execute("DELETE FROM courses WHERE id = ?1", [id]).map_err(e)?;
        tx.commit().map_err(e)
    }

    pub fn course_name(&self, id: &str) -> R<Option<String>> {
        self.conn.lock().unwrap().query_row("SELECT name FROM courses WHERE id = ?1", [id], |r| r.get(0)).optional().map_err(e)
    }

    pub fn set_meeting_session(&self, id: &str, kind: &str, course_id: Option<&str>, week: Option<i64>) -> R<()> {
        self.conn
            .lock()
            .unwrap()
            .execute("UPDATE meetings SET session_type = ?2, course_id = ?3, week = ?4 WHERE id = ?1", params![id, kind, course_id, week])
            .map(|_| ())
            .map_err(e)
    }

    pub fn list_documents(&self) -> R<Vec<DocumentInfo>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT d.id, d.name, d.kind, d.chars, d.active, d.created_at,
                        (SELECT COUNT(*) FROM doc_chunks c WHERE c.document_id = d.id), d.course_id, d.week
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
                    course_id: r.get(7)?,
                    week: r.get(8)?,
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

    /// Full-text retrieval over the general library, best matches first.
    pub fn search_passages(&self, fts_query: &str, limit: usize) -> R<Vec<Passage>> {
        self.search_scoped(fts_query, limit, &Scope::Library)
    }

    /// Full-text retrieval over active documents in `scope`. For a course with a
    /// week, resources for that week come first, then the rest by relevance.
    pub fn search_scoped(&self, fts_query: &str, limit: usize, scope: &Scope) -> R<Vec<Passage>> {
        if fts_query.trim().is_empty() {
            return Ok(Vec::new());
        }
        let (course, week) = match scope {
            Scope::Library => (None, None),
            Scope::Course { id, week } => (Some(id.as_str()), *week),
        };
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT d.name, c.ord, c.text, c.page, d.week FROM doc_chunks_fts f
                 JOIN doc_chunks c ON c.id = f.rowid
                 JOIN documents d ON d.id = c.document_id
                 WHERE doc_chunks_fts MATCH ?1 AND d.active = 1
                   AND ((?3 IS NULL AND d.course_id IS NULL) OR d.course_id = ?3)
                 ORDER BY CASE WHEN ?4 IS NOT NULL AND d.week = ?4 THEN 0 ELSE 1 END, bm25(doc_chunks_fts) LIMIT ?2",
            )
            .map_err(e)?;
        let rows = stmt
            .query_map(params![fts_query, limit as i64, course, week], |r| {
                Ok(Passage { document: r.get(0)?, chunk: r.get(1)?, text: r.get(2)?, page: r.get(3)?, week: r.get(4)? })
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
        db.add_document("d1", "resume.md", "md", "/x", &[(None, "Led migration to PostgreSQL in 2023.".into()), (None, "Hobbies: cycling.".into())], None, None).unwrap();
        db.add_document("d2", "other.txt", "txt", "/y", &[(None, "PostgreSQL tuning notes.".into())], None, None).unwrap();
        let hits = db.search_passages("\"postgresql\"", 5).unwrap();
        assert_eq!(hits.len(), 2);
        db.set_document_active("d2", false).unwrap();
        let hits = db.search_passages("\"postgresql\"", 5).unwrap();
        assert_eq!(hits, vec![Passage { document: "resume.md".into(), chunk: 0, text: "Led migration to PostgreSQL in 2023.".into(), page: None, week: None }]);
        db.delete_document("d1").unwrap();
        assert!(db.search_passages("\"postgresql\"", 5).unwrap().is_empty());
        assert_eq!(db.list_documents().unwrap().len(), 1);
    }

    fn course_db() -> Db {
        let db = Db::open_in_memory().unwrap();
        db.create_course("os", "Operating Systems", "CS350", "Fall").unwrap();
        db.create_course("ml", "Machine Learning", "", "").unwrap();
        db.add_document("os-w2", "week2.pdf", "pdf", "/a", &[(Some(1), "Scheduling uses a ready queue.".into()), (Some(2), "Round robin scheduling uses a time quantum.".into())], Some("os"), Some(2)).unwrap();
        db.add_document("os-w5", "week5.pdf", "pdf", "/b", &[(Some(7), "Scheduling in multiprocessors needs load balancing.".into())], Some("os"), Some(5)).unwrap();
        db.add_document("ml-w1", "ml1.pdf", "pdf", "/c", &[(Some(3), "Scheduling the learning rate decays over epochs.".into())], Some("ml"), Some(1)).unwrap();
        db.add_document("lib", "notes.md", "md", "/d", &[(None, "Personal scheduling notes.".into())], None, None).unwrap();
        db
    }

    #[test]
    fn a_class_search_reads_only_its_own_course_and_keeps_pages() {
        let db = course_db();
        let os = Scope::Course { id: "os".into(), week: None };
        let hits = db.search_scoped("\"scheduling\"", 10, &os).unwrap();
        assert_eq!(hits.len(), 3);
        assert!(hits.iter().all(|h| h.document.starts_with("week")), "other courses or the library leaked: {hits:?}");
        assert!(hits.iter().any(|h| h.document == "week2.pdf" && h.page == Some(2) && h.week == Some(2)));
        // The library and other courses never see course files, and vice versa.
        let lib = db.search_passages("\"scheduling\"", 10).unwrap();
        assert_eq!(lib.iter().map(|p| p.document.as_str()).collect::<Vec<_>>(), vec!["notes.md"]);
        let ml = db.search_scoped("\"scheduling\"", 10, &Scope::Course { id: "ml".into(), week: None }).unwrap();
        assert_eq!(ml.len(), 1);
        assert_eq!(ml[0].document, "ml1.pdf");
    }

    #[test]
    fn the_selected_week_ranks_first() {
        let db = course_db();
        let hits = db.search_scoped("\"scheduling\"", 10, &Scope::Course { id: "os".into(), week: Some(5) }).unwrap();
        assert_eq!(hits[0].document, "week5.pdf");
        assert_eq!(hits[0].page, Some(7));
    }

    #[test]
    fn course_lifecycle_and_session_are_saved_with_the_meeting() {
        let db = course_db();
        let cs = db.list_courses().unwrap();
        assert_eq!(cs.iter().find(|c| c.id == "os").unwrap().resources, 2);
        assert_eq!(db.course_name("os").unwrap().as_deref(), Some("Operating Systems"));
        assert_eq!(db.course_name("nope").unwrap(), None);

        db.create_meeting("m1", "Lecture 3", 1, false).unwrap();
        assert_eq!(db.get_meeting("m1").unwrap().meeting.session_type, "general");
        db.set_meeting_session("m1", "class", Some("os"), Some(3)).unwrap();
        let m = db.get_meeting("m1").unwrap().meeting;
        assert_eq!((m.session_type.as_str(), m.course_name.as_deref(), m.week), ("class", Some("Operating Systems"), Some(3)));

        db.delete_course("os").unwrap();
        assert!(db.list_documents().unwrap().iter().all(|d| d.course_id.as_deref() != Some("os")));
        assert!(db.search_scoped("\"scheduling\"", 10, &Scope::Course { id: "os".into(), week: None }).unwrap().is_empty());
        let m = db.get_meeting("m1").unwrap().meeting;
        assert_eq!((m.session_type.as_str(), m.course_name), ("class", None), "the meeting survives; only the course link is dropped");
        assert_eq!(db.list_courses().unwrap().len(), 1);
    }

    #[test]
    fn migration_three_upgrades_an_existing_database_without_losing_data() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("old.sqlite");
        {
            let mut conn = Connection::open(&path).unwrap();
            for (i, sql) in MIGRATIONS.iter().take(2).enumerate() {
                let tx = conn.transaction().unwrap();
                tx.execute_batch(sql).unwrap();
                tx.execute_batch(&format!("PRAGMA user_version = {}", i + 1)).unwrap();
                tx.commit().unwrap();
            }
            conn.execute("INSERT INTO meetings(id, title, started_at) VALUES ('old', 'Before', 1)", []).unwrap();
            conn.execute("INSERT INTO documents(id, name, kind, path, chars, created_at) VALUES ('d', 'cv.md', 'md', '/x', 5, 1)", []).unwrap();
            conn.execute("INSERT INTO doc_chunks(document_id, ord, text) VALUES ('d', 0, 'Rust engineer')", []).unwrap();
        }
        let db = Db::open(&path).unwrap();
        assert_eq!(db.schema_version(), MIGRATIONS.len() as i64);
        assert_eq!(db.get_meeting("old").unwrap().meeting.session_type, "general");
        let hits = db.search_passages("\"rust\"", 5).unwrap();
        assert_eq!((hits.len(), hits[0].page), (1, None));
        assert_eq!(db.list_documents().unwrap()[0].course_id, None);
    }

    #[test]
    fn interview_entries_and_answer_references_are_saved() {
        let db = Db::open_in_memory().unwrap();
        let e = |id: &str, at: i64| InterviewEntry { id: id.into(), created_at: at, category: "coding".into(), role: None, mode: "explain".into(), language: None, question: "q".into(), answer: None, result: "r".into() };
        db.add_interview_entry(&e("a", 100)).unwrap();
        db.add_interview_entry(&e("b", 200)).unwrap();
        assert_eq!(db.list_interview_entries(None).unwrap().len(), 2);
        assert_eq!(db.list_interview_entries(Some(150)).unwrap().iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), vec!["b"]);
        db.delete_interview_entries(Some(150)).unwrap();
        assert_eq!(db.list_interview_entries(None).unwrap().len(), 1);

        db.create_meeting("m", "t", 1, false).unwrap();
        db.add_ai_message("x", Some("m"), "suggest", Some("asked"), "Answer", "model", "done").unwrap();
        db.set_ai_message_sources("x", &[SourceRef { label: "a.pdf, p. 2".into(), url: None }]).unwrap();
        let m = db.get_meeting("m").unwrap();
        assert_eq!(m.ai_messages[0].sources, vec![SourceRef { label: "a.pdf, p. 2".into(), url: None }]);
        assert_eq!(m.ai_messages[0].question.as_deref(), Some("asked"));
    }

    #[test]
    fn diagrams_are_saved_listed_per_session_and_deleted() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(&dir.path().join("t.sqlite")).unwrap();
        let mk = |id: &str, m: Option<&str>, t: i64| DiagramRecord { id: id.into(), meeting_id: m.map(String::from), created_at: t, title: "T".into(), kind: "flowchart".into(), source: "flowchart TD\n a-->b".into(), model: Some("{}".into()), origin: "generated".into() };
        db.add_diagram(&mk("a", None, 1)).unwrap();
        db.add_diagram(&mk("b", None, 2)).unwrap();
        assert_eq!(db.list_diagrams(None, 10).unwrap().iter().map(|d| d.id.as_str()).collect::<Vec<_>>(), vec!["b", "a"]);
        assert!(db.list_diagrams(Some("nope"), 10).unwrap().is_empty());
        db.delete_diagram("a").unwrap();
        assert_eq!(db.list_diagrams(None, 10).unwrap().len(), 1);
    }

    #[test]
    fn sessions_go_to_the_trash_first_and_only_leave_for_good_from_there() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(&dir.path().join("t.sqlite")).unwrap();
        for (id, t) in [("m1", 1000), ("m2", 2000), ("m3", 3000)] {
            db.create_meeting(id, id, t, false).unwrap();
            db.add_segment(id, Source::System, "We discussed the budget.", 0, 900).unwrap();
        }
        let note = |id: &str, m: &str| crate::store::Record { id: id.into(), kind: "note".into(), title: id.into(), body: String::new(), meta: None, meeting_id: Some(m.into()), created_at: 0, updated_at: 0 };
        db.save_record(&note("n1", "m1"), 5).unwrap();
        db.save_record(&note("n2", "m2"), 5).unwrap();
        // Trash: hidden from the list, search and the Dashboard numbers, but still there.
        assert_eq!(db.trash_meetings(&["m1".into(), "m2".into(), "missing".into()], 9000).unwrap(), 2);
        assert_eq!(db.list_meetings(None).unwrap().iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), vec!["m3"]);
        assert_eq!(db.list_meetings(Some("budget")).unwrap().len(), 1);
        assert_eq!(db.list_trash().unwrap().len(), 2);
        assert_eq!(db.stats(10_000).unwrap().sessions, 1);
        assert!(db.global_search("budget", 5).unwrap().iter().all(|h| h.id == "m3"));
        assert_eq!(db.get_meeting("m1").unwrap().meeting.deleted_at, Some(9000)); // still viewable from the Trash
        // Restore.
        assert_eq!(db.restore_meetings(&["m2".into()]).unwrap(), 1);
        assert_eq!(db.list_meetings(None).unwrap().len(), 2);
        // A session that is not in the Trash cannot be erased.
        assert_eq!(db.purge_meetings(&["m3".into(), "m2".into()], true).unwrap(), 0);
        assert!(db.get_meeting("m3").is_ok());
        // Purge without the linked items: the note stays, unlinked.
        assert_eq!(db.purge_meetings(&["m1".into()], false).unwrap(), 1);
        assert!(db.get_meeting("m1").is_err());
        assert_eq!(db.get_record("n1").unwrap().unwrap().meeting_id, None);
        // Purge with the linked items.
        db.trash_meetings(&["m2".into()], 9500).unwrap();
        assert_eq!(db.purge_meetings(&["m2".into()], true).unwrap(), 1);
        assert!(db.get_record("n2").unwrap().is_none());
        assert_eq!(db.list_trash().unwrap().len(), 0);
        assert_eq!(db.schema_version(), MIGRATIONS.len() as i64);
    }
}

