use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MonitorInfo {
    pub id: usize,
    pub label: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
    pub is_primary: bool,
}

pub fn enumerate<R: Runtime>(app: &AppHandle<R>) -> Vec<MonitorInfo> {
    let window = match app.get_webview_window("companion-panel") {
        Some(w) => w,
        None => return vec![],
    };

    let available = match window.available_monitors() {
        Ok(m) => m,
        Err(_) => return vec![],
    };

    let primary_pos = window
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| *m.position());

    let mut result: Vec<MonitorInfo> = available
        .iter()
        .enumerate()
        .map(|(idx, m)| {
            let pos = m.position();
            let size = m.size();
            let is_primary = primary_pos
                .map(|pp| pp.x == pos.x && pp.y == pos.y)
                .unwrap_or(idx == 0);

            MonitorInfo {
                id: idx,
                label: format!("screen{}", idx + 1),
                x: pos.x,
                y: pos.y,
                width: size.width,
                height: size.height,
                scale_factor: m.scale_factor(),
                is_primary,
            }
        })
        .collect();

    // Primary monitor always first — mirrors macOS DanteClicky label scheme
    result.sort_by(|a, b| b.is_primary.cmp(&a.is_primary));
    result
}
