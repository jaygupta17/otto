//! Otto's settings store (and, on phones and Linux, its secrets): JSON objects in
//! the app data folder, behind `kv_get` / `kv_set` / `kv_delete`.
//!
//! Every change is written whole to a temp file, synced, and renamed over the old
//! file, so a process killed mid-write (Android kills background apps freely)
//! leaves the last good copy. plugin-store wrote in place, and a torn file loaded
//! as empty: Otto went back to onboarding with every key gone.
//!
//! Photos live in their own file, so the one holding workspaces and keys stays a
//! few KB and is rewritten in a moment.

use serde_json::{Map, Value};
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
};
use tauri::{AppHandle, Manager};

const MAIN: &str = "otto.json";
const PHOTOS: &str = "photos.json";
/// Keys kept in photos.json. Builds before it kept them in otto.json; they move across once.
const PHOTO_KEYS: [&str; 2] = ["ui.backdrops", "ui.backdrop"];

fn file_for(key: &str) -> &'static str {
    if PHOTO_KEYS.contains(&key) {
        PHOTOS
    } else {
        MAIN
    }
}

struct Doc {
    map: Map<String, Value>,
    dirty: bool,
}

struct Docs {
    dir: PathBuf,
    files: HashMap<&'static str, Doc>,
}

#[derive(Default)]
pub struct Kv {
    docs: Mutex<Option<Docs>>,
    /// One write at a time, each of the latest state, so an older one never lands last.
    writing: Mutex<()>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// A file that won't parse is kept beside it as `<name>.broken` rather than written over.
fn read(path: &Path) -> Map<String, Value> {
    let Ok(bytes) = fs::read(path) else { return Map::new() };
    match serde_json::from_slice(&bytes) {
        Ok(map) => map,
        Err(e) => {
            eprintln!("[kv] {} doesn't parse ({e}); starting it empty", path.display());
            let _ = fs::rename(path, path.with_extension("json.broken"));
            Map::new()
        }
    }
}

fn write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let dir = path.parent().expect("store files live in a folder");
    fs::create_dir_all(dir)?;
    let tmp = path.with_extension("json.tmp");
    // One a killed write left behind would keep its old mode.
    let _ = fs::remove_file(&tmp);
    let mut opts = fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut opts, 0o600);
    let mut f = opts.open(&tmp)?;
    f.write_all(bytes)?;
    f.sync_all()?;
    drop(f);
    fs::rename(&tmp, path)?;
    // The rename itself is only durable once the folder is synced.
    #[cfg(unix)]
    if let Ok(d) = fs::File::open(dir) {
        let _ = d.sync_all();
    }
    Ok(())
}

impl Docs {
    fn open(dir: PathBuf) -> Self {
        let mut main = read(&dir.join(MAIN));
        let mut photos = read(&dir.join(PHOTOS));
        let mut moved = photos.clone();
        for k in PHOTO_KEYS {
            if let Some(v) = main.get(k) {
                moved.entry(k).or_insert_with(|| v.clone());
            }
        }
        let mut main_dirty = false;
        // Photos are safely in their file before they leave the old one.
        if PHOTO_KEYS.iter().any(|k| main.contains_key(*k)) && serde_json::to_vec(&moved).is_ok_and(|b| write(&dir.join(PHOTOS), &b).is_ok()) {
            photos = moved;
            for k in PHOTO_KEYS {
                main.remove(k);
            }
            main_dirty = true;
        }
        let files = HashMap::from([(MAIN, Doc { map: main, dirty: main_dirty }), (PHOTOS, Doc { map: photos, dirty: false })]);
        Docs { dir, files }
    }
}

impl Kv {
    fn with<T>(&self, app: &AppHandle, f: impl FnOnce(&mut Docs) -> T) -> Result<T, String> {
        let mut docs = lock(&self.docs);
        if docs.is_none() {
            *docs = Some(Docs::open(app.path().app_data_dir().map_err(|e| e.to_string())?));
        }
        Ok(f(docs.as_mut().expect("just opened")))
    }

    fn save(&self, app: &AppHandle, name: &'static str) -> Result<(), String> {
        let _writing = lock(&self.writing);
        let next = self.with(app, |d| {
            let doc = d.files.get_mut(name).expect("every store file is open");
            if !doc.dirty {
                return None;
            }
            doc.dirty = false;
            Some((d.dir.join(name), serde_json::to_vec(&doc.map)))
        })?;
        let Some((path, bytes)) = next else { return Ok(()) };
        let result = bytes.map_err(|e| e.to_string()).and_then(|b| write(&path, &b).map_err(|e| e.to_string()));
        if result.is_err() {
            self.with(app, |d| d.files.get_mut(name).expect("every store file is open").dirty = true)?;
        }
        result
    }
}

#[tauri::command(async)]
pub fn kv_get(app: AppHandle, key: String) -> Result<Option<Value>, String> {
    app.state::<Kv>().with(&app, |d| d.files[file_for(&key)].map.get(&key).cloned())
}

/// Resolves once the change is on disk.
#[tauri::command(async)]
pub fn kv_set(app: AppHandle, key: String, value: Option<Value>) -> Result<(), String> {
    let kv = app.state::<Kv>();
    let name = file_for(&key);
    // Main is saved too while it still holds moved photos from an older build.
    kv.with(&app, |d| {
        let doc = d.files.get_mut(name).expect("every store file is open");
        doc.map.insert(key, value.unwrap_or(Value::Null));
        doc.dirty = true;
    })?;
    kv.save(&app, name)?;
    kv.save(&app, MAIN)
}

#[tauri::command(async)]
pub fn kv_delete(app: AppHandle, key: String) -> Result<bool, String> {
    let kv = app.state::<Kv>();
    let name = file_for(&key);
    let had = kv.with(&app, |d| {
        let doc = d.files.get_mut(name).expect("every store file is open");
        let had = doc.map.remove(&key).is_some();
        doc.dirty |= had;
        had
    })?;
    kv.save(&app, name)?;
    kv.save(&app, MAIN)?;
    Ok(had)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("otto-kv-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn photos_move_out_of_an_old_store() {
        let d = dir("move");
        fs::write(d.join(MAIN), serde_json::to_vec_pretty(&json!({ "workspaces.v1": { "activeId": "w" }, "ui.backdrops": [1, 2], "ui.backdrop": { "kind": "image" } })).unwrap()).unwrap();
        let docs = Docs::open(d.clone());
        assert_eq!(docs.files[MAIN].map.keys().collect::<Vec<_>>(), ["workspaces.v1"]);
        assert!(docs.files[MAIN].dirty);
        assert_eq!(read(&d.join(PHOTOS)), docs.files[PHOTOS].map);
        assert_eq!(docs.files[PHOTOS].map["ui.backdrops"], json!([1, 2]));
    }

    #[test]
    fn a_torn_file_is_kept_aside() {
        let d = dir("torn");
        fs::write(d.join(MAIN), br#"{"workspaces.v1": {"workspa"#).unwrap();
        assert!(read(&d.join(MAIN)).is_empty());
        assert!(!d.join(MAIN).exists());
        assert!(d.join("otto.json.broken").exists());
    }

    #[test]
    fn a_write_killed_before_its_rename_leaves_the_last_copy() {
        let d = dir("kill");
        write(&d.join(MAIN), br#"{"a":1}"#).unwrap();
        fs::write(d.join("otto.json.tmp"), br#"{"a":"#).unwrap();
        assert_eq!(read(&d.join(MAIN)), json!({ "a": 1 }).as_object().unwrap().clone());
        write(&d.join(MAIN), br#"{"a":2}"#).unwrap();
        assert_eq!(read(&d.join(MAIN))["a"], json!(2));
        assert!(!d.join("otto.json.tmp").exists());
        #[cfg(unix)]
        assert_eq!(std::os::unix::fs::PermissionsExt::mode(&fs::metadata(d.join(MAIN)).unwrap().permissions()) & 0o777, 0o600);
    }
}
