//! Speech-to-text providers. Each provider consumes one source's 16 kHz mono
//! audio and emits partial and final transcript events.

pub mod deepgram;
pub mod vad;
pub mod whisper_cli;

use crate::audio::Source;
use serde::Serialize;
use tokio::sync::mpsc;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum SttEvent {
    Partial { source: Source, text: String },
    Final { source: Source, text: String, start_ms: i64, end_ms: i64 },
    Error { source: Source, message: String, fatal: bool },
    Connected { source: Source },
    Closed { source: Source },
}

#[derive(Debug, Clone)]
pub enum SttConfig {
    Deepgram { api_key: String, model: String, language: String, endpoint: String },
    WhisperCli { binary: String, model_path: String, language: String, work_dir: std::path::PathBuf },
}

impl SttConfig {
    pub fn is_cloud(&self) -> bool {
        matches!(self, SttConfig::Deepgram { .. })
    }
}

/// Run a provider until the audio channel closes (capture stopped) or `cancel`
/// fires. Providers flush pending audio on a clean close.
pub async fn run(
    cfg: SttConfig,
    source: Source,
    audio: mpsc::Receiver<Vec<i16>>,
    events: mpsc::UnboundedSender<SttEvent>,
    cancel: tokio_util::sync::CancellationToken,
) {
    match cfg {
        SttConfig::Deepgram { api_key, model, language, endpoint } => {
            deepgram::run(&endpoint, &api_key, &model, &language, source, audio, events.clone(), cancel).await
        }
        SttConfig::WhisperCli { binary, model_path, language, work_dir } => {
            whisper_cli::run(&binary, &model_path, &language, &work_dir, source, audio, events.clone(), cancel)
                .await
        }
    }
    let _ = events.send(SttEvent::Closed { source });
}
