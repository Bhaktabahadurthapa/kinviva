//! MeetingLens desktop backend.

pub mod architecture;
pub mod assistant;
pub mod auto_assist;
pub mod audio;
pub mod commands;
pub mod db;
pub mod demo;
pub mod discover;
pub mod docs;
pub mod export;
pub mod interview;
pub mod llm;
pub mod meeting;
pub mod prompts;
pub mod question;
pub mod screen;
pub mod secrets;
pub mod session;
pub mod settings;
pub mod skills;
pub mod shortcuts;
pub mod state;
pub mod store;
pub mod studio;
pub mod stt;
pub mod transcript;
pub mod websearch;

use state::AppState;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

/// Loads the bundled speech engine once in the background so macOS compiles
/// its GPU shaders now (about 15 s on the very first run) instead of during
/// the first meeting.
fn prime_speech_engine(settings: &settings::Settings) {
    if settings.stt_provider != "whisper_native" || !std::path::Path::new(&settings.whisper_model_path).is_file() {
        return;
    }
    let Some(path) = stt::native::locate_helper() else { return };
    let cfg = stt::native::Config {
        path,
        model: settings.whisper_model_path.clone(),
        language: settings.language.clone(),
        threads: 4,
        env: vec![],
        extra_load: serde_json::json!({}),
    };
    tauri::async_runtime::spawn(async move {
        match stt::native::prime(cfg).await {
            Ok(d) => log::info!("speech engine ready in {} ms", d.as_millis()),
            Err(e) => log::warn!("speech engine warm-up failed: {e}"),
        }
    });
}

/// What the overlay should do given the main window and the user's earlier choice.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct OverlayWatch {
    /// We opened the overlay because the main window went away.
    auto_shown: bool,
    /// The user closed the overlay during this absence; leave it closed until they come back.
    dismissed: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub enum OverlayStep {
    Nothing,
    Show,
    Hide,
}

impl OverlayWatch {
    /// `away`: main window minimized or hidden. `overlay_visible`: current overlay state.
    pub fn step(&mut self, enabled: bool, away: bool, overlay_visible: bool) -> OverlayStep {
        if !enabled {
            // Setting turned off: take back an overlay we opened, never one the user opened.
            let was = std::mem::take(&mut self.auto_shown);
            self.dismissed = false;
            return if was && overlay_visible { OverlayStep::Hide } else { OverlayStep::Nothing };
        }
        if away {
            if self.auto_shown && !overlay_visible {
                // The user closed it themselves.
                self.auto_shown = false;
                self.dismissed = true;
            }
            if !overlay_visible && !self.auto_shown && !self.dismissed {
                self.auto_shown = true;
                return OverlayStep::Show;
            }
            OverlayStep::Nothing
        } else {
            let was = std::mem::take(&mut self.auto_shown);
            self.dismissed = false;
            if was && overlay_visible { OverlayStep::Hide } else { OverlayStep::Nothing }
        }
    }
}

/// Refreshes Discover in the background about once an hour while it is turned on,
/// so new articles for the user's interests arrive without pressing Refresh.
fn auto_refresh_discover(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        const HOUR_MS: i64 = 3_600_000;
        let mut last_run: Option<std::time::Instant> = None;
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(120)).await;
            let state = app.state::<AppState>();
            let settings = state.settings();
            if !settings.discover_enabled {
                continue;
            }
            let now = commands::now_ms();
            let due = match last_run {
                Some(t) => t.elapsed() >= std::time::Duration::from_millis(HOUR_MS as u64),
                None => state.db.last_discover_fetch().ok().flatten().is_none_or(|t| now - t >= HOUR_MS),
            };
            if !due {
                continue;
            }
            last_run = Some(std::time::Instant::now());
            let report = discover::refresh(&state.db, &settings.interests, now).await;
            log::info!("Discover auto-refresh: {} new", report.added);
            let _ = app.emit("discover-updated", report.added);
        }
    });
}

/// Shows the answer overlay while the main window is minimized or hidden, and
/// hides it again when the window returns. An overlay the user opened by hand is left alone.
fn watch_main_window(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut watch = OverlayWatch::default();
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(400)).await;
            let Some(main) = app.get_webview_window("main") else { continue };
            let away = main.is_minimized().unwrap_or(false) || !main.is_visible().unwrap_or(true);
            let enabled = app.state::<AppState>().settings().overlay_on_minimize;
            let visible = app.get_webview_window("overlay").and_then(|w| w.is_visible().ok()).unwrap_or(false);
            match watch.step(enabled, away, visible) {
                OverlayStep::Show => {
                    if !commands::set_overlay_visible(&app, true) {
                        watch.auto_shown = false;
                    }
                }
                OverlayStep::Hide => {
                    commands::set_overlay_visible(&app, false);
                }
                OverlayStep::Nothing => {}
            }
        }
    });
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            // MEETINGLENS_DATA_DIR gives tests (or a portable setup) their own
            // database and settings without touching the real ones.
            let data_dir = match std::env::var_os("MEETINGLENS_DATA_DIR") {
                Some(dir) => std::path::PathBuf::from(dir),
                None => app.path().app_data_dir()?,
            };
            std::fs::create_dir_all(&data_dir)?;
            let db = db::Db::open(&data_dir.join("meetinglens.sqlite"))?;
            db.close_dangling_meetings()?;
            let state = AppState {
                paused: Default::default(),
                screen_cancel: Default::default(),
                db: Arc::new(db),
                data_dir,
                live: Arc::new(Mutex::new(state::Live::default())),
                session: tokio::sync::Mutex::new(None),
                ai_tasks: Mutex::new(Default::default()),
                auto_inflight: Mutex::new(Vec::new()),
                questions: Arc::new(Mutex::new(question::QuestionDetector::new(20))),
                auto: Default::default(),
                interview: Default::default(),
            };
            let mut settings = state.settings();
            if settings::migrate_overlay_protection(&mut settings) {
                let _ = state.save_settings(&settings);
            }
            app.manage(state);
            prime_speech_engine(&settings);
            if settings.overlay_content_protection {
                commands::apply_content_protection(app.handle(), true);
            }
            watch_main_window(app.handle().clone());
            auto_refresh_discover(app.handle().clone());
            for err in shortcuts::apply(app.handle(), &settings.shortcuts) {
                eprintln!("shortcut: {err}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::list_input_devices,
            commands::speech_engines,
            commands::set_secret,
            commands::delete_secret,
            commands::secret_status,
            commands::list_models,
            commands::start_meeting,
            commands::stop_meeting,
            commands::set_paused,
            commands::screen_read,
            commands::set_interview_live,
            commands::switch_mic,
            commands::get_snapshot,
            commands::set_live_notes,
            commands::ai_run,
            commands::ai_cancel,
            commands::interview_run,
            commands::architecture_generate,
            commands::studio_generate,
            commands::record_save,
            commands::record_list,
            commands::record_get,
            commands::record_delete,
            commands::board_snapshot,
            commands::board_revisions,
            commands::learning_list,
            commands::learning_save,
            commands::learning_delete,
            commands::quiz_record,
            commands::quiz_stats,
            commands::dashboard_stats,
            commands::discover_refresh,
            commands::discover_list,
            commands::discover_mark,
            commands::discover_trends,
            commands::open_external,
            commands::quiz_topics,
            commands::global_search,
            commands::architecture_save,
            commands::architecture_list,
            commands::architecture_delete,
            commands::architecture_write_file,
            commands::video_open,
            commands::video_bounds,
            commands::video_close,
            commands::clipboard_text,
            commands::video_in_browser,
            commands::interview_skills,
            commands::list_meetings,
            commands::get_meeting,
            commands::rename_meeting,
            commands::delete_meeting,
            commands::list_trash,
            commands::trash_meetings,
            commands::restore_meetings,
            commands::purge_meetings,
            commands::empty_trash,
            commands::export_meeting,
            commands::export_interview,
            commands::interview_saved_count,
            commands::clear_interview_entries,
            commands::load_meeting_context,
            commands::create_demo_meeting,
            commands::add_document,
            commands::list_documents,
            commands::list_courses,
            commands::create_course,
            commands::delete_course,
            commands::set_document_active,
            commands::delete_document,
            commands::preview_retrieval,
            commands::toggle_overlay,
            commands::show_main,
            commands::app_info,
        ])
        .on_window_event(|window, event| {
            // Closing the overlay hides it; closing the main window quits.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "overlay" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building MeetingLens")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                // Release audio devices and close provider connections on quit.
                let app = app.clone();
                tauri::async_runtime::block_on(async move {
                    let state = app.state::<AppState>();
                    let _ = meeting::stop(&app, &state).await;
                });
            }
        });
}

#[cfg(test)]
mod overlay_watch_tests {
    use super::*;

    #[test]
    fn opens_when_main_goes_away_and_closes_when_it_returns() {
        let mut w = OverlayWatch::default();
        assert_eq!(w.step(true, false, false), OverlayStep::Nothing);
        assert_eq!(w.step(true, true, false), OverlayStep::Show);
        assert_eq!(w.step(true, true, true), OverlayStep::Nothing, "stays open while away");
        assert_eq!(w.step(true, false, true), OverlayStep::Hide);
        assert_eq!(w.step(true, false, false), OverlayStep::Nothing);
    }

    #[test]
    fn an_overlay_the_user_closed_stays_closed_until_they_return() {
        let mut w = OverlayWatch::default();
        assert_eq!(w.step(true, true, false), OverlayStep::Show);
        assert_eq!(w.step(true, true, false), OverlayStep::Nothing, "user closed it");
        assert_eq!(w.step(true, true, false), OverlayStep::Nothing);
        assert_eq!(w.step(true, false, false), OverlayStep::Nothing);
        assert_eq!(w.step(true, true, false), OverlayStep::Show, "next time away it opens again");
    }

    #[test]
    fn a_manually_opened_overlay_is_never_closed_by_the_watcher() {
        let mut w = OverlayWatch::default();
        assert_eq!(w.step(true, true, true), OverlayStep::Nothing);
        assert_eq!(w.step(true, false, true), OverlayStep::Nothing);
    }

    #[test]
    fn turning_the_setting_off_does_nothing_but_takes_back_its_own_overlay() {
        let mut w = OverlayWatch::default();
        assert_eq!(w.step(false, true, false), OverlayStep::Nothing);
        assert_eq!(w.step(true, true, false), OverlayStep::Show);
        assert_eq!(w.step(false, true, true), OverlayStep::Hide);
    }
}
