use screenshots::Screen;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

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

pub fn enumerate<R: Runtime>(_app: &AppHandle<R>) -> Vec<MonitorInfo> {
    let screens = match Screen::all() {
        Ok(screens) => screens,
        Err(_) => return vec![],
    };

    let mut result: Vec<MonitorInfo> = screens
        .iter()
        .enumerate()
        .map(|(idx, screen)| {
            let info = &screen.display_info;
            MonitorInfo {
                id: idx,
                label: format!("screen{}", idx + 1),
                x: info.x,
                y: info.y,
                width: info.width,
                height: info.height,
                scale_factor: info.scale_factor as f64,
                is_primary: info.is_primary,
            }
        })
        .collect();

    // Primary monitor always first — mirrors macOS DanteClicky label scheme
    result.sort_by(|a, b| b.is_primary.cmp(&a.is_primary));
    result
}
