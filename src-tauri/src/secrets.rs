//! API keys live in the OS credential store (macOS Keychain, Windows
//! Credential Manager). They are never written to SQLite, settings files or
//! logs, and are never returned to the web view.

use std::collections::HashMap;
use std::sync::Mutex;

const SERVICE: &str = "app.kinviva.desktop";
/// The service name used before the product was renamed. Keys saved there are copied over the first time they are read.
const LEGACY_SERVICE: &str = "app.meetinglens.desktop";

/// Keys already read from the credential store in this run. macOS can ask for
/// the login password on every read, so each key is read once and kept in memory
/// (never written anywhere else).
static CACHE: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

fn cached(name: &str, load: impl FnOnce() -> Result<Option<String>, String>) -> Result<Option<String>, String> {
    let mut guard = CACHE.lock().unwrap();
    let map = guard.get_or_insert_with(HashMap::new);
    if let Some(v) = map.get(name) {
        return Ok(Some(v.clone()));
    }
    let loaded = load()?;
    if let Some(v) = &loaded {
        map.insert(name.to_string(), v.clone());
    }
    Ok(loaded)
}

fn forget(name: &str) {
    if let Some(map) = CACHE.lock().unwrap().as_mut() {
        map.remove(name);
    }
}
pub const ALLOWED: &[&str] = &["deepgram_api_key", "llm_api_key", "web_search_key", "firecrawl_api_key", "apify_api_token"];

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
    entry(name)?.set_password(value).map_err(|e| format!("Could not save key: {e}"))?;
    forget(name);
    Ok(())
}

pub fn get(name: &str) -> Result<Option<String>, String> {
    cached(name, || match entry(name)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => {
            // A key saved under the old product name moves to the new name the first time it is needed.
            let old = keyring::Entry::new(LEGACY_SERVICE, name).ok().and_then(|e| e.get_password().ok());
            if let Some(v) = &old {
                let _ = entry(name).and_then(|e| e.set_password(v).map_err(|x| x.to_string()));
            }
            Ok(old)
        }
        Err(e) => Err(format!("Could not read key: {e}")),
    })
}

pub fn delete(name: &str) -> Result<(), String> {
    forget(name);
    match entry(name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Could not delete key: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_key_is_read_from_the_credential_store_only_once() {
        let mut loads = 0;
        for _ in 0..3 {
            let v = cached("test_cache_key", || {
                loads += 1;
                Ok(Some("sk-test".into()))
            });
            assert_eq!(v, Ok(Some("sk-test".into())));
        }
        assert_eq!(loads, 1);
        forget("test_cache_key");
        let _ = cached("test_cache_key", || {
            loads += 1;
            Ok(None)
        });
        assert_eq!(loads, 2, "after a change the store is read again");
    }
}
