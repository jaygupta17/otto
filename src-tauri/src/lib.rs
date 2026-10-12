mod local;
mod secrets;

/// Frontend diagnostics → terminal (debug builds only).
#[tauri::command]
fn dev_log(line: String) {
    if cfg!(debug_assertions) {
        println!("[webview] {line}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_websocket::init())
        .setup(|_app| {
            // In-app updates: desktop only. Phones update through their stores / the APK.
            #[cfg(desktop)]
            {
                _app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
                _app.handle().plugin(tauri_plugin_process::init())?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
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
        .run(tauri::generate_context!())
        .expect("error while running Otto");
}
