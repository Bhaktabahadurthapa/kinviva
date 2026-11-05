//! Application state shared by commands and background tasks.

use crate::audio::Source;
use crate::db::{Db, Passage};
use crate::meeting::Session;
use crate::question::QuestionDetector;
use crate::settings::Settings;
use crate::transcript::Transcript;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Default)]
pub struct SourceStatus {
    pub enabled: bool,
    /// off | starting | capturing | error
    pub capture: String,
    /// idle | connecting | connected | error | closed
    pub stt: String,
    pub device: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MeetingStatus {
    /// idle | starting | running | stopping
    pub state: String,
    pub meeting_id: Option<String>,
    pub title: Option<String>,
    pub started_at: Option<i64>,
    pub mic: SourceStatus,
    pub system: SourceStatus,
    pub stt_provider: String,
    /// Audio is being sent to a cloud speech provider.
    pub audio_to_cloud: bool,
    pub stt_host: Option<String>,
    pub recording_audio: bool,
    /// Capture is running but audio is not being transcribed or recorded.
    pub paused: bool,
    /// A saved meeting loaded as context while idle.
    pub context_meeting_id: Option<String>,
    pub context_is_demo: bool,
    /// Session type of the running meeting (Class / Work / General).
    pub session: crate::session::SessionInfo,
}

impl Default for MeetingStatus {
    fn default() -> Self {
        Self {
            state: "idle".into(),
            meeting_id: None,
            title: None,
            started_at: None,
            mic: SourceStatus { capture: "off".into(), stt: "idle".into(), ..Default::default() },
            system: SourceStatus { capture: "off".into(), stt: "idle".into(), ..Default::default() },
            stt_provider: String::new(),
            audio_to_cloud: false,
            stt_host: None,
            recording_audio: false,
            paused: false,
            context_meeting_id: None,
            context_is_demo: false,
            session: Default::default(),
        }
    }
}

impl MeetingStatus {
    pub fn source_mut(&mut self, s: Source) -> &mut SourceStatus {
        match s {
            Source::Mic => &mut self.mic,
            Source::System => &mut self.system,
        }
    }
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct AiSlot {
    pub request_id: Option<String>,
    pub action: Option<String>,
    /// idle | streaming | done | error | cancelled
    pub state: String,
    pub text: String,
    pub error: Option<String>,
    pub sources: Vec<Passage>,
    pub destination: Option<String>,
    pub question: Option<String>,
    /// Started automatically by auto-assist, not by a click.
    pub auto: bool,
    /// The "Them" line an automatic answer belongs to.
    pub segment_id: Option<i64>,
    /// Web results used for this answer (when web search is on).
    pub web: Vec<crate::websearch::WebSource>,
}

#[derive(Default)]
pub struct Live {
    pub status: MeetingStatus,
    pub transcript: Transcript,
    pub notes: String,
    pub ai: HashMap<String, AiSlot>,
}

#[derive(Serialize)]
pub struct Snapshot {
    pub status: MeetingStatus,
    pub transcript: Transcript,
    pub notes: String,
    pub ai: HashMap<String, AiSlot>,
}

pub struct AppState {
    /// Shared with the audio forwarders: while true, captured audio is dropped.
    pub paused: Arc<std::sync::atomic::AtomicBool>,
    /// The screen read in flight, if any (a new one cancels it).
    pub screen_cancel: Mutex<Option<tokio_util::sync::CancellationToken>>,
    pub db: Arc<Db>,
    pub data_dir: PathBuf,
    pub live: Arc<Mutex<Live>>,
    pub session: tokio::sync::Mutex<Option<Session>>,
    pub ai_tasks: Mutex<HashMap<String, CancellationToken>>,
    /// (panel, request id) of automatic requests still running, oldest first.
    pub auto_inflight: Mutex<Vec<(String, String)>>,
    pub questions: Arc<Mutex<QuestionDetector>>,
    pub auto: crate::auto_assist::AutoAssist,
    /// The Interview Practice request in flight, if any.
    pub interview: Mutex<crate::interview::Registry>,
}

impl AppState {
    pub fn settings(&self) -> Settings {
        self.db
            .get_setting("app")
            .ok()
            .flatten()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save_settings(&self, s: &Settings) -> Result<(), String> {
        let json = serde_json::to_string(s).map_err(|e| e.to_string())?;
        self.db.set_setting("app", &json)
    }

    pub fn snapshot(&self) -> Snapshot {
        let live = self.live.lock().unwrap();
        Snapshot {
            status: live.status.clone(),
            transcript: live.transcript.clone(),
            notes: live.notes.clone(),
            ai: live.ai.clone(),
        }
    }
}
