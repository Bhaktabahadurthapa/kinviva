//! Tauri command handlers invoked from the web view.

use crate::assistant;
use crate::audio::cpal_capture;
use crate::db::{DocumentInfo, MeetingDetail, MeetingSummary, Passage};
use crate::meeting;
use crate::prompts::Action;
use crate::secrets;
use crate::settings::Settings;
use crate::state::{AppState, MeetingStatus, Snapshot};
use crate::{demo, docs, export, llm};
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, State};

type R<T> = Result<T, String>;

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Settings {
    state.settings()
}

#[derive(Serialize)]
pub struct SaveResult {
    shortcut_errors: Vec<String>,
}

#[tauri::command]
pub fn save_settings(app: AppHandle, state: State<AppState>, settings: Settings) -> R<SaveResult> {
    let before = state.settings();
    state.save_settings(&settings)?;
    let shortcut_errors = if before.shortcuts != settings.shortcuts {
        crate::shortcuts::apply(&app, &settings.shortcuts)
    } else {
        Vec::new()
    };
    if before.overlay_content_protection != settings.overlay_content_protection {
        apply_content_protection(&app, settings.overlay_content_protection);
    }
    let _ = app.emit("settings-changed", &settings);
    Ok(SaveResult { shortcut_errors })
}

#[derive(Serialize)]
pub struct SpeechEngines {
    /// This build includes the bundled on-device speech engine.
    native_available: bool,
}

#[tauri::command]
pub fn speech_engines() -> SpeechEngines {
    SpeechEngines { native_available: crate::stt::native::locate_helper().is_some() }
}

#[tauri::command]
pub fn list_input_devices() -> Vec<crate::audio::DeviceInfo> {
    cpal_capture::list_input_devices()
}

#[tauri::command]
pub fn set_secret(name: String, value: String) -> R<()> {
    secrets::set(&name, &value)
}

#[tauri::command]
pub fn delete_secret(name: String) -> R<()> {
    secrets::delete(&name)
}

/// Reports which secrets exist, never their values.
#[tauri::command]
pub fn secret_status() -> std::collections::HashMap<String, bool> {
    secrets::ALLOWED
        .iter()
        .map(|n| (n.to_string(), matches!(secrets::get(n), Ok(Some(_)))))
        .collect()
}

#[tauri::command]
pub async fn list_models(base_url: String, use_api_key: bool) -> R<Vec<String>> {
    let key = if use_api_key { secrets::get("llm_api_key")? } else { None };
    llm::list_models(&base_url, key.as_deref()).await
}

#[tauri::command]
pub async fn start_meeting(
    app: AppHandle,
    state: State<'_, AppState>,
    title: Option<String>,
    session_type: Option<crate::session::SessionKind>,
    course_id: Option<String>,
    week: Option<i64>,
) -> R<MeetingStatus> {
    let session = resolve_session(&state, session_type.unwrap_or_default(), course_id, week)?;
    meeting::start(&app, &state, title, session).await
}

/// Validates the chosen session. A Class session needs an existing course; the
/// course and week are ignored for Work and General.
pub fn resolve_session(state: &AppState, kind: crate::session::SessionKind, course_id: Option<String>, week: Option<i64>) -> R<crate::session::SessionInfo> {
    use crate::session::{SessionInfo, SessionKind, MAX_WEEK};
    if kind != SessionKind::Class {
        return Ok(SessionInfo { kind, ..Default::default() });
    }
    let id = course_id.filter(|c| !c.is_empty()).ok_or("Choose a course for this class session, or create one first.")?;
    let name = state.db.course_name(&id)?.ok_or("That course no longer exists. Choose another.")?;
    if week.is_some_and(|w| !(1..=MAX_WEEK).contains(&w)) {
        return Err(format!("Week must be between 1 and {MAX_WEEK}."));
    }
    Ok(SessionInfo { kind, course_id: Some(id), course_name: Some(name), week })
}

#[tauri::command]
pub fn list_courses(state: State<AppState>) -> R<Vec<crate::db::Course>> {
    state.db.list_courses()
}

#[tauri::command]
pub fn create_course(state: State<AppState>, name: String, code: Option<String>, term: Option<String>) -> R<crate::db::Course> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Give the course a name.".into());
    }
    if name.chars().count() > 120 {
        return Err("The course name is too long.".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    state.db.create_course(&id, name, code.as_deref().unwrap_or("").trim(), term.as_deref().unwrap_or("").trim())?;
    state.db.list_courses()?.into_iter().find(|c| c.id == id).ok_or_else(|| "Course was not saved.".into())
}

#[tauri::command]
pub fn delete_course(state: State<AppState>, id: String) -> R<()> {
    state.db.delete_course(&id)
}

#[tauri::command]
pub async fn stop_meeting(app: AppHandle, state: State<'_, AppState>) -> R<Option<String>> {
    meeting::stop(&app, &state).await
}

#[tauri::command]
pub async fn switch_mic(app: AppHandle, state: State<'_, AppState>, device: Option<String>) -> R<()> {
    let mut s = state.settings();
    s.mic_device = device.clone();
    state.save_settings(&s)?;
    meeting::switch_mic(&app, &state, device).await
}

#[tauri::command]
pub fn get_snapshot(state: State<AppState>) -> Snapshot {
    state.snapshot()
}

#[tauri::command]
pub fn set_live_notes(app: AppHandle, state: State<AppState>, notes: String) -> R<()> {
    let id = {
        let mut live = state.live.lock().unwrap();
        live.notes = notes.clone();
        live.status.meeting_id.clone().or(live.status.context_meeting_id.clone())
    };
    if let Some(id) = id {
        state.db.set_notes(&id, &notes)?;
    }
    let _ = app.emit("notes-changed", &notes);
    Ok(())
}

#[tauri::command]
pub fn ai_run(app: AppHandle, state: State<AppState>, action: Action, question: Option<String>) -> R<String> {
    assistant::start(&app, &state, action, question)
}

#[tauri::command]
pub fn interview_run(app: AppHandle, state: State<AppState>, request: crate::interview::Request) -> R<String> {
    crate::interview::start(&app, &state, request)
}

#[tauri::command]
pub fn interview_skills() -> Vec<crate::interview::SkillInfo> {
    crate::interview::skill_infos()
}

#[tauri::command]
pub fn ai_cancel(state: State<AppState>, request_id: String) -> bool {
    assistant::cancel(&state, &request_id)
}

#[tauri::command]
pub fn list_meetings(state: State<AppState>, search: Option<String>) -> R<Vec<MeetingSummary>> {
    state.db.list_meetings(search.as_deref())
}

#[tauri::command]
pub fn get_meeting(state: State<AppState>, id: String) -> R<MeetingDetail> {
    state.db.get_meeting(&id)
}

#[tauri::command]
pub fn rename_meeting(state: State<AppState>, id: String, title: String) -> R<()> {
    let title = title.trim();
    if title.is_empty() {
        return Err("Title cannot be empty.".into());
    }
    state.db.rename_meeting(&id, title)
}

#[tauri::command]
pub async fn delete_meeting(state: State<'_, AppState>, id: String) -> R<()> {
    if state.session.lock().await.as_ref().map(|s| s.meeting_id == id).unwrap_or(false) {
        return Err("Stop the meeting before deleting it.".into());
    }
    state.db.delete_meeting(&id)?;
    let _ = std::fs::remove_dir_all(state.data_dir.join("recordings").join(&id));
    Ok(())
}

#[tauri::command]
pub fn export_meeting(state: State<AppState>, id: String, format: String, path: String) -> R<String> {
    let m = state.db.get_meeting(&id)?;
    let body = match format.as_str() {
        "md" => export::to_markdown(&m),
        "txt" => export::to_text(&m),
        other => return Err(format!("Unknown export format \"{other}\".")),
    };
    std::fs::write(&path, body).map_err(|e| format!("Could not write file: {e}"))?;
    Ok(path)
}

/// Load a saved meeting into the assistant (idle only) so AI actions can use it.
#[tauri::command]
pub async fn load_meeting_context(app: AppHandle, state: State<'_, AppState>, id: String) -> R<()> {
    if state.session.lock().await.is_some() {
        return Err("Stop the current meeting first.".into());
    }
    let m = state.db.get_meeting(&id)?;
    let kind = match m.meeting.session_type.as_str() {
        "class" => crate::session::SessionKind::Class,
        "work" => crate::session::SessionKind::Work,
        _ => crate::session::SessionKind::General,
    };
    // A deleted course falls back to the general session instead of failing.
    let session = resolve_session(&state, kind, m.meeting.course_id.clone(), m.meeting.week).unwrap_or_default();
    {
        let mut live = state.live.lock().unwrap();
        live.status.session = session;
        live.transcript.clear();
        for s in m.segments {
            live.transcript.push_final(s);
        }
        live.notes = m.notes;
        live.ai.clear();
        live.status.context_meeting_id = Some(id);
        live.status.context_is_demo = m.meeting.is_demo;
        live.status.title = Some(m.meeting.title);
        live.status.meeting_id = None;
    }
    let _ = app.emit("snapshot-changed", ());
    meeting::emit_status(&app, &state.live);
    Ok(())
}

#[tauri::command]
pub fn create_demo_meeting(state: State<AppState>) -> R<String> {
    demo::create(&state.db)
}

#[tauri::command]
pub fn add_document(state: State<AppState>, path: String, course_id: Option<String>, week: Option<i64>) -> R<DocumentInfo> {
    let p = PathBuf::from(&path);
    let course_id = course_id.filter(|c| !c.is_empty());
    if let Some(c) = &course_id {
        state.db.course_name(c)?.ok_or("That course no longer exists.")?;
    }
    if week.is_some_and(|w| !(1..=crate::session::MAX_WEEK).contains(&w)) {
        return Err(format!("Week must be between 1 and {}.", crate::session::MAX_WEEK));
    }
    let extracted = docs::extract(&p)?;
    let chunks = docs::chunk_pages(&extracted);
    let id = uuid::Uuid::new_v4().to_string();
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("document").to_string();
    state.db.add_document(&id, &name, &extracted.kind, &path, &chunks, course_id.as_deref(), course_id.as_ref().and(week))?;
    state
        .db
        .list_documents()?
        .into_iter()
        .find(|d| d.id == id)
        .ok_or_else(|| "Document was not saved.".into())
}

#[tauri::command]
pub fn list_documents(state: State<AppState>) -> R<Vec<DocumentInfo>> {
    state.db.list_documents()
}

#[tauri::command]
pub fn set_document_active(state: State<AppState>, id: String, active: bool) -> R<()> {
    state.db.set_document_active(&id, active)
}

#[tauri::command]
pub fn delete_document(state: State<AppState>, id: String) -> R<()> {
    state.db.delete_document(&id)
}

/// Shows which passages would be retrieved for `text` (or the live transcript).
#[tauri::command]
pub fn preview_retrieval(state: State<AppState>, text: Option<String>) -> R<Vec<Passage>> {
    let text = text.filter(|t| !t.trim().is_empty()).unwrap_or_else(|| state.live.lock().unwrap().transcript.recent_window(600));
    state.db.search_passages(&docs::fts_query(&text, 12), 4)
}

/// Asks the OS to leave MeetingLens windows (main and overlay) out of screen
/// sharing and recording. Best effort: it sets the window-sharing flag
/// (`NSWindowSharingNone` on macOS, `WDA_EXCLUDEFROMCAPTURE` on Windows), which
/// some capture tools and OS versions ignore.
pub fn apply_content_protection(app: &AppHandle, on: bool) {
    for w in app.webview_windows().values() {
        let _ = w.set_content_protected(on);
    }
}

/// Shows or hides the overlay and tells the windows. Returns whether it changed.
pub fn set_overlay_visible(app: &AppHandle, visible: bool) -> bool {
    let Some(w) = app.get_webview_window("overlay") else { return false };
    if w.is_visible().unwrap_or(false) == visible {
        return false;
    }
    if visible {
        let protect = app.state::<AppState>().settings().overlay_content_protection;
        let _ = w.set_content_protected(protect);
        if w.show().is_err() {
            return false;
        }
        let _ = w.set_always_on_top(true);
    } else if w.hide().is_err() {
        return false;
    }
    let _ = app.emit("overlay-visibility", visible);
    true
}

pub fn toggle_overlay_inner(app: &AppHandle) -> R<bool> {
    let w = app.get_webview_window("overlay").ok_or("Overlay window missing.")?;
    let visible = w.is_visible().unwrap_or(false);
    if visible {
        w.hide().map_err(|e| e.to_string())?;
    } else {
        let protect = app.state::<AppState>().settings().overlay_content_protection;
        let _ = w.set_content_protected(protect);
        w.show().map_err(|e| e.to_string())?;
        let _ = w.set_always_on_top(true);
    }
    let _ = app.emit("overlay-visibility", !visible);
    Ok(!visible)
}

#[tauri::command]
pub fn toggle_overlay(app: AppHandle) -> R<bool> {
    toggle_overlay_inner(&app)
}

#[tauri::command]
pub fn show_main(app: AppHandle) -> R<()> {
    let w = app.get_webview_window("main").ok_or("Main window missing.")?;
    w.show().map_err(|e| e.to_string())?;
    w.set_focus().map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct AppInfo {
    version: String,
    data_dir: String,
    os: String,
    schema_version: i64,
}

#[tauri::command]
pub fn app_info(app: AppHandle, state: State<AppState>) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        data_dir: state.data_dir.display().to_string(),
        os: std::env::consts::OS.into(),
        schema_version: state.db.schema_version(),
    }
}
