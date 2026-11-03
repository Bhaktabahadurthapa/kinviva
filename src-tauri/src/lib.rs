//! MeetingLens desktop backend.

pub mod assistant;
pub mod auto_assist;
pub mod audio;
pub mod commands;
pub mod db;
pub mod demo;
pub mod docs;
pub mod export;
pub mod llm;
pub mod meeting;
pub mod prompts;
pub mod question;
pub mod secrets;
pub mod settings;
pub mod shortcuts;
pub mod state;
pub mod stt;
pub mod transcript;

use state::AppState;
use std::sync::{Arc, Mutex};
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let db = db::Db::open(&data_dir.join("meetinglens.sqlite"))?;
            db.close_dangling_meetings()?;
            let state = AppState {
                db: Arc::new(db),
                data_dir,
                live: Arc::new(Mutex::new(state::Live::default())),
                session: tokio::sync::Mutex::new(None),
                ai_tasks: Mutex::new(Default::default()),
                questions: Arc::new(Mutex::new(question::QuestionDetector::new(20))),
                auto: Default::default(),
            };
            let settings = state.settings();
            app.manage(state);
            for err in shortcuts::apply(app.handle(), &settings.shortcuts) {
                eprintln!("shortcut: {err}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::list_input_devices,
            commands::set_secret,
            commands::delete_secret,
            commands::secret_status,
            commands::list_models,
            commands::start_meeting,
            commands::stop_meeting,
            commands::switch_mic,
            commands::get_snapshot,
            commands::set_live_notes,
            commands::ai_run,
            commands::ai_cancel,
            commands::list_meetings,
            commands::get_meeting,
            commands::rename_meeting,
            commands::delete_meeting,
            commands::export_meeting,
            commands::load_meeting_context,
            commands::create_demo_meeting,
            commands::add_document,
            commands::list_documents,
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
