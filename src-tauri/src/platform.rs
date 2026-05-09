use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityStatus {
    pub supported: bool,
    pub degraded: bool,
    pub backend: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformCapabilities {
    pub os: String,
    pub family: String,
    #[serde(rename = "nativeScreenCapture")]
    pub native_screen_capture: CapabilityStatus,
    #[serde(rename = "nativeInputControl")]
    pub native_input_control: CapabilityStatus,
    #[serde(rename = "accessibilityTree")]
    pub accessibility_tree: CapabilityStatus,
    pub ocr: CapabilityStatus,
    pub global_shortcut: CapabilityStatus,
    pub tray: CapabilityStatus,
    pub overlay_stealth: CapabilityStatus,
    pub autostart: CapabilityStatus,
    pub notes: Vec<String>,
}

fn supported(backend: &str) -> CapabilityStatus {
    CapabilityStatus {
        supported: true,
        degraded: false,
        backend: backend.to_string(),
        reason: None,
    }
}

fn degraded(backend: &str, reason: &str) -> CapabilityStatus {
    CapabilityStatus {
        supported: true,
        degraded: true,
        backend: backend.to_string(),
        reason: Some(reason.to_string()),
    }
}

fn unavailable(backend: &str, reason: &str) -> CapabilityStatus {
    CapabilityStatus {
        supported: false,
        degraded: true,
        backend: backend.to_string(),
        reason: Some(reason.to_string()),
    }
}

#[tauri::command]
pub fn get_platform_capabilities() -> PlatformCapabilities {
    let os = std::env::consts::OS.to_string();
    let family = std::env::consts::FAMILY.to_string();

    match os.as_str() {
        "windows" => PlatformCapabilities {
            os,
            family,
            native_screen_capture: supported("screenshots + Windows Graphics Capture feature"),
            native_input_control: supported("enigo + Win32 cursor easing"),
            accessibility_tree: supported("Windows UIAutomation"),
            ocr: supported("Windows.Media.Ocr"),
            global_shortcut: supported("tauri-plugin-global-shortcut"),
            tray: supported("Tauri tray icon"),
            overlay_stealth: supported("SetWindowDisplayAffinity"),
            autostart: supported("Tauri autostart"),
            notes: vec![
                "windows is the fully-featured reference backend".to_string(),
                "video-hw-capture enables Windows Graphics Capture recording".to_string(),
            ],
        },
        "macos" => PlatformCapabilities {
            os,
            family,
            native_screen_capture: degraded(
                "screenshots",
                "screen capture requires macOS Screen Recording permission",
            ),
            native_input_control: degraded(
                "enigo",
                "input control requires macOS Accessibility permission",
            ),
            accessibility_tree: unavailable(
                "not implemented",
                "macOS AXUIElement backend is planned; vision fallback remains available",
            ),
            ocr: unavailable(
                "not implemented",
                "Windows.Media.Ocr is unavailable; use vision/cloud OCR fallback",
            ),
            global_shortcut: supported("tauri-plugin-global-shortcut"),
            tray: supported("Tauri tray icon"),
            overlay_stealth: unavailable(
                "not implemented",
                "screen-share exclusion needs a macOS-specific window/capture strategy",
            ),
            autostart: supported("Tauri autostart LaunchAgent"),
            notes: vec![
                "macos beta keeps core tray, hotkey, voice, capture, and input paths compiling"
                    .to_string(),
                "native accessibility and stealth overlay need dedicated macOS backends"
                    .to_string(),
            ],
        },
        "linux" => PlatformCapabilities {
            os,
            family,
            native_screen_capture: degraded(
                "screenshots",
                "Linux capture depends on X11/Wayland/PipeWire session capabilities",
            ),
            native_input_control: degraded(
                "enigo",
                "Linux input control depends on X11, Wayland, or libei availability",
            ),
            accessibility_tree: unavailable(
                "not implemented",
                "AT-SPI backend is planned; vision fallback remains available",
            ),
            ocr: unavailable(
                "not implemented",
                "Windows.Media.Ocr is unavailable; use vision/cloud OCR fallback",
            ),
            global_shortcut: supported("tauri-plugin-global-shortcut"),
            tray: degraded(
                "Tauri tray icon",
                "desktop environment tray support varies across Linux shells",
            ),
            overlay_stealth: unavailable(
                "not implemented",
                "capture exclusion requires compositor-specific support",
            ),
            autostart: supported("Tauri autostart desktop entry"),
            notes: vec![
                "linux beta keeps the app shell and core automation APIs cross-platform"
                    .to_string(),
                "Wayland capture/input reliability requires distro-specific validation"
                    .to_string(),
            ],
        },
        _ => PlatformCapabilities {
            os,
            family,
            native_screen_capture: unavailable("unknown", "unsupported operating system"),
            native_input_control: unavailable("unknown", "unsupported operating system"),
            accessibility_tree: unavailable("unknown", "unsupported operating system"),
            ocr: unavailable("unknown", "unsupported operating system"),
            global_shortcut: unavailable("unknown", "unsupported operating system"),
            tray: unavailable("unknown", "unsupported operating system"),
            overlay_stealth: unavailable("unknown", "unsupported operating system"),
            autostart: unavailable("unknown", "unsupported operating system"),
            notes: vec!["unsupported platform".to_string()],
        },
    }
}
