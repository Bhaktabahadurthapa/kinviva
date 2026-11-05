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
    pub screen_help: String,
}

impl Default for Shortcuts {
    fn default() -> Self {
        Self {
            toggle_meeting: "CommandOrControl+Shift+M".into(),
            toggle_overlay: "CommandOrControl+Shift+O".into(),
            suggest_reply: "CommandOrControl+Shift+R".into(),
            explain: "CommandOrControl+Shift+E".into(),
            screen_help: "CommandOrControl+Shift+S".into(),
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
    pub stt_provider: String, // "whisper_native" | "whisper_cli" | "deepgram"
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
    /// "auto" | "off" | "minimal" | "low" | "medium" | "high". How much a
    /// reasoning model thinks before answering; less is faster. "auto" asks
    /// Gemini for "minimal" (fastest) and sends nothing to other providers.
    pub llm_reasoning: String,
    pub context_chars: usize,
    pub use_documents: bool,
    /// Search the web (Tavily, with the user's own key) for answers. Off by default.
    pub web_search: bool,
    // Assist
    pub question_detection: bool,
    pub question_cooldown_secs: u32,
    /// "off" | "explain" | "explain_reply": answer automatically when others speak.
    pub auto_assist: String,
    /// Ignore utterances shorter than this many words (e.g. "okay", "right").
    pub auto_min_words: u32,
    // Overlay
    pub overlay_content_protection: bool,
    /// Show the floating answer overlay automatically while the main window is minimized or hidden.
    pub overlay_on_minimize: bool,
    /// Read the screen automatically when the other person asks you to explain something shown.
    pub screen_auto: bool,
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
            stt_provider: default_stt_provider(),
            deepgram_model: "nova-3".into(),
            deepgram_endpoint: crate::stt::deepgram::DEFAULT_ENDPOINT.into(),
            language: "en".into(),
            whisper_cli_path: default_whisper_cli(),
            whisper_model_path: String::new(),
            llm_base_url: "https://api.openai.com/v1".into(),
            llm_model: String::new(),
            llm_use_api_key: true,
            llm_temperature: 0.3,
            llm_reasoning: "auto".into(),
            context_chars: 6000,
            use_documents: true,
            web_search: false,
            question_detection: false,
            question_cooldown_secs: 20,
            auto_assist: "explain_reply".into(),
            auto_min_words: 6,
            overlay_content_protection: false,
            overlay_on_minimize: true,
            screen_auto: false,
            shortcuts: Shortcuts::default(),
        }
    }
}

/// Fresh installs use the bundled on-device engine when this build has it
/// (nothing leaves the computer); otherwise Deepgram, which needs a key.
fn default_stt_provider() -> String {
    if crate::stt::native::locate_helper().is_some() { "whisper_native" } else { "deepgram" }.into()
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
    /// The `reasoning_effort` to send, if any (see `llm_reasoning`).
    pub fn reasoning_effort(&self) -> Option<String> {
        match self.llm_reasoning.as_str() {
            "minimal" | "low" | "medium" | "high" => Some(self.llm_reasoning.clone()),
            "auto" if self.llm_base_url.contains("generativelanguage.googleapis.com") => Some("minimal".into()),
            _ => None,
        }
    }

    /// True when the configured LLM endpoint is on this machine.
    pub fn llm_is_local(&self) -> bool {
        url::Url::parse(&self.llm_base_url)
            .ok()
            .and_then(|u| u.host_str().map(|h| matches!(h, "localhost" | "127.0.0.1" | "::1" | "[::1]")))
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reasoning_effort_defaults_to_low_only_for_gemini() {
        let mut s = Settings::default();
        assert_eq!(s.reasoning_effort(), None);
        s.llm_base_url = "https://generativelanguage.googleapis.com/v1beta/openai".into();
        assert_eq!(s.reasoning_effort(), Some("minimal".into()));
        s.llm_reasoning = "off".into();
        assert_eq!(s.reasoning_effort(), None);
        s.llm_reasoning = "high".into();
        assert_eq!(s.reasoning_effort(), Some("high".into()));
    }
}
