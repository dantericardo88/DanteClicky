use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use zeroize::Zeroizing;

/// In-memory API key cache.
///
/// Keys are stored as `Zeroizing<String>` so that their heap memory is
/// overwritten with zeros when the value is dropped (session end, `clear()`
/// call, or process exit). This closes the window where a heap-dump or
/// memory-scraping tool could recover plaintext API keys.
pub struct KeyStore {
    keys: Mutex<HashMap<String, Zeroizing<String>>>,
    storage_dir: Mutex<Option<PathBuf>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyStatus {
    pub provider: String,
    pub configured: bool,
    pub persisted: bool,
    pub protected: bool,
    pub storage: String,
}

const PROVIDERS: &[&str] = &[
    "anthropic",
    "openai",
    "xai",
    "openrouter",
    "elevenlabs",
    "assemblyai",
];

impl KeyStore {
    pub fn new() -> Self {
        Self {
            keys: Mutex::new(HashMap::new()),
            storage_dir: Mutex::new(None),
        }
    }

    pub fn configure_storage(&self, dir: PathBuf) {
        log::info!("[keystore] configure_storage → {dir:?}");
        let _ = std::fs::create_dir_all(&dir);
        *self.storage_dir.lock().unwrap() = Some(dir);
    }

    pub fn set(&self, provider: &str, key: String) -> Result<(), String> {
        let encoded = if let Some(path) = self.provider_path(provider) {
            let enc = protect_secret(key.as_bytes())?;
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::write(path, enc).map_err(|e| e.to_string())?;
            true
        } else {
            false
        };
        // Store as Zeroizing<String> so memory is wiped on drop.
        self.keys
            .lock()
            .unwrap()
            .insert(provider.to_owned(), Zeroizing::new(key));
        let _ = encoded;
        Ok(())
    }

    pub fn get(&self, provider: &str) -> Option<String> {
        if let Some(value) = self.keys.lock().unwrap().get(provider) {
            let v = value.as_str().to_owned();
            log::info!("[keystore] get({provider}) → memory cache hit (len={})", v.len());
            return Some(v);
        }
        let path = self.provider_path(provider);
        log::info!("[keystore] get({provider}) → cache miss, path={path:?}");
        let path = path?;
        if !path.exists() {
            log::warn!("[keystore] get({provider}) → file NOT found at {path:?}");
            return None;
        }
        let bytes = match std::fs::read(&path) {
            Ok(b) => { log::info!("[keystore] get({provider}) → file read ok ({} bytes)", b.len()); b }
            Err(e) => { log::error!("[keystore] get({provider}) → file read error: {e}"); return None; }
        };
        let decoded = match unprotect_secret(&bytes) {
            Ok(d) => { log::info!("[keystore] get({provider}) → DPAPI decrypt ok ({} bytes)", d.len()); d }
            Err(e) => { log::error!("[keystore] get({provider}) → DPAPI decrypt FAILED: {e}"); return None; }
        };
        let value = match String::from_utf8(decoded) {
            Ok(v) => v,
            Err(e) => { log::error!("[keystore] get({provider}) → UTF-8 decode failed: {e}"); return None; }
        };
        log::info!("[keystore] get({provider}) → success, caching key (len={})", value.len());
        self.keys
            .lock()
            .unwrap()
            .insert(provider.to_owned(), Zeroizing::new(value.clone()));
        Some(value)
    }

    pub fn clear(&self, provider: &str) {
        self.keys.lock().unwrap().remove(provider);
        if let Some(path) = self.provider_path(provider) {
            let _ = std::fs::remove_file(path);
        }
    }

    /// Drop all in-memory keys (Zeroizing<String> wipes heap on drop).
    /// Called on session end to minimize the window for memory-scraping attacks.
    pub fn clear_all_from_memory(&self) {
        self.keys.lock().unwrap().clear();
        log::info!("[keystore] all in-memory keys zeroed (session end)");
    }

    pub fn statuses(&self) -> Vec<ApiKeyStatus> {
        PROVIDERS
            .iter()
            .map(|provider| self.status(provider))
            .collect()
    }

    pub fn status(&self, provider: &str) -> ApiKeyStatus {
        let path = self.provider_path(provider);
        let persisted = path.as_ref().map(|p| p.exists()).unwrap_or(false);
        // Use get() so DPAPI decryption is verified — file-exists alone is insufficient
        let configured = self.get(provider).is_some();
        ApiKeyStatus {
            provider: provider.to_string(),
            configured,
            persisted,
            protected: secrets_are_os_protected(),
            storage: if secrets_are_os_protected() {
                "windows-dpapi".to_string()
            } else if path.is_some() {
                "app-data-fallback".to_string()
            } else {
                "memory-only".to_string()
            },
        }
    }

    fn provider_path(&self, provider: &str) -> Option<PathBuf> {
        let safe = provider
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
            .collect::<String>();
        self.storage_dir
            .lock()
            .unwrap()
            .as_ref()
            .map(|dir| dir.join(format!("{safe}.key")))
    }
}

#[tauri::command]
pub fn set_api_key(
    store: tauri::State<'_, KeyStore>,
    provider: String,
    key: String,
) -> Result<(), String> {
    store.set(&provider, key)
}

#[tauri::command]
pub fn clear_api_key(store: tauri::State<'_, KeyStore>, provider: String) {
    store.clear(&provider);
}

#[tauri::command]
pub fn get_api_key_statuses(store: tauri::State<'_, KeyStore>) -> Vec<ApiKeyStatus> {
    store.statuses()
}

#[tauri::command]
pub fn get_api_key_status(store: tauri::State<'_, KeyStore>, provider: String) -> ApiKeyStatus {
    store.status(&provider)
}

/// Wipe all in-memory API keys at session end. Keys remain persisted (DPAPI-encrypted)
/// on disk and will be re-loaded on the next session. (Dim 59 — memory wipe)
#[tauri::command]
pub fn session_clear_keys(store: tauri::State<'_, KeyStore>) {
    store.clear_all_from_memory();
}

#[cfg(target_os = "windows")]
fn secrets_are_os_protected() -> bool {
    true
}

#[cfg(not(target_os = "windows"))]
fn secrets_are_os_protected() -> bool {
    false
}

#[cfg(target_os = "windows")]
fn protect_secret(bytes: &[u8]) -> Result<Vec<u8>, String> {
    dpapi(bytes, true)
}

#[cfg(target_os = "windows")]
fn unprotect_secret(bytes: &[u8]) -> Result<Vec<u8>, String> {
    dpapi(bytes, false)
}

#[cfg(not(target_os = "windows"))]
fn protect_secret(bytes: &[u8]) -> Result<Vec<u8>, String> {
    Ok(bytes.to_vec())
}

#[cfg(not(target_os = "windows"))]
fn unprotect_secret(bytes: &[u8]) -> Result<Vec<u8>, String> {
    Ok(bytes.to_vec())
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct DataBlob {
    cb_data: u32,
    pb_data: *mut u8,
}

#[cfg(target_os = "windows")]
#[link(name = "Crypt32")]
extern "system" {
    fn CryptProtectData(
        p_data_in: *const DataBlob,
        sz_data_descr: *const u16,
        p_optional_entropy: *const DataBlob,
        pv_reserved: *mut std::ffi::c_void,
        p_prompt_struct: *const std::ffi::c_void,
        dw_flags: u32,
        p_data_out: *mut DataBlob,
    ) -> i32;
    fn CryptUnprotectData(
        p_data_in: *const DataBlob,
        ppsz_data_descr: *mut *mut u16,
        p_optional_entropy: *const DataBlob,
        pv_reserved: *mut std::ffi::c_void,
        p_prompt_struct: *const std::ffi::c_void,
        dw_flags: u32,
        p_data_out: *mut DataBlob,
    ) -> i32;
}

#[cfg(target_os = "windows")]
#[link(name = "Kernel32")]
extern "system" {
    fn LocalFree(hmem: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
}

#[cfg(target_os = "windows")]
fn dpapi(bytes: &[u8], protect: bool) -> Result<Vec<u8>, String> {
    const CRYPTPROTECT_UI_FORBIDDEN: u32 = 0x1;
    let mut input = DataBlob {
        cb_data: bytes.len() as u32,
        pb_data: bytes.as_ptr() as *mut u8,
    };
    let mut output = DataBlob {
        cb_data: 0,
        pb_data: std::ptr::null_mut(),
    };
    let ok = unsafe {
        if protect {
            CryptProtectData(
                &mut input,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &mut input,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
    };
    if ok == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    let result = unsafe {
        let slice = std::slice::from_raw_parts(output.pb_data, output.cb_data as usize);
        let data = slice.to_vec();
        let _ = LocalFree(output.pb_data as *mut std::ffi::c_void);
        data
    };
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keystore_persists_status_without_exposing_secret() {
        let dir = std::env::temp_dir().join(format!(
            "dante-keystore-test-{}",
            std::process::id()
        ));
        let store = KeyStore::new();
        store.configure_storage(dir.clone());
        store.set("openai", "sk-test".to_string()).unwrap();

        let status = store.status("openai");
        assert!(status.configured);
        assert!(status.persisted);
        assert_eq!(store.get("openai").as_deref(), Some("sk-test"));

        store.clear("openai");
        assert!(!store.status("openai").configured);
        let _ = remove_dir_all_if_exists(&dir);
    }

    fn remove_dir_all_if_exists(path: &std::path::Path) -> std::io::Result<()> {
        if path.exists() {
            std::fs::remove_dir_all(path)?;
        }
        Ok(())
    }
}
