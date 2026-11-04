//! User settings, stored as JSON in the SQLite `settings` table.
//! Secrets are not settings; see `secrets.rs`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Shortcuts {
    pub toggle_meeting: String,
    pub toggle_overlay: String,
    pub suggest_reply: String,
    pub explain: String,
}

impl Default for Shortcuts {
    fn default() -> Self {
        Self {
            toggle_meeting: "CommandOrControl+Shift+M".into(),
            toggle_overlay: "CommandOrControl+Shift+O".into(),
            suggest_reply: "CommandOrControl+Shift+R".into(),
            explain: "CommandOrControl+Shift+E".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Settings {
    pub onboarded: bool,
    // Audio
    pub capture_mic: bool,
    pub capture_system: bool,
    pub mic_device: Option<String>,
    pub save_audio: bool,
    // Speech-to-text
    pub stt_provider: String, // "deepgram" | "whisper_cli"
    pub deepgram_model: String,
    pub deepgram_endpoint: String,
    pub language: String,
    pub whisper_cli_path: String,
    pub whisper_model_path: String,
    // AI (OpenAI-compatible Chat Completions)
    pub llm_base_url: String,
    pub llm_model: String,
    pub llm_use_api_key: bool,
    pub llm_temperature: f32,
    pub context_chars: usize,
    pub use_documents: bool,
    // Assist
    pub question_detection: bool,
    pub question_cooldown_secs: u32,
    /// "off" | "explain" | "explain_reply": answer automatically when others speak.
    pub auto_assist: String,
    /// Ignore utterances shorter than this many words (e.g. "okay", "right").
    pub auto_min_words: u32,
    // Overlay
    pub overlay_content_protection: bool,
    pub shortcuts: Shortcuts,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            onboarded: false,
            capture_mic: true,
            capture_system: true,
            mic_device: None,
            save_audio: false,
            stt_provider: "deepgram".into(),
            deepgram_model: "nova-3".into(),
            deepgram_endpoint: crate::stt::deepgram::DEFAULT_ENDPOINT.into(),
            language: "en".into(),
            whisper_cli_path: default_whisper_cli(),
            whisper_model_path: String::new(),
            llm_base_url: "https://api.openai.com/v1".into(),
            llm_model: String::new(),
            llm_use_api_key: true,
            llm_temperature: 0.3,
            context_chars: 6000,
            use_documents: true,
            question_detection: false,
            question_cooldown_secs: 20,
            auto_assist: "explain_reply".into(),
            auto_min_words: 6,
            overlay_content_protection: false,
            shortcuts: Shortcuts::default(),
        }
    }
}

fn default_whisper_cli() -> String {
    #[cfg(windows)]
    {
        // whisper.cpp releases ship whisper-cli.exe; resolved via PATH unless set in Settings.
        "whisper-cli.exe".into()
    }
    #[cfg(not(windows))]
    {
        for p in ["/opt/homebrew/bin/whisper-cli", "/usr/local/bin/whisper-cli"] {
            if std::path::Path::new(p).exists() {
                return p.into();
            }
        }
        "whisper-cli".into()
    }
}

impl Settings {
    /// True when the configured LLM endpoint is on this machine.
    pub fn llm_is_local(&self) -> bool {
        url::Url::parse(&self.llm_base_url)
            .ok()
            .and_then(|u| u.host_str().map(|h| matches!(h, "localhost" | "127.0.0.1" | "::1" | "[::1]")))
            .unwrap_or(false)
    }
}
