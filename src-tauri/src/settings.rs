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
    // Profile (used by Discover and My Learning; stays on this computer)
    pub profile_name: String,
    pub profile_role: String,
    pub profile_level: String,
    pub interests: Vec<String>,
    /// Discover contacts the internet only after the user turns it on.
    pub discover_enabled: bool,
    /// Reading level of answers: simple | professional | student.
    pub answer_level: String,
    /// Length of answers: short | normal | detailed.
    pub answer_length: String,
    /// Who the user is and what they want in every answer (kept on this computer, added to prompts).
    pub about_me: String,
    /// The user's own instructions for each screen: meeting, interview, classroom, technical, presentation.
    pub screen_instructions: std::collections::BTreeMap<String, String>,
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
    /// Which service finds web pages for answers: "tavily" or "firecrawl". Papers (OpenAlex) are always searched when web_search is on.
    pub web_provider: String,
    /// Apify actor used to collect job listings, as "username~actor-name". Empty means not set up.
    pub apify_actor: String,
    /// JSON input sent to that actor. {{keywords}}, {{location}} and {{limit}} are filled in. Empty uses a common shape.
    pub apify_input: String,
    /// Most paid-provider calls (Firecrawl and Apify) Kinviva will make in one day.
    pub web_daily_limit: u32,
    // Assist
    pub question_detection: bool,
    pub question_cooldown_secs: u32,
    /// "off" | "explain" | "explain_reply": answer automatically when others speak.
    pub auto_assist: String,
    /// Ignore utterances shorter than this many words (e.g. "okay", "right").
    pub auto_min_words: u32,
    // Overlay
    pub overlay_content_protection: bool,
    /// Set once the one-time switch to "hidden from screen sharing by default" has been applied.
    pub overlay_protection_migrated: bool,
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
            profile_name: String::new(),
            profile_role: String::new(),
            profile_level: "intermediate".into(),
            interests: Vec::new(),
            discover_enabled: false,
            answer_level: "simple".into(),
            answer_length: "normal".into(),
            about_me: String::new(),
            screen_instructions: Default::default(),
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
            web_provider: "tavily".into(),
            apify_actor: String::new(),
            apify_input: String::new(),
            web_daily_limit: 20,
            question_detection: false,
            question_cooldown_secs: 20,
            auto_assist: "explain_reply".into(),
            auto_min_words: 6,
            overlay_content_protection: true,
            overlay_protection_migrated: false,
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

/// One-time change for settings saved before the overlay was hidden from screen sharing by default.
/// Returns true when it changed something (the caller saves). Someone who switches it off afterwards stays off.
pub fn migrate_overlay_protection(s: &mut Settings) -> bool {
    if s.overlay_protection_migrated {
        return false;
    }
    s.overlay_content_protection = true;
    s.overlay_protection_migrated = true;
    true
}

#[cfg(test)]
mod migration_tests {
    use super::*;

    #[test]
    fn old_settings_are_switched_to_hidden_once_and_new_ones_start_hidden() {
        let mut old: Settings = serde_json::from_str(r#"{"overlay_content_protection": false}"#).unwrap();
        assert!(!old.overlay_protection_migrated);
        old.overlay_content_protection = false; // as saved by an older version
        assert!(migrate_overlay_protection(&mut old));
        assert!(old.overlay_content_protection && old.overlay_protection_migrated);
        old.overlay_content_protection = false; // the person turns it off on purpose
        assert!(!migrate_overlay_protection(&mut old));
        assert!(!old.overlay_content_protection);
        assert!(Settings::default().overlay_content_protection);
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
