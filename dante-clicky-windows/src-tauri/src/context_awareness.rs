/// Dims 93, 95, 96, 97 — Contextual awareness: calendar, email/comm, file system, OS notifications.
///
/// - Dim 93: Calendar context — detect calendar/meeting apps, parse meeting title from window
/// - Dim 95: Email/communication context — detect email/messaging apps from active window title
/// - Dim 96: File system awareness — surface recently opened files to AI context
/// - Dim 97: OS notification hooks — deliver toast notifications from AI responses

use serde::{Deserialize, Serialize};

// ── Dim 93: Calendar context ─────────────────────────────────────────────────

const CALENDAR_APPS: &[&str] = &[
    "calendar",
    "google calendar",
    "outlook calendar",
    "fantastical",
    "apple calendar",
];

// Meeting indicators: window titles that suggest an active video/audio meeting
const MEETING_INDICATORS: &[(&str, &str)] = &[
    ("microsoft teams",    "teams"),
    ("zoom meeting",       "zoom"),
    ("google meet",        "meet"),
    ("webex meeting",      "webex"),
    ("whereby",            "whereby"),
    ("bluejeans",          "bluejeans"),
    ("join the meeting",   "teams"),
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarContext {
    pub is_in_meeting: bool,
    pub meeting_platform: Option<String>,
    pub meeting_title: Option<String>,
    pub is_calendar_app: bool,
    pub window_title: String,
}

fn parse_calendar_context(title: &str) -> CalendarContext {
    let lower = title.to_ascii_lowercase();

    // Check for active meeting
    for (pattern, platform) in MEETING_INDICATORS {
        if lower.contains(pattern) {
            // Try to extract the meeting title by stripping the platform suffix/prefix
            let meeting_title = extract_meeting_title(title, platform);
            return CalendarContext {
                is_in_meeting: true,
                meeting_platform: Some(platform.to_string()),
                meeting_title,
                is_calendar_app: false,
                window_title: title.to_string(),
            };
        }
    }

    // Check if window is a calendar app
    let is_calendar_app = CALENDAR_APPS.iter().any(|a| lower.contains(a));

    CalendarContext {
        is_in_meeting: false,
        meeting_platform: None,
        meeting_title: None,
        is_calendar_app,
        window_title: title.to_string(),
    }
}

fn extract_meeting_title(title: &str, platform: &str) -> Option<String> {
    // Strip common suffixes like "| Microsoft Teams" or "— Zoom" to get the meeting name
    let separators = [" | ", " - ", " — ", " – "];
    let platform_lower = platform.to_ascii_lowercase();
    for sep in separators {
        if let Some(pos) = title.find(sep) {
            let candidate = title[..pos].trim();
            if !candidate.to_ascii_lowercase().contains(&platform_lower)
                && !candidate.is_empty()
                && candidate.len() > 3
            {
                return Some(candidate.to_string());
            }
            // Check the other side
            let other = title[pos + sep.len()..].trim();
            if !other.to_ascii_lowercase().contains(&platform_lower)
                && !other.is_empty()
                && other.len() > 3
            {
                return Some(other.to_string());
            }
        }
    }
    None
}

/// Return calendar/meeting context derived from the active window title. (Dim 93)
#[tauri::command]
pub fn get_calendar_context() -> CalendarContext {
    let title = get_foreground_title();
    parse_calendar_context(&title)
}

/// Fetch upcoming calendar appointments from Outlook (via COM) or .ics files. (Dim 93)
///
/// - `hours_ahead`: look-ahead window in hours (default 8)
/// Returns a JSON array of appointments with start, end, subject, location.
#[tauri::command]
pub fn get_calendar_appointments(hours_ahead: Option<u64>) -> Result<Vec<serde_json::Value>, String> {
    let h = hours_ahead.unwrap_or(8).min(72);
    let result = get_appointments_via_powershell(h)
        .or_else(|_| get_appointments_from_ics(h));
    result
}

fn get_appointments_via_powershell(hours_ahead: u64) -> Result<Vec<serde_json::Value>, String> {
    let script = format!(
        r#"
$ErrorActionPreference = 'Stop'
try {{
    $ol = New-Object -ComObject Outlook.Application
    $ns = $ol.GetNamespace("MAPI")
    $cal = $ns.GetDefaultFolder(9)
    $items = $cal.Items
    $items.Sort("[Start]")
    $items.IncludeRecurrences = $true
    $start = (Get-Date).ToString("MM/dd/yyyy HH:mm")
    $end = (Get-Date).AddHours({hours_ahead}).ToString("MM/dd/yyyy HH:mm")
    $filtered = $items.Restrict("[Start] >= '$start' AND [Start] <= '$end'")
    $out = @()
    foreach ($item in $filtered) {{
        $out += @{{
            subject = $item.Subject
            start = $item.Start.ToString("o")
            end = $item.End.ToString("o")
            location = $item.Location
            duration_min = $item.Duration
        }}
    }}
    $out | ConvertTo-Json -Compress
}} catch {{
    Write-Output "[]"
}}
"#
    );

    let out = std::process::Command::new("powershell")
        .args(["-NonInteractive", "-WindowStyle", "Hidden", "-Command", &script])
        .output()
        .map_err(|e| format!("PowerShell exec failed: {e}"))?;

    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if stdout.is_empty() || stdout == "[]" {
        return Ok(vec![]);
    }

    let json: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("parse error: {e}"))?;

    let arr = match json.as_array() {
        Some(a) => a.to_vec(),
        None if json.is_object() => vec![json],
        _ => return Ok(vec![]),
    };

    Ok(arr)
}

fn get_appointments_from_ics(hours_ahead: u64) -> Result<Vec<serde_json::Value>, String> {
    // Scan common ICS download/sync locations
    let home = std::env::var("USERPROFILE").unwrap_or_default();
    let search_dirs = [
        format!("{home}\\Downloads"),
        format!("{home}\\Documents"),
        format!("{home}\\AppData\\Local\\Microsoft\\Outlook"),
    ];

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let end_secs = now + hours_ahead * 3600;

    let mut appointments = vec![];

    for dir in &search_dirs {
        let path = std::path::Path::new(dir);
        if !path.exists() { continue; }
        let entries = match std::fs::read_dir(path) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.filter_map(|e| e.ok()) {
            if entry.path().extension().and_then(|x| x.to_str()) == Some("ics") {
                if let Ok(content) = std::fs::read_to_string(entry.path()) {
                    appointments.extend(parse_ics_events(&content, now, end_secs));
                }
            }
        }
    }

    Ok(appointments)
}

fn parse_ics_events(content: &str, from_secs: u64, to_secs: u64) -> Vec<serde_json::Value> {
    // Minimal ICS parser — extracts VEVENT blocks
    let mut results = vec![];
    let mut in_event = false;
    let mut current: std::collections::HashMap<&str, String> = std::collections::HashMap::new();

    for line in content.lines() {
        if line == "BEGIN:VEVENT" {
            in_event = true;
            current.clear();
        } else if line == "END:VEVENT" {
            in_event = false;
            // Convert DTSTART to unix seconds for filtering
            let start_str = current.get("DTSTART").cloned().unwrap_or_default();
            let start_secs = ics_datetime_to_secs(&start_str);
            if start_secs >= from_secs && start_secs <= to_secs {
                results.push(serde_json::json!({
                    "subject": current.get("SUMMARY").cloned().unwrap_or_default(),
                    "start": start_str,
                    "end": current.get("DTEND").cloned().unwrap_or_default(),
                    "location": current.get("LOCATION").cloned().unwrap_or_default(),
                    "source": "ics",
                }));
            }
        } else if in_event {
            if let Some(colon) = line.find(':') {
                let key = &line[..colon];
                let val = &line[colon + 1..];
                // Strip property parameters (e.g. DTSTART;TZID=...)
                let clean_key = key.split(';').next().unwrap_or(key);
                current.insert(clean_key, val.to_string());
            }
        }
    }

    results
}

fn ics_datetime_to_secs(dt: &str) -> u64 {
    // Parse YYYYMMDDTHHMMSSZ or YYYYMMDD (minimal, UTC-only)
    let d = dt.trim_end_matches('Z').replace('T', "");
    if d.len() < 8 { return 0; }
    let year: u64 = d[0..4].parse().unwrap_or(0);
    let month: u64 = d[4..6].parse().unwrap_or(0);
    let day: u64 = d[6..8].parse().unwrap_or(0);
    let hour: u64 = if d.len() >= 10 { d[8..10].parse().unwrap_or(0) } else { 0 };
    let min: u64 = if d.len() >= 12 { d[10..12].parse().unwrap_or(0) } else { 0 };
    // Approximate: days since epoch (good enough for filtering)
    let days_since_epoch = (year - 1970) * 365 + (year - 1970) / 4
        + [0u64, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
            .get(month.saturating_sub(1) as usize).copied().unwrap_or(0)
        + (day - 1);
    days_since_epoch * 86400 + hour * 3600 + min * 60
}

// ── Dim 95: Email / communication context ─────────────────────────────────────

const EMAIL_APPS: &[&str] = &["outlook", "gmail", "thunderbird", "mail", "mailbird", "spark"];
const MESSAGING_APPS: &[&str] = &["teams", "slack", "discord", "telegram", "signal", "whatsapp", "zoom"];
const BROWSER_APPS: &[&str] = &["chrome", "firefox", "edge", "brave", "opera", "safari"];
const IDE_APPS: &[&str] = &["code", "visual studio", "rider", "intellij", "pycharm", "webstorm", "cursor"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowContext {
    pub title: String,
    pub app_category: String,
    pub detected_app: Option<String>,
    pub is_communication: bool,
    pub is_email: bool,
    pub is_browser: bool,
    pub is_ide: bool,
}

fn classify_window(title: &str) -> WindowContext {
    let lower = title.to_ascii_lowercase();

    let (cat, app, is_email, is_communication, is_browser, is_ide) = {
        if let Some(name) = EMAIL_APPS.iter().find(|a| lower.contains(*a)) {
            ("email", Some(name.to_string()), true, true, false, false)
        } else if let Some(name) = MESSAGING_APPS.iter().find(|a| lower.contains(*a)) {
            ("messaging", Some(name.to_string()), false, true, false, false)
        } else if let Some(name) = BROWSER_APPS.iter().find(|a| lower.contains(*a)) {
            ("browser", Some(name.to_string()), false, false, true, false)
        } else if let Some(name) = IDE_APPS.iter().find(|a| lower.contains(*a)) {
            ("ide", Some(name.to_string()), false, false, false, true)
        } else {
            ("other", None, false, false, false, false)
        }
    };

    WindowContext {
        title: title.to_string(),
        app_category: cat.to_string(),
        detected_app: app,
        is_communication,
        is_email,
        is_browser,
        is_ide,
    }
}

/// Return classified context for the active window, enriched with app category. (Dim 95)
#[tauri::command]
pub fn get_window_context() -> WindowContext {
    let title = get_foreground_title();
    classify_window(&title)
}

// ── Dim 96: File system awareness ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentFile {
    pub path: String,
    pub name: String,
    pub extension: String,
    pub modified_secs: u64,
}

/// Return a list of recently opened files from the Windows shell recent items.
/// Falls back to an empty list on non-Windows or if the folder is inaccessible. (Dim 96)
#[tauri::command]
pub fn get_recent_files(limit: Option<usize>) -> Vec<RecentFile> {
    let n = limit.unwrap_or(20).min(100);
    recent_files_impl(n)
}

#[cfg(target_os = "windows")]
fn recent_files_impl(limit: usize) -> Vec<RecentFile> {
    use std::time::{SystemTime, UNIX_EPOCH};

    let recent_dir = match std::env::var("APPDATA") {
        Ok(appdata) => std::path::PathBuf::from(appdata)
            .join("Microsoft")
            .join("Windows")
            .join("Recent"),
        Err(_) => return vec![],
    };

    let entries = match std::fs::read_dir(&recent_dir) {
        Ok(e) => e,
        Err(_) => return vec![],
    };

    let mut files: Vec<(u64, RecentFile)> = entries
        .filter_map(|entry| entry.ok())
        .filter(|e| {
            // Only .lnk shortcut files (Windows recently opened items)
            e.path().extension().and_then(|x| x.to_str()) == Some("lnk")
        })
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            let modified = meta.modified().ok()?
                .duration_since(UNIX_EPOCH).ok()?.as_secs();
            let lnk_path = e.path();
            let stem = lnk_path.file_stem()?.to_string_lossy().into_owned();
            // The stem of the .lnk is the target filename
            let ext = std::path::Path::new(&stem)
                .extension()
                .and_then(|x| x.to_str())
                .unwrap_or("")
                .to_string();
            Some((modified, RecentFile {
                path: stem.clone(),
                name: stem,
                extension: ext,
                modified_secs: modified,
            }))
        })
        .collect();

    files.sort_by(|a, b| b.0.cmp(&a.0));
    files.into_iter().take(limit).map(|(_, f)| f).collect()
}

#[cfg(not(target_os = "windows"))]
fn recent_files_impl(_limit: usize) -> Vec<RecentFile> {
    vec![]
}

// ── Dim 97: OS notification hooks ─────────────────────────────────────────────

/// Send a Windows toast notification. Used to deliver AI responses as system
/// notifications when DanteClicky is in ambient/headless mode. (Dim 97)
#[tauri::command]
pub fn send_os_notification(title: String, body: String) -> Result<(), String> {
    send_notification_impl(&title, &body)
}

#[cfg(target_os = "windows")]
fn send_notification_impl(title: &str, body: &str) -> Result<(), String> {
    // Use PowerShell to send a Windows toast notification.
    // This avoids a winrt dependency while still delivering real OS notifications.
    let script = format!(
        "[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime] | Out-Null; \
         $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); \
         $xml.GetElementsByTagName('text')[0].AppendChild($xml.CreateTextNode({title:?})) | Out-Null; \
         $xml.GetElementsByTagName('text')[1].AppendChild($xml.CreateTextNode({body:?})) | Out-Null; \
         [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('DanteClicky').Show([Windows.UI.Notifications.ToastNotification]::new($xml))",
        title = title.chars().take(64).collect::<String>(),
        body = body.chars().take(256).collect::<String>(),
    );

    let status = std::process::Command::new("powershell")
        .args(["-NonInteractive", "-WindowStyle", "Hidden", "-Command", &script])
        .status()
        .map_err(|e| format!("PowerShell exec failed: {e}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("Toast notification failed (exit {})", status.code().unwrap_or(-1)))
    }
}

#[cfg(not(target_os = "windows"))]
fn send_notification_impl(_title: &str, _body: &str) -> Result<(), String> {
    Err("OS notifications not supported on this platform".to_string())
}

// ── Helpers ───────────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn get_foreground_title() -> String {
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW};
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() { return String::new(); }
        let mut buf = [0u16; 512];
        let len = GetWindowTextW(hwnd, &mut buf);
        if len <= 0 { return String::new(); }
        String::from_utf16_lossy(&buf[..len as usize])
    }
}

#[cfg(not(target_os = "windows"))]
fn get_foreground_title() -> String {
    String::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calendar_context_teams_meeting() {
        let ctx = parse_calendar_context("Weekly Standup | Microsoft Teams");
        assert!(ctx.is_in_meeting);
        assert_eq!(ctx.meeting_platform.as_deref(), Some("teams"));
        assert_eq!(ctx.meeting_title.as_deref(), Some("Weekly Standup"));
    }

    #[test]
    fn calendar_context_zoom() {
        let ctx = parse_calendar_context("Design Review — Zoom Meeting");
        assert!(ctx.is_in_meeting);
        assert_eq!(ctx.meeting_platform.as_deref(), Some("zoom"));
    }

    #[test]
    fn calendar_context_not_meeting() {
        let ctx = parse_calendar_context("lib.rs - Visual Studio Code");
        assert!(!ctx.is_in_meeting);
        assert!(!ctx.is_calendar_app);
    }

    #[test]
    fn classify_email_window() {
        let ctx = classify_window("Inbox - user@example.com - Outlook");
        assert!(ctx.is_email);
        assert!(ctx.is_communication);
        assert_eq!(ctx.app_category, "email");
        assert_eq!(ctx.detected_app.as_deref(), Some("outlook"));
    }

    #[test]
    fn classify_messaging_window() {
        let ctx = classify_window("General | Project Name - Slack");
        assert!(ctx.is_communication);
        assert!(!ctx.is_email);
        assert_eq!(ctx.app_category, "messaging");
    }

    #[test]
    fn classify_ide_window() {
        let ctx = classify_window("lib.rs - dante-clicky - Visual Studio Code");
        assert!(ctx.is_ide);
        assert_eq!(ctx.app_category, "ide");
    }

    #[test]
    fn classify_unknown_window() {
        let ctx = classify_window("Random App 3.4");
        assert_eq!(ctx.app_category, "other");
        assert!(!ctx.is_communication);
    }
}
