//! Configurable global keyboard shortcuts.

use crate::settings::Shortcuts;
use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Replace all registrations. Returns per-shortcut errors (e.g. a combination
/// already taken by another app) so the UI can show them.
pub fn apply(app: &AppHandle, s: &Shortcuts) -> Vec<String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let mut errors = Vec::new();
    let pairs = [
        ("toggle_meeting", &s.toggle_meeting),
        ("toggle_overlay", &s.toggle_overlay),
        ("suggest_reply", &s.suggest_reply),
        ("explain", &s.explain),
        ("screen_help", &s.screen_help),
    ];
    for (name, accel) in pairs {
        if accel.trim().is_empty() {
            continue;
        }
        let shortcut: Shortcut = match accel.parse() {
            Ok(sc) => sc,
            Err(e) => {
                errors.push(format!("{name}: \"{accel}\" is not a valid shortcut ({e})"));
                continue;
            }
        };
        let action = name.to_string();
        let res = gs.on_shortcut(shortcut, move |app, _sc, ev| {
            if ev.state() != ShortcutState::Pressed {
                return;
            }
            if action == "toggle_overlay" {
                let _ = crate::commands::toggle_overlay_inner(app);
            } else if action == "screen_help" {
                crate::screen::start_and_show(app);
            } else {
                let _ = app.emit_to("main", "shortcut", &action);
            }
        });
        if let Err(e) = res {
            errors.push(format!("{name}: could not register \"{accel}\" ({e})"));
        }
    }
    errors
}
