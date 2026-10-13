//! Secret storage for sandbox API keys and server passwords.
//!
//! macOS and Windows use the OS keychain. Other platforms report
//! `backend = "store"` and the frontend keeps secrets in the app's
//! private store file instead (app sandbox on iOS/Android, user-only
//! config dir on Linux).

const SERVICE: &str = "dev.jaygupta.otto";
/// Where builds before 0.8 kept each secret as its own item.
#[allow(dead_code)] // phones and Linux keep secrets in the store
const OLD_SERVICE: &str = crate::OLD_ID;

#[tauri::command]
pub fn secret_backend() -> &'static str {
    if cfg!(any(target_os = "macos", target_os = "windows")) {
        "keychain"
    } else {
        "store"
    }
}

/// macOS: every secret lives in ONE keychain item (a JSON map), read once per
/// launch. macOS asks for access per item, and an ad-hoc signed app is a "new"
/// app after every update, so one item per secret meant a prompt per secret.
/// Items from older builds (one per secret, under the old app id) are read
/// once, folded in, and left alone (removing them would ask again).
#[cfg(target_os = "macos")]
mod imp {
    use super::{OLD_SERVICE, SERVICE};
    use std::collections::HashMap;
    use std::sync::Mutex;

    const VAULT: &str = "vault";

    /// `None` = known to be absent (deleted, or not found in the old items).
    type Vault = HashMap<String, Option<String>>;
    static CACHE: Mutex<Option<Vault>> = Mutex::new(None);

    fn entry(key: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, key).map_err(|e| e.to_string())
    }

    fn read(key: &str) -> Result<Option<String>, String> {
        read_in(SERVICE, key)
    }

    fn read_in(service: &str, key: &str) -> Result<Option<String>, String> {
        match keyring::Entry::new(service, key).map_err(|e| e.to_string())?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    /// Runs with the vault loaded; holding the lock means concurrent calls share one read (and one prompt).
    fn with<T>(f: impl FnOnce(&mut Vault) -> Result<T, String>) -> Result<T, String> {
        let mut guard = CACHE.lock().map_err(|e| e.to_string())?;
        if guard.is_none() {
            let vault = match read(VAULT)? {
                Some(json) => serde_json::from_str(&json).map_err(|e| e.to_string())?,
                None => Vault::new(),
            };
            *guard = Some(vault);
        }
        f(guard.as_mut().unwrap())
    }

    fn save(vault: &Vault) -> Result<(), String> {
        let json = serde_json::to_string(vault).map_err(|e| e.to_string())?;
        entry(VAULT)?.set_password(&json).map_err(|e| e.to_string())
    }

    pub fn get(key: &str) -> Result<Option<String>, String> {
        with(|v| {
            if let Some(hit) = v.get(key) {
                return Ok(hit.clone());
            }
            let legacy = read_in(OLD_SERVICE, key)?;
            v.insert(key.to_string(), legacy.clone());
            save(v)?;
            Ok(legacy)
        })
    }

    pub fn set(key: &str, value: &str) -> Result<(), String> {
        with(|v| {
            v.insert(key.to_string(), Some(value.to_string()));
            save(v)
        })
    }

    pub fn delete(key: &str) -> Result<(), String> {
        with(|v| {
            v.insert(key.to_string(), None);
            save(v)
        })
    }
}

/// Windows Credential Manager doesn't prompt, and caps an item at 2.5 KB: one item per secret.
#[cfg(target_os = "windows")]
mod imp {
    use super::{OLD_SERVICE, SERVICE};

    fn entry(key: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, key).map_err(|e| e.to_string())
    }

    fn read_in(service: &str, key: &str) -> Result<Option<String>, String> {
        match keyring::Entry::new(service, key).map_err(|e| e.to_string())?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    /// Falls back to the old app id's item once, copying it across.
    pub fn get(key: &str) -> Result<Option<String>, String> {
        if let Some(v) = read_in(SERVICE, key)? {
            return Ok(Some(v));
        }
        let old = read_in(OLD_SERVICE, key)?;
        if let Some(v) = &old {
            set(key, v)?;
            if let Ok(e) = keyring::Entry::new(OLD_SERVICE, key) {
                let _ = e.delete_credential();
            }
        }
        Ok(old)
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
