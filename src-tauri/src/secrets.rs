//! Secret storage for sandbox API keys and server passwords.
//!
//! macOS and Windows use the OS keychain. Other platforms report
//! `backend = "store"` and the frontend keeps secrets in the app's
//! private store file instead (app sandbox on iOS/Android, user-only
//! config dir on Linux).

const SERVICE: &str = "dev.otto.app";

#[tauri::command]
pub fn secret_backend() -> &'static str {
    if cfg!(any(target_os = "macos", target_os = "windows")) {
        "keychain"
    } else {
        "store"
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
mod imp {
    use super::SERVICE;

    fn entry(key: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, key).map_err(|e| e.to_string())
    }

    pub fn get(key: &str) -> Result<Option<String>, String> {
        match entry(key)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn set(key: &str, value: &str) -> Result<(), String> {
        entry(key)?.set_password(value).map_err(|e| e.to_string())
    }

    pub fn delete(key: &str) -> Result<(), String> {
        match entry(key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod imp {
    const UNSUPPORTED: &str = "keychain_unavailable";
    pub fn get(_key: &str) -> Result<Option<String>, String> {
        Err(UNSUPPORTED.into())
    }
    pub fn set(_key: &str, _value: &str) -> Result<(), String> {
        Err(UNSUPPORTED.into())
    }
    pub fn delete(_key: &str) -> Result<(), String> {
        Err(UNSUPPORTED.into())
    }
}

#[tauri::command]
pub fn secret_get(key: String) -> Result<Option<String>, String> {
    imp::get(&key)
}

#[tauri::command]
pub fn secret_set(key: String, value: String) -> Result<(), String> {
    imp::set(&key, &value)
}

#[tauri::command]
pub fn secret_delete(key: String) -> Result<(), String> {
    imp::delete(&key)
}
