//! API keys live in the OS credential store (macOS Keychain, Windows
//! Credential Manager). They are never written to SQLite, settings files or
//! logs, and are never returned to the web view.

const SERVICE: &str = "app.meetinglens.desktop";
pub const ALLOWED: &[&str] = &["deepgram_api_key", "llm_api_key"];

fn entry(name: &str) -> Result<keyring::Entry, String> {
    if !ALLOWED.contains(&name) {
        return Err(format!("Unknown secret \"{name}\""));
    }
    keyring::Entry::new(SERVICE, name).map_err(|e| format!("Credential store unavailable: {e}"))
}

pub fn set(name: &str, value: &str) -> Result<(), String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("Key is empty.".into());
    }
    entry(name)?.set_password(value).map_err(|e| format!("Could not save key: {e}"))
}

pub fn get(name: &str) -> Result<Option<String>, String> {
    match entry(name)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Could not read key: {e}")),
    }
}

pub fn delete(name: &str) -> Result<(), String> {
    match entry(name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Could not delete key: {e}")),
    }
}
