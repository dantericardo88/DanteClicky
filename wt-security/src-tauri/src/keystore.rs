use std::collections::HashMap;
use std::sync::Mutex;

pub struct KeyStore(pub Mutex<HashMap<String, String>>);

impl KeyStore {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }

    pub fn set(&self, provider: &str, key: String) {
        self.0.lock().unwrap().insert(provider.to_owned(), key);
    }

    pub fn get(&self, provider: &str) -> Option<String> {
        self.0.lock().unwrap().get(provider).cloned()
    }
}

#[tauri::command]
pub fn set_api_key(
    store: tauri::State<'_, KeyStore>,
    provider: String,
    key: String,
) {
    store.set(&provider, key);
}

#[tauri::command]
pub fn clear_api_key(store: tauri::State<'_, KeyStore>, provider: String) {
    store.0.lock().unwrap().remove(&provider);
}
