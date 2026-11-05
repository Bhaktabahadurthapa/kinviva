//! Runs an assist action: gathers recent transcript, notes and retrieved
//! document passages, streams the model's answer to both windows, and stores
//! the result with the meeting. Every action is user-initiated.

use crate::docs;
use crate::llm::{self, LlmConfig, LlmError};
use crate::prompts::{self, Action, PromptInput};
use crate::secrets;
use crate::state::{AiSlot, AppState};
use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tokio_util::sync::CancellationToken;

#[derive(Serialize, Clone)]
struct AiEvent<'a> {
    request_id: &'a str,
    slot: &'a str,
    #[serde(flatten)]
    data: &'a AiSlot,
}

fn publish(app: &AppHandle, state: &AppState, slot: &str, f: impl FnOnce(&mut AiSlot)) {
    let snapshot = {
        let mut live = state.live.lock().unwrap();
        let entry = live.ai.entry(slot.to_string()).or_default();
        f(entry);
        entry.clone()
    };
    let rid = snapshot.request_id.clone().unwrap_or_default();
    let _ = app.emit("ai-event", AiEvent { request_id: &rid, slot, data: &snapshot });
}

/// Automatic answers in flight per panel before the oldest is dropped.
const MAX_AUTO_IN_FLIGHT: usize = 3;

/// Like `publish`, but an automatic request keeps its own state (`local`) so
/// concurrent requests do not overwrite each other in the shared panel slot.
fn publish_to(app: &AppHandle, state: &AppState, slot: &str, local: &Option<Arc<Mutex<AiSlot>>>, f: impl FnOnce(&mut AiSlot)) {
    match local {
        None => publish(app, state, slot, f),
        Some(m) => {
            let snapshot = {
                let mut g = m.lock().unwrap();
                f(&mut g);
                g.clone()
            };
            let rid = snapshot.request_id.clone().unwrap_or_default();
            let _ = app.emit("ai-event", AiEvent { request_id: &rid, slot, data: &snapshot });
        }
    }
}

pub fn llm_config(state: &AppState) -> Result<LlmConfig, String> {
    let s = state.settings();
    let api_key = if s.llm_use_api_key {
        Some(secrets::get("llm_api_key")?.ok_or("Add your AI provider API key in Settings → AI.")?)
    } else {
        None
    };
    let reasoning_effort = s.reasoning_effort();
    Ok(LlmConfig { base_url: s.llm_base_url, model: s.llm_model, api_key, temperature: s.llm_temperature, reasoning_effort, json_mode: false })
}

pub fn start(app: &AppHandle, state: &AppState, action: Action, question: Option<String>) -> Result<String, String> {
    start_with(app, state, action, question, None, None)
}

/// `auto_for` is the transcript segment an auto-assist request answers (`None`
/// for a click); `focus` holds the new lines it should explain or answer.
pub fn start_with(
    app: &AppHandle,
    state: &AppState,
    action: Action,
    question: Option<String>,
    auto_for: Option<i64>,
    focus: Option<String>,
) -> Result<String, String> {
    let settings = state.settings();
    let cfg = llm_config(state)?;
    if action == Action::Ask && question.as_deref().map(str::trim).unwrap_or("").is_empty() {
        return Err("Type a question first.".into());
    }
    let slot = action.slot();
    let (transcript, notes, meeting_id) = {
        let live = state.live.lock().unwrap();
        let window = if action == Action::Recap { settings.context_chars * 2 } else { settings.context_chars };
        (
            live.transcript.recent_window(window),
            live.notes.clone(),
            live.status.meeting_id.clone().or(live.status.context_meeting_id.clone()),
        )
    };
    if action != Action::Ask && transcript.trim().is_empty() {
        return Err("Nothing has been transcribed yet.".into());
    }
    let passages = if settings.use_documents {
        let tail: String = transcript.chars().rev().take(600).collect::<Vec<_>>().into_iter().rev().collect();
        let q = docs::fts_query(
            &format!("{} {} {}", tail, focus.clone().unwrap_or_default(), question.clone().unwrap_or_default()),
            12,
        );
        state.db.search_passages(&q, 4).unwrap_or_default()
    } else {
        Vec::new()
    };
    let messages = prompts::build(&PromptInput {
        action,
        transcript: &transcript,
        notes: &notes,
        passages: &passages,
        question: question.as_deref(),
        focus: focus.as_deref(),
    });

    // A request the user asks for replaces the previous one in its panel.
    // Automatic ones answer different sentences, so they run side by side
    // (a few at most): cancelling each when the next sentence arrived meant
    // that none ever finished while someone kept talking.
    let request_id = uuid::Uuid::new_v4().to_string();
    let cancel = CancellationToken::new();
    let local: Option<Arc<Mutex<AiSlot>>> = auto_for.map(|_| Arc::new(Mutex::new(AiSlot::default())));
    {
        let mut tasks = state.ai_tasks.lock().unwrap();
        if local.is_none() {
            if let Some(prev) = state.live.lock().unwrap().ai.get(slot).and_then(|s| s.request_id.clone()) {
                if let Some(t) = tasks.remove(&prev) {
                    t.cancel();
                }
            }
        } else {
            let mut inflight = state.auto_inflight.lock().unwrap();
            inflight.push((slot.to_string(), request_id.clone()));
            let same: Vec<String> = inflight.iter().filter(|(s, _)| s == slot).map(|(_, r)| r.clone()).collect();
            for old in same.iter().take(same.len().saturating_sub(MAX_AUTO_IN_FLIGHT)) {
                if let Some(t) = tasks.remove(old) {
                    t.cancel();
                }
                inflight.retain(|(_, r)| r != old);
            }
        }
        tasks.insert(request_id.clone(), cancel.clone());
    }
    let destination = url::Url::parse(&cfg.base_url).ok().and_then(|u| u.host_str().map(String::from));
    let rid = request_id.clone();
    publish_to(app, state, slot, &local, |s| {
        *s = AiSlot {
            request_id: Some(rid),
            action: Some(action.as_str().into()),
            state: "streaming".into(),
            text: String::new(),
            error: None,
            sources: passages.clone(),
            destination,
            question: question.clone(),
            auto: auto_for.is_some(),
            segment_id: auto_for,
        }
    });

    let app2 = app.clone();
    let rid = request_id.clone();
    tauri::async_runtime::spawn(async move {
        let state = app2.state::<AppState>();
        let result = llm::stream_chat(&cfg, messages, cancel, |delta| {
            publish_to(&app2, &state, slot, &local, |s| {
                if s.request_id.as_deref() == Some(rid.as_str()) {
                    s.text.push_str(delta);
                }
            });
        })
        .await;
        state.ai_tasks.lock().unwrap().remove(&rid);
        state.auto_inflight.lock().unwrap().retain(|(_, r)| r != &rid);
        let current = |s: &AiSlot| s.request_id.as_deref() == Some(rid.as_str());
        let (status, text) = match &result {
            Ok(t) => ("done", t.clone()),
            Err(LlmError::Cancelled) => (
                "cancelled",
                match &local {
                    Some(m) => m.lock().unwrap().text.clone(),
                    None => state.live.lock().unwrap().ai.get(slot).map(|s| s.text.clone()).unwrap_or_default(),
                },
            ),
            Err(LlmError::Failed(_)) => ("error", String::new()),
        };
        publish_to(&app2, &state, slot, &local, |s| {
            if current(s) {
                s.state = status.into();
                if let Err(LlmError::Failed(m)) = &result {
                    s.error = Some(m.clone());
                }
            }
        });
        if status != "error" {
            let _ = state.db.add_ai_message(&rid, meeting_id.as_deref(), action.as_str(), question.as_deref(), &text, &cfg.model, status);
        }
    });
    Ok(request_id)
}

pub fn cancel(state: &AppState, request_id: &str) -> bool {
    match state.ai_tasks.lock().unwrap().remove(request_id) {
        Some(t) => {
            t.cancel();
            true
        }
        None => false,
    }
}
