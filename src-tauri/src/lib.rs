mod kv;
mod local;
mod secrets;

/// The app id before 0.8 (it claimed a domain we don't own).
#[allow(dead_code)]
pub(crate) const OLD_ID: &str = "dev.otto.app";

/// Frontend diagnostics → terminal (debug builds only).
#[tauri::command]
fn dev_log(line: String) {
    if cfg!(debug_assertions) {
        println!("[webview] {line}");
    }
}

/// The app id names the data folder, so 0.8 starts in an empty one. Move the old
/// folder's contents (settings store, managed OpenCode) across, once. Entries that
/// can't move (e.g. a running binary on Windows) stay behind; Otto finds or
/// fetches OpenCode again.
#[cfg(desktop)]
fn adopt_old_data(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Ok(new) = app.path().app_data_dir() else { return };
    let Some(old) = new.parent().map(|p| p.join(OLD_ID)) else { return };
    if new.join("otto.json").exists() || !old.join("otto.json").exists() {
        return;
    }
    if std::fs::create_dir_all(&new).is_err() {
        return;
    }
    let Ok(entries) = std::fs::read_dir(&old) else { return };
    for e in entries.flatten() {
        let to = new.join(e.file_name());
        if !to.exists() && std::fs::rename(e.path(), &to).is_err() && e.path().is_file() {
            let _ = std::fs::copy(e.path(), &to);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_websocket::init())
        .manage(kv::Kv::default())
        .setup(|_app| {
            #[cfg(desktop)]
            adopt_old_data(_app.handle());
            // In-app updates: desktop only. Phones update through their stores / the APK.
            #[cfg(desktop)]
            {
                _app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
                _app.handle().plugin(tauri_plugin_process::init())?;
            }
            Ok(())
        })
        // macOS: closing the window (⌘W, red button) hides it like other Mac apps;
        // clicking the Dock icon brings it back. ⌘Q still quits.
        .on_window_event(|_window, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::WindowEvent::CloseRequested { api, .. } = _event {
                if _window.label() == "main" {
                    api.prevent_close();
                    let _ = _window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            kv::kv_get,
            kv::kv_set,
            kv::kv_delete,
            secrets::secret_get,
            secrets::secret_set,
            secrets::secret_delete,
            secrets::secret_backend,
            local::local_find_opencode,
            local::local_install_opencode,
            local::local_free_port,
            local::local_start_server,
            local::local_server_log,
            local::local_stop_server,
            dev_log
        ])
        .build(tauri::generate_context!())
        .expect("error while building Otto")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                use tauri::Manager;
                if let Some(w) = _app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                }
            }
        });
}
