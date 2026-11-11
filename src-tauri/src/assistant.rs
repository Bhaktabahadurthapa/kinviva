//! Runs an assist action: gathers recent transcript, notes and retrieved
//! document passages, streams the model's answer to both windows, and stores
//! the result with the meeting. Every action is user-initiated.

use crate::docs;
use crate::llm::{self, LlmConfig, LlmError};
use crate::prompts::{self, Action, PromptInput};
use crate::secrets;
use crate::websearch;
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

/// Transcript characters sent with an automatic answer (clicks use the setting).
const AUTO_CONTEXT_CHARS: usize = 1800;
/// Background sent with an automatic explanation: just the few lines before the new sentence.
const AUTO_EXPLAIN_CHARS: usize = 600;

/// Automatic answers in flight per panel before the oldest is dropped.
const MAX_AUTO_IN_FLIGHT: usize = 2;

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
        Some(secrets::get("llm_api_key")?.ok_or("Add your answer engine API key in Settings → Answer engine.")?)
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
    let (transcript, notes, meeting_id, session) = {
        let live = state.live.lock().unwrap();
        // Automatic answers send less transcript: the new sentence matters most, and
        // a shorter prompt starts answering sooner.
        let window = if action == Action::Recap || action == Action::Ask {
            settings.context_chars * 2
        } else if auto_for.is_some() && action == Action::Explain {
            // Only the newest words matter; a long background made explanations keep returning to the main topic.
            AUTO_EXPLAIN_CHARS
        } else if auto_for.is_some() {
            settings.context_chars.min(AUTO_CONTEXT_CHARS)
        } else {
            settings.context_chars
        };
        (
            live.transcript.recent_window(window),
            live.notes.clone(),
            live.status.meeting_id.clone().or(live.status.context_meeting_id.clone()),
            live.status.session.clone(),
        )
    };
    if action != Action::Ask && transcript.trim().is_empty() {
        return Err("Nothing has been transcribed yet.".into());
    }
    // A class session always reads its course resources; the setting only
    // controls the general library.
    let passages = if settings.use_documents || session.is_class() {
        let tail: String = transcript.chars().rev().take(600).collect::<Vec<_>>().into_iter().rev().collect();
        let q = docs::fts_query(
            &format!("{} {} {}", tail, focus.clone().unwrap_or_default(), question.clone().unwrap_or_default()),
            12,
        );
        let limit = if session.is_class() { 6 } else { 4 };
        state.db.search_scoped(&q, limit, &session.scope()).unwrap_or_default()
    } else {
        Vec::new()
    };
    let about_meeting = action == Action::Ask && question.as_deref().map(prompts::about_conversation).unwrap_or(false);
    let web_query = if about_meeting { None } else { web_query_for(action, &transcript, focus.as_deref(), question.as_deref()) };
    // Technical questions get the matching bundled expert skill (Suggest and Ask only,
    // so the quick explanations stay fast). Class sessions keep their own instructions.
    let expert = if matches!(action, Action::Suggest | Action::Ask) && !session.is_class() && !about_meeting {
        let probe = question
            .clone()
            .filter(|q| !q.trim().is_empty())
            .or_else(|| focus.clone())
            .or_else(|| transcript.lines().rev().find(|l| l.starts_with("Them:")).map(String::from))
            .unwrap_or_default();
        crate::skills::detect_category(&probe).and_then(|c| crate::skills::skill_for(c).ok())
    } else {
        None
    };
    let mut messages = prompts::build_with_expert(&PromptInput {
        action,
        transcript: &transcript,
        notes: &notes,
        passages: &passages,
        question: question.as_deref(),
        focus: focus.as_deref(),
        session: &session,
    }, expert.map(|s| s.body.as_str()));
    if let Some(note) = prompts::style_note(action, &settings.answer_level, &settings.answer_length) {
        if let Some(user) = messages.last_mut() {
            user.content.push_str(&note);
        }
    }
    if let Some(note) = prompts::custom_note(&settings.about_me, &settings.screen_instructions, if session.is_class() { "classroom" } else { "meeting" }) {
        if let Some(user) = messages.last_mut() {
            user.content.push_str(&note);
        }
    }

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
            web: Vec::new(),
        }
    });

    let app2 = app.clone();
    let rid = request_id.clone();
    // What this answer responds to, kept so saved scripts make sense later.
    let asked = question
        .clone()
        .filter(|q| !q.trim().is_empty())
        .or_else(|| focus.clone().map(|f| f.lines().map(|l| l.trim_start_matches("Them:").trim()).collect::<Vec<_>>().join(" ")))
        .or_else(|| transcript.lines().rev().find(|l| l.starts_with("Them:")).map(|l| l.trim_start_matches("Them:").trim().to_string()));
    let passage_count = passages.len();
    let passage_list = passages.clone();
    let web_endpoint = settings.web_search.then_some(()).and(web_query);
    tauri::async_runtime::spawn(async move {
        let state = app2.state::<AppState>();
        let mut web_refs: Vec<crate::db::SourceRef> = Vec::new();
        if let Some(query) = web_endpoint {
            // Search the web first (optional); a failure never blocks the answer.
            match web_results(&query, &cancel).await {
                Ok(found) if !found.is_empty() => {
                    web_refs = found
                        .iter()
                        .map(|w| {
                            let host = url::Url::parse(&w.url).ok().and_then(|u| u.host_str().map(String::from)).unwrap_or_default();
                            crate::db::SourceRef { label: format!("{} ({})", w.title, host), url: Some(w.url.clone()) }
                        })
                        .collect();
                    if let Some(m) = messages.last_mut() {
                        m.content = format!("{}\n{}", websearch::prompt_block(&found, passage_count), m.content);
                    }
                    publish_to(&app2, &state, slot, &local, |s| {
                        if s.request_id.as_deref() == Some(rid.as_str()) {
                            s.web = found.clone();
                        }
                    });
                }
                Ok(_) => {}
                Err(e) if e == "cancelled" => {}
                Err(e) => report_web_error(&app2, e),
            }
        }
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
            // Only citations that match sources really given to the model are kept:
            // answers get a SOURCES section built here, explanations get inline citations.
            let labels = crate::session::source_labels(&passage_list, &web_refs);
            let style = if matches!(action, Action::Suggest | Action::Ask) { crate::session::CiteStyle::Section { complete: true } } else { crate::session::CiteStyle::Inline };
            let no_answer = crate::prompts::is_no_answer(&text);
            let norm = if no_answer || action == Action::Recap { crate::session::Normalized { text: text.clone(), cited: Vec::new() } } else { crate::session::normalize_answer(&text, &labels, style) };
            let _ = state.db.add_ai_message(&rid, meeting_id.as_deref(), action.as_str(), asked.as_deref(), &norm.text, &cfg.model, status);
            // Keep as references only the sources the answer really cited.
            if !no_answer {
                let refs: Vec<crate::db::SourceRef> = norm
                    .cited
                    .iter()
                    .filter_map(|&k| {
                        if k < passage_list.len() {
                            Some(crate::db::SourceRef { label: labels[k].clone(), url: None })
                        } else {
                            web_refs.get(k - passage_list.len()).cloned()
                        }
                    })
                    .collect();
                let _ = state.db.set_ai_message_sources(&rid, &refs);
            }
        }
    });
    Ok(request_id)
}

/// What to search for: only questions the user asks and answers they request are searched.
fn web_query_for(action: Action, transcript: &str, focus: Option<&str>, question: Option<&str>) -> Option<String> {
    if !matches!(action, Action::Suggest | Action::Ask) {
        return None;
    }
    let text = question
        .filter(|q| !q.trim().is_empty())
        .or(focus.filter(|f| !f.trim().is_empty()))
        .or_else(|| transcript.lines().rev().find(|l| l.starts_with("Them:")))?;
    let q = websearch::query_from(text);
    (!q.is_empty()).then_some(q)
}

/// General web results (Tavily, only when a key is saved) plus research papers (OpenAlex, no key).
/// Either part may fail without blocking the other; an error is returned only when nothing was found.
async fn web_results(query: &str, cancel: &CancellationToken) -> Result<Vec<websearch::WebSource>, String> {
    let key = secrets::get("web_search_key").ok().flatten();
    let web = async {
        match &key {
            Some(k) => websearch::search(websearch::DEFAULT_ENDPOINT, k, query, cancel).await,
            None => Ok(Vec::new()),
        }
    };
    let (web, papers) = tokio::join!(web, websearch::scholar_search(websearch::SCHOLAR_ENDPOINT, query, cancel));
    let mut out = Vec::new();
    let mut first_err = None;
    // Papers first: they are the stronger evidence.
    for r in [papers, web] {
        match r {
            Ok(mut v) => out.append(&mut v),
            Err(e) => first_err = first_err.or(Some(e)),
        }
    }
    match (out.is_empty(), first_err) {
        (true, Some(e)) => Err(e),
        _ => Ok(out),
    }
}

/// Each distinct web-search problem is reported once, not on every answer.
fn report_web_error(app: &AppHandle, e: String) {
    static LAST: Mutex<Option<String>> = Mutex::new(None);
    let mut last = LAST.lock().unwrap();
    if last.as_deref() != Some(e.as_str()) {
        let _ = app.emit("app-error", format!("Web search: {e}"));
        *last = Some(e);
    }
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
