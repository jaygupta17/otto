//! Otto as a share target. On Android, what another app shares (text, a link,
//! files) is copied into the cache by the Kotlin side; `take` hands it over once
//! and `read` returns one copied file's bytes. Elsewhere nothing is ever shared.

use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Shared {
    text: Option<String>,
    subject: Option<String>,
    files: Vec<SharedFile>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct SharedFile {
    name: String,
    mime: Option<String>,
    size: u64,
    /// Missing when the file was too big to copy.
    path: Option<String>,
}

#[cfg(target_os = "android")]
struct Handle<R: Runtime>(tauri::plugin::PluginHandle<R>);

#[tauri::command]
fn take<R: Runtime>(app: tauri::AppHandle<R>) -> Result<Shared, String> {
    #[cfg(target_os = "android")]
    return app.state::<Handle<R>>().0.run_mobile_plugin::<Shared>("take", ()).map_err(|e| e.to_string());
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(Shared::default())
    }
}

/// A shared file's bytes. Only files under the share cache; each is removed once read.
#[tauri::command]
fn read<R: Runtime>(app: tauri::AppHandle<R>, path: String) -> Result<tauri::ipc::Response, String> {
    let root = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("shared");
    let root = std::fs::canonicalize(&root).map_err(|e| e.to_string())?;
    let file = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
    if !file.starts_with(&root) {
        return Err("Not a shared file".into());
    }
    let bytes = std::fs::read(&file).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&file);
    Ok(tauri::ipc::Response::new(bytes))
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("share")
        .invoke_handler(tauri::generate_handler![take, read])
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let handle = _api.register_android_plugin("dev.jaygupta.otto.share", "SharePlugin")?;
                _app.manage(Handle(handle));
            }
            Ok(())
        })
        .build()
}
