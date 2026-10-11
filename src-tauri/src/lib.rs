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
        .invoke_handler(tauri::generate_handler![
            secrets::secret_get,
            secrets::secret_set,
            secrets::secret_delete,
            secrets::secret_backend,
            dev_log
        ])
        .run(tauri::generate_context!())
        .expect("error while running Otto");
}
