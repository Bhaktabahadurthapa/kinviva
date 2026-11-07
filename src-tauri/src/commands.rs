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
pub async fn set_paused(app: AppHandle, state: State<'_, AppState>, paused: bool) -> R<()> {
    meeting::set_paused(&app, &state, paused).await
}

/// The Interview screen takes over answering interviewer questions while it is open.
#[tauri::command]
pub fn set_interview_live(state: State<AppState>, active: bool) {
    state.auto.interview_live.store(active, std::sync::atomic::Ordering::SeqCst);
    let secs = crate::auto_assist::question_cooldown(&state.settings(), &state.auto);
    state.questions.lock().unwrap().set_cooldown(secs);
}

/// Reads the screen and explains it (see `screen.rs`). Returns the request id.
#[tauri::command]
pub fn screen_read(app: AppHandle, state: State<AppState>) -> R<String> {
    crate::screen::start(&app, &state)
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

/// Builds an architecture model from the live transcript. The result is checked
/// (see `architecture::validate`); the front end turns it into Mermaid.
#[tauri::command]
pub async fn architecture_generate(state: State<'_, AppState>, request_id: String, hint: Option<String>) -> R<crate::architecture::Model> {
    let settings = state.settings();
    let mut cfg = assistant::llm_config(&state)?;
    cfg.json_mode = true;
    let transcript = state.live.lock().unwrap().transcript.recent_window(settings.context_chars * 2);
    if transcript.trim().is_empty() {
        return Err("Nothing has been transcribed yet. Start a meeting or open a saved one first.".into());
    }
    let passages = if settings.use_documents {
        let tail: String = transcript.chars().rev().take(900).collect::<Vec<_>>().into_iter().rev().collect();
        state.db.search_passages(&crate::docs::fts_query(&tail, 12), 4).unwrap_or_default()
    } else {
        Vec::new()
    };
    let documents = passages.iter().map(|p| p.text.as_str()).collect::<Vec<_>>().join("\n");
    let messages = crate::architecture::build_messages(&transcript, &passages, hint.as_deref().unwrap_or(""));
    let cancel = tokio_util::sync::CancellationToken::new();
    state.ai_tasks.lock().unwrap().insert(request_id.clone(), cancel.clone());
    let result = crate::llm::stream_chat(&cfg, messages, cancel, |_| {}).await;
    state.ai_tasks.lock().unwrap().remove(&request_id);
    match result {
        Ok(text) => crate::architecture::validate(&text, &transcript, &documents),
        Err(crate::llm::LlmError::Cancelled) => Err("Cancelled.".into()),
        Err(crate::llm::LlmError::Failed(m)) => Err(m),
    }
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Structured Copilot tools (technical explanations, troubleshooting plans, decisions, study
/// material, learning plans and so on). The result is validated before it is returned.
#[tauri::command]
pub async fn studio_generate(state: State<'_, AppState>, request_id: String, kind: String, input: Option<String>, meeting_id: Option<String>) -> R<String> {
    let kind = crate::studio::Kind::parse(&kind).ok_or("Unknown tool.")?;
    let settings = state.settings();
    let mut cfg = assistant::llm_config(&state)?;
    cfg.json_mode = kind.is_json();
    let input = input.unwrap_or_default();
    let (transcript, notes) = match meeting_id.as_deref() {
        Some(id) => {
            let d = state.db.get_meeting(id)?;
            let text = d.segments.iter().map(|s| format!("{}: {}", s.source.speaker_label(), s.text)).collect::<Vec<_>>().join("\n");
            (text.chars().rev().take(settings.context_chars * 3).collect::<Vec<_>>().into_iter().rev().collect::<String>(), d.notes)
        }
        None => {
            let live = state.live.lock().unwrap();
            (live.transcript.recent_window(settings.context_chars * 2), live.notes.clone())
        }
    };
    if kind.needs_transcript() && transcript.trim().is_empty() {
        return Err("Nothing has been transcribed yet. Start a session or open a saved one first.".into());
    }
    if !kind.needs_transcript() && transcript.trim().is_empty() && input.trim().is_empty() {
        return Err("Type or paste something to work from first.".into());
    }
    let passages = if settings.use_documents {
        let tail: String = transcript.chars().rev().take(600).collect::<Vec<_>>().into_iter().rev().collect();
        state.db.search_passages(&crate::docs::fts_query(&format!("{input} {tail}"), 14), 6).unwrap_or_default()
    } else {
        Vec::new()
    };
    let mut messages = crate::studio::build_messages(kind, &transcript, &notes, &passages, &input);
    if let Some(note) = crate::prompts::custom_note(&settings.about_me, &settings.screen_instructions, kind.screen()) {
        if let Some(system) = messages.first_mut() {
            system.content.push_str(&note);
        }
    }
    let cancel = tokio_util::sync::CancellationToken::new();
    state.ai_tasks.lock().unwrap().insert(request_id.clone(), cancel.clone());
    let result = crate::llm::stream_chat(&cfg, messages, cancel, |_| {}).await;
    state.ai_tasks.lock().unwrap().remove(&request_id);
    match result {
        Ok(text) => {
            // Quotes and numbers are checked against everything the model was shown.
            let evidence = format!("{transcript}\n{notes}\n{input}\n{}", passages.iter().map(|p| p.text.as_str()).collect::<Vec<_>>().join("\n"));
            crate::studio::post(kind, &text, &evidence)
        }
        Err(crate::llm::LlmError::Cancelled) => Err("Cancelled.".into()),
        Err(crate::llm::LlmError::Failed(m)) => Err(m),
    }
}

#[tauri::command]
pub fn record_save(state: State<AppState>, record: crate::store::Record) -> R<crate::store::Record> {
    state.db.save_record(&record, now_ms())
}

#[tauri::command]
pub fn record_list(state: State<AppState>, kind: String, search: Option<String>, meeting_id: Option<String>, with_body: Option<bool>) -> R<Vec<crate::store::Record>> {
    state.db.list_records(&kind, search.as_deref(), meeting_id.as_deref(), with_body.unwrap_or(true), 300)
}

#[tauri::command]
pub fn record_get(state: State<AppState>, id: String) -> R<Option<crate::store::Record>> {
    state.db.get_record(&id)
}

#[tauri::command]
pub fn record_delete(state: State<AppState>, id: String) -> R<()> {
    state.db.delete_record(&id)
}

/// Saves a restorable copy of a whiteboard (the newest 30 are kept).
#[tauri::command]
pub fn board_snapshot(state: State<AppState>, board_id: String, label: String, scene: String) -> R<()> {
    let rec = crate::store::Record { id: uuid::Uuid::new_v4().to_string(), kind: "board_rev".into(), title: label.chars().take(120).collect(), body: scene, meta: Some(board_id.clone()), meeting_id: None, created_at: 0, updated_at: 0 };
    state.db.save_record(&rec, now_ms())?;
    state.db.trim_revisions(&board_id, 30)
}

#[tauri::command]
pub fn board_revisions(state: State<AppState>, board_id: String) -> R<Vec<crate::store::Record>> {
    state.db.list_revisions(&board_id)
}

#[tauri::command]
pub fn learning_list(state: State<AppState>) -> R<Vec<crate::store::LearningItem>> {
    state.db.list_learning()
}

#[tauri::command]
pub fn learning_save(state: State<AppState>, item: crate::store::LearningItem) -> R<crate::store::LearningItem> {
    state.db.save_learning(&item, now_ms())
}

#[tauri::command]
pub fn learning_delete(state: State<AppState>, id: String) -> R<()> {
    state.db.delete_learning(&id)
}

#[tauri::command]
pub fn quiz_record(state: State<AppState>, topic: String, total: i64, correct: i64) -> R<()> {
    state.db.add_quiz_attempt(&topic, total, correct, now_ms())
}

#[tauri::command]
pub fn quiz_stats(state: State<AppState>) -> R<crate::store::QuizStats> {
    state.db.quiz_stats()
}

/// Downloads the followed feeds and repositories. Only runs when the user turned Discover on.
#[tauri::command]
pub async fn discover_refresh(state: State<'_, AppState>) -> R<crate::discover::RefreshReport> {
    let settings = state.settings();
    if !settings.discover_enabled {
        return Err("Turn Discover on first. It contacts the sources listed on this page.".into());
    }
    Ok(crate::discover::refresh(&state.db, &settings.interests, now_ms()).await)
}

#[tauri::command]
pub fn discover_list(state: State<AppState>, kind: Option<String>, saved_only: Option<bool>) -> R<(Vec<crate::discover::DiscoverItem>, Option<i64>)> {
    let items = state.db.list_discover(kind.as_deref(), saved_only.unwrap_or(false), &state.settings().interests, now_ms())?;
    Ok((items, state.db.last_discover_fetch()?))
}

#[tauri::command]
pub fn discover_mark(state: State<AppState>, id: String, field: String, value: bool) -> R<()> {
    state.db.mark_discover(&id, &field, value)
}

#[tauri::command]
pub fn discover_trends(state: State<AppState>) -> R<Vec<crate::discover::Trend>> {
    state.db.discover_trends(now_ms())
}

/// Opens a link from Discover in the default browser. Only links that are stored in Discover can be opened.
#[tauri::command]
pub fn open_external(state: State<AppState>, url: String) -> R<()> {
    if !url.starts_with("https://") || !state.db.discover_has_url(&url)? {
        return Err("That link cannot be opened from here.".into());
    }
    #[cfg(target_os = "macos")]
    let mut cmd = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut cmd = { let mut c = std::process::Command::new("cmd"); c.args(["/C", "start", ""]); c };
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let mut cmd = std::process::Command::new("xdg-open");
    cmd.arg(&url).spawn().map(|_| ()).map_err(|e| format!("Could not open the link: {e}"))
}

#[tauri::command]
pub fn quiz_topics(state: State<AppState>) -> R<Vec<crate::store::TopicScore>> {
    state.db.quiz_topics()
}

#[tauri::command]
pub fn dashboard_stats(state: State<AppState>) -> R<crate::store::Stats> {
    state.db.stats(now_ms())
}

#[tauri::command]
pub fn global_search(state: State<AppState>, query: String) -> R<Vec<crate::store::SearchHit>> {
    let mut hits = state.db.global_search(&query, 6)?;
    // Inside the text of the user's documents (the existing full-text index).
    let fts = crate::docs::fts_query(&query, 8);
    for p in state.db.search_passages(&fts, 4).unwrap_or_default() {
        let text: String = p.text.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(160).collect();
        hits.push(crate::store::SearchHit { kind: "document".into(), id: p.document.clone(), title: match p.page { Some(n) => format!("{} (page {n})", p.document), None => p.document.clone() }, snippet: text, when: 0 });
    }
    Ok(hits)
}

#[tauri::command]
pub fn architecture_save(state: State<AppState>, diagram: crate::db::DiagramRecord) -> R<()> {
    // Limits keep one saved diagram small; the front end already validated the source.
    if diagram.source.len() > 20_000 || diagram.model.as_ref().is_some_and(|m| m.len() > 60_000) {
        return Err("That diagram is too large to save.".into());
    }
    state.db.add_diagram(&diagram)
}

#[tauri::command]
pub fn architecture_list(state: State<AppState>, meeting_id: Option<String>) -> R<Vec<crate::db::DiagramRecord>> {
    state.db.list_diagrams(meeting_id.as_deref(), 100)
}

#[tauri::command]
pub fn architecture_delete(state: State<AppState>, id: String) -> R<()> {
    state.db.delete_diagram(&id)
}

/// Writes an exported diagram (SVG or PNG, base64) to a path the user chose in the save dialog.
#[tauri::command]
pub fn architecture_write_file(path: String, data_base64: String) -> R<()> {
    use base64::Engine;
    let lower = path.to_lowercase();
    if !(lower.ends_with(".svg") || lower.ends_with(".png") || lower.ends_with(".pptx") || lower.ends_with(".csv") || lower.ends_with(".md")) {
        return Err("Files can only be exported as .svg, .png, .pptx, .csv or .md.".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD.decode(data_base64).map_err(|e| e.to_string())?;
    if bytes.len() > 40 * 1024 * 1024 {
        return Err("That image is too large.".into());
    }
    std::fs::write(&path, bytes).map_err(|e| format!("Could not save the file: {e}"))
}

// ---- Video pane: a real web page shown inside the main window -------------------------------------

const VIDEO_LABEL: &str = "video-pane";

/// Turns what the user pasted into an address that plays the video: YouTube short links and
/// "shorts" become a normal watch page; any other https page is used as it is.
pub fn video_address(input: &str) -> Result<String, String> {
    let t = input.trim();
    let t = if t.contains("://") { t.to_string() } else { format!("https://{t}") };
    let url = url::Url::parse(&t).map_err(|_| "That does not look like a web address.".to_string())?;
    if url.scheme() != "https" {
        return Err("Only secure https links can be opened here.".into());
    }
    let host = url.host_str().unwrap_or("").to_lowercase();
    if host.is_empty() || host == "localhost" || host.parse::<std::net::IpAddr>().is_ok() || !host.contains('.') {
        return Err("Paste the link of a video page, for example from YouTube.".into());
    }
    let id = if host == "youtu.be" {
        url.path_segments().and_then(|mut p| p.next()).map(str::to_string)
    } else if host.ends_with("youtube.com") {
        let seg = url.path_segments().map(|p| p.collect::<Vec<_>>()).unwrap_or_default();
        match seg.first().copied() {
            Some("shorts") | Some("embed") | Some("live") => seg.get(1).map(|x| x.to_string()),
            Some("watch") => url.query_pairs().find(|(k, _)| k == "v").map(|(_, v)| v.to_string()),
            _ => None,
        }
    } else {
        None
    };
    match id.filter(|i| !i.is_empty() && i.len() <= 20 && i.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')) {
        Some(id) => Ok(format!("https://www.youtube.com/watch?v={id}")),
        None => Ok(url.to_string()),
    }
}

/// The YouTube video id inside a normalised watch address.
fn youtube_id(address: &str) -> Option<String> {
    address.strip_prefix("https://www.youtube.com/watch?v=").map(str::to_string)
}

/// A tiny local page (127.0.0.1 only) that shows just the YouTube player, with no recommendations or comments around it.
fn player_port() -> Result<u16, String> {
    use std::io::{Read, Write};
    static PORT: std::sync::Mutex<Option<u16>> = std::sync::Mutex::new(None);
    let mut guard = PORT.lock().unwrap();
    if let Some(p) = *guard {
        return Ok(p);
    }
    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| format!("Could not start the player: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let mut stream = stream;
            let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(2)));
            let mut buf = [0u8; 2048];
            let n = stream.read(&mut buf).unwrap_or(0);
            let req = String::from_utf8_lossy(&buf[..n]);
            let id = req
                .lines()
                .next()
                .and_then(|l| l.strip_prefix("GET /p?v="))
                .and_then(|r| r.split_whitespace().next())
                .filter(|i| !i.is_empty() && i.len() <= 20 && i.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
            let (status, body) = match id {
                Some(id) => (
                    "200 OK",
                    format!(
                        "<!doctype html><meta charset=utf-8><meta name=viewport content=\"width=device-width,initial-scale=1\"><title>Video</title><style>html,body{{margin:0;height:100%;background:#000;overflow:hidden}}iframe{{border:0;width:100%;height:100%}}</style><iframe src=\"https://www.youtube-nocookie.com/embed/{id}?autoplay=1&rel=0&playsinline=1&origin=http://127.0.0.1:{port}\" allow=\"autoplay; encrypted-media; picture-in-picture; fullscreen\" allowfullscreen referrerpolicy=\"strict-origin-when-cross-origin\"></iframe>"
                    ),
                ),
                None => ("404 Not Found", "Not found".to_string()),
            };
            let _ = write!(stream, "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}", body.len());
        }
    });
    *guard = Some(port);
    Ok(port)
}

fn video_rect(x: f64, y: f64, w: f64, h: f64) -> (tauri::LogicalPosition<f64>, tauri::LogicalSize<f64>) {
    (tauri::LogicalPosition::new(x.max(0.0), y.max(0.0)), tauri::LogicalSize::new(w.max(80.0), h.max(60.0)))
}

/// Opens (or changes) the video page in a pane laid over the given area of the main window.
#[tauri::command]
pub fn video_open(app: AppHandle, url: String, full_page: bool, x: f64, y: f64, w: f64, h: f64) -> R<String> {
    let address = video_address(&url)?;
    // By default a YouTube link opens in a clean player; "full page" shows the whole YouTube page instead.
    let shown = match youtube_id(&address).filter(|_| !full_page) {
        Some(id) => format!("http://127.0.0.1:{}/p?v={id}", player_port()?),
        None => address.clone(),
    };
    let parsed: url::Url = shown.parse().map_err(|_| "That does not look like a web address.".to_string())?;
    let (pos, size) = video_rect(x, y, w, h);
    if let Some(v) = app.get_webview(VIDEO_LABEL) {
        v.navigate(parsed).map_err(|e| e.to_string())?;
        v.set_position(pos).map_err(|e| e.to_string())?;
        v.set_size(size).map_err(|e| e.to_string())?;
        return Ok(address);
    }
    let window = app.get_window("main").ok_or("The main window is not available.")?;
    #[cfg(target_os = "macos")]
    let ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
    #[cfg(not(target_os = "macos"))]
    let ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0";
    let builder = tauri::webview::WebviewBuilder::new(VIDEO_LABEL, tauri::WebviewUrl::External(parsed)).user_agent(ua);
    window.add_child(builder, pos, size).map_err(|e| format!("Could not open the video pane: {e}"))?;
    Ok(address)
}

/// Keeps the video pane over the area it belongs to when the window or layout changes.
#[tauri::command]
pub fn video_bounds(app: AppHandle, x: f64, y: f64, w: f64, h: f64) -> R<()> {
    if let Some(v) = app.get_webview(VIDEO_LABEL) {
        let (pos, size) = video_rect(x, y, w, h);
        v.set_position(pos).map_err(|e| e.to_string())?;
        v.set_size(size).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Closes the video pane (the page stops playing).
#[tauri::command]
pub fn video_close(app: AppHandle) -> R<()> {
    if let Some(v) = app.get_webview(VIDEO_LABEL) {
        v.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(serde::Serialize)]
pub struct VideoInfo {
    pub title: String,
    pub channel: String,
}

/// The title and channel of a YouTube video, from YouTube's public oEmbed address. Other sites return nothing.
#[tauri::command]
pub async fn video_info(url: String) -> R<Option<VideoInfo>> {
    let address = video_address(&url)?;
    if !address.starts_with("https://www.youtube.com/watch?v=") {
        return Ok(None);
    }
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(6)).user_agent("Kinviva").build().map_err(|e| e.to_string())?;
    let r = client.get("https://www.youtube.com/oembed").query(&[("url", address.as_str()), ("format", "json")]).send().await;
    let Ok(r) = r else { return Ok(None) };
    if !r.status().is_success() {
        return Ok(None);
    }
    let v: serde_json::Value = r.json().await.map_err(|e| e.to_string())?;
    let t = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").chars().take(160).collect::<String>();
    Ok(Some(VideoInfo { title: t("title"), channel: t("author_name") }))
}

/// Hides or shows the video pane (it is a native layer above the page, so dialogs need it out of the way).
#[tauri::command]
pub fn video_visible(app: AppHandle, visible: bool) -> R<()> {
    if let Some(v) = app.get_webview(VIDEO_LABEL) {
        if visible { v.show() } else { v.hide() }.map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// The text on the clipboard, for the "Paste" button (the web view itself is not allowed to read it).
#[tauri::command]
pub fn clipboard_text() -> R<String> {
    #[cfg(target_os = "macos")]
    let out = std::process::Command::new("pbpaste").output();
    #[cfg(target_os = "windows")]
    let out = std::process::Command::new("powershell").args(["-NoProfile", "-Command", "Get-Clipboard -Raw"]).output();
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let out = std::process::Command::new("xclip").args(["-selection", "clipboard", "-o"]).output();
    let out = out.map_err(|_| "The clipboard could not be read. Paste the link into the box instead.".to_string())?;
    Ok(String::from_utf8_lossy(&out.stdout).trim().chars().take(2000).collect())
}

/// Opens a pasted video link in the default browser (a fallback when the in-app pane cannot play it).
#[tauri::command]
pub fn video_in_browser(url: String) -> R<()> {
    let address = video_address(&url)?;
    #[cfg(target_os = "macos")]
    let mut cmd = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut cmd = { let mut c = std::process::Command::new("rundll32"); c.arg("url.dll,FileProtocolHandler"); c };
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let mut cmd = std::process::Command::new("xdg-open");
    cmd.arg(&address).spawn().map(|_| ()).map_err(|e| format!("Could not open the link: {e}"))
}

/// What Kinviva adds to the prompts of a screen because of the user's own instructions, so nothing is hidden.
#[tauri::command]
pub fn instructions_preview(state: State<AppState>, screen: String) -> R<String> {
    let s = state.settings();
    if !crate::prompts::SCREENS.contains(&screen.as_str()) {
        return Err("Unknown screen.".into());
    }
    let mut out = crate::prompts::custom_note(&s.about_me, &s.screen_instructions, &screen).unwrap_or_default();
    if screen == "meeting" || screen == "classroom" {
        out.push_str(&format!("\n\nAnswer level: {}. Answer length: {}.", s.answer_level, s.answer_length));
    }
    Ok(if out.trim().is_empty() { "Nothing is added. Answers use Kinviva's own rules only.".to_string() } else { out.trim().to_string() })
}

#[tauri::command]
pub fn edition_info() -> crate::edition::EditionInfo {
    crate::edition::info()
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
pub fn list_trash(state: State<AppState>) -> R<Vec<MeetingSummary>> {
    state.db.list_trash()
}

/// Moves sessions to the Trash (they can be restored).
#[tauri::command]
pub async fn trash_meetings(state: State<'_, AppState>, ids: Vec<String>) -> R<usize> {
    if let Some(active) = state.session.lock().await.as_ref().map(|s| s.meeting_id.clone()) {
        if ids.contains(&active) {
            return Err("Stop the running meeting before deleting it.".into());
        }
    }
    state.db.trash_meetings(&ids, now_ms())
}

#[tauri::command]
pub fn restore_meetings(state: State<AppState>, ids: Vec<String>) -> R<usize> {
    state.db.restore_meetings(&ids)
}

/// Erases sessions in the Trash for good, with their saved audio. Sessions not in the Trash are never touched.
#[tauri::command]
pub fn purge_meetings(state: State<AppState>, ids: Vec<String>, with_linked: bool) -> R<usize> {
    let doomed = state.db.trashed_ids(&ids, false)?;
    let n = state.db.purge_meetings(&doomed, with_linked)?;
    for id in &doomed {
        let _ = std::fs::remove_dir_all(state.data_dir.join("recordings").join(id));
    }
    Ok(n)
}

#[tauri::command]
pub fn empty_trash(state: State<AppState>, with_linked: bool) -> R<usize> {
    let all = state.db.trashed_ids(&[], true)?;
    let n = state.db.purge_meetings(&all, with_linked)?;
    for id in &all {
        let _ = std::fs::remove_dir_all(state.data_dir.join("recordings").join(id));
    }
    Ok(n)
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
    let bytes = export::render(&export::meeting_doc(&m), &format)?;
    std::fs::write(&path, bytes).map_err(|e| format!("Could not write file: {e}"))?;
    Ok(path)
}

/// Saves interview practice notes. `since_ms` limits it to one practice session.
#[tauri::command]
pub fn export_interview(state: State<AppState>, format: String, path: String, since_ms: Option<i64>) -> R<String> {
    let entries = state.db.list_interview_entries(since_ms)?;
    if entries.is_empty() {
        return Err("Nothing to save yet. Explain or practise an answer first.".into());
    }
    let bytes = export::render(&export::interview_doc(&entries), &format)?;
    std::fs::write(&path, bytes).map_err(|e| format!("Could not write file: {e}"))?;
    Ok(path)
}

#[tauri::command]
pub fn interview_saved_count(state: State<AppState>, since_ms: Option<i64>) -> R<usize> {
    Ok(state.db.list_interview_entries(since_ms)?.len())
}

#[tauri::command]
pub fn clear_interview_entries(state: State<AppState>, since_ms: Option<i64>) -> R<()> {
    state.db.delete_interview_entries(since_ms)
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

/// Asks the OS to leave Kinviva windows (main and overlay) out of screen
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

#[cfg(test)]
mod video_tests {
    use super::video_address;
    #[test]
    fn video_links_become_watch_pages_and_unsafe_ones_are_refused() {
        assert_eq!(video_address("https://youtu.be/dQw4w9WgXcQ?t=5").unwrap(), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
        assert_eq!(video_address("youtube.com/shorts/abc_DEF-123").unwrap(), "https://www.youtube.com/watch?v=abc_DEF-123");
        assert_eq!(video_address("https://www.youtube.com/watch?v=abc123&list=x").unwrap(), "https://www.youtube.com/watch?v=abc123");
        assert_eq!(video_address("https://vimeo.com/12345").unwrap(), "https://vimeo.com/12345");
        for bad in ["http://example.com/a", "javascript:alert(1)", "file:///etc/passwd", "https://localhost/x", "https://127.0.0.1/x", "hello", ""] {
            assert!(video_address(bad).is_err(), "{bad}");
        }
    }
}
