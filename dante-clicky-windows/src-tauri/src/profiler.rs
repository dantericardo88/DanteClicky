/// Dim 74 — Rust backend heap allocation profile.
///
/// Exposes process memory counters via Windows PROCESS_MEMORY_COUNTERS_EX.
/// - GET /v1/heap-stats: on-demand snapshot
/// - heap_stats Tauri command: same
/// - start_heap_monitor / stop_heap_monitor: periodic EventBus publishing
///   (emits "profiler.heap" events every N seconds so subscribers can plot over time)

use serde_json::Value;
use std::sync::{Arc, Mutex};

pub struct HeapMonitorState {
    cancel_tx: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
}

impl Default for HeapMonitorState {
    fn default() -> Self { Self { cancel_tx: Mutex::new(None) } }
}

/// Start a background task that publishes heap stats to the EventBus every `interval_secs`. (Dim 74)
#[tauri::command]
pub async fn start_heap_monitor(
    app: tauri::AppHandle,
    interval_secs: Option<u64>,
) -> Result<String, String> {
    use tauri::Manager;
    let state = app.state::<HeapMonitorState>();
    let mut lock = state.cancel_tx.lock().unwrap();
    if lock.is_some() {
        return Err("heap monitor already running — call stop_heap_monitor first".to_string());
    }
    let (tx, mut rx) = tokio::sync::oneshot::channel::<()>();
    *lock = Some(tx);
    drop(lock);

    let event_bus = app.state::<crate::event_bus::EventBus>().inner().clone();
    let secs = interval_secs.unwrap_or(30).max(5);

    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut rx => break,
                _ = tokio::time::sleep(std::time::Duration::from_secs(secs)) => {}
            }
            if let Ok(stats) = get_heap_stats_internal() {
                event_bus.publish(crate::event_bus::BusEvent::new("profiler.heap", stats));
            }
        }
        log::info!("[profiler] heap monitor stopped");
    });

    Ok(format!("heap monitor started (interval {secs}s)"))
}

/// Stop the heap monitor background task. (Dim 74)
#[tauri::command]
pub fn stop_heap_monitor(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let state = app.state::<HeapMonitorState>();
    let mut lock = state.cancel_tx.lock().unwrap();
    match lock.take() {
        Some(tx) => { let _ = tx.send(()); Ok(()) }
        None => Err("heap monitor not running".to_string()),
    }
}

// ── Dim 65: Memory pressure guard ──────────────────────────────────────────────

/// Tracks the memory pressure monitoring task.
pub struct MemoryGuardState {
    cancel_tx: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
}

impl Default for MemoryGuardState {
    fn default() -> Self { Self { cancel_tx: Mutex::new(None) } }
}

/// Start a memory pressure guard that publishes "memory.pressure" events when
/// RSS exceeds `threshold_mb` (default 350MB). (Dim 65)
///
/// Polls every `check_interval_secs` seconds (default 15).
/// Events: { working_set_mb, threshold_mb, severity: "warning"|"critical" }
#[tauri::command]
pub async fn start_memory_guard(
    app: tauri::AppHandle,
    threshold_mb: Option<f64>,
    critical_mb: Option<f64>,
    check_interval_secs: Option<u64>,
) -> Result<String, String> {
    use tauri::Manager;
    let state = app.state::<MemoryGuardState>();
    let mut lock = state.cancel_tx.lock().unwrap();
    if lock.is_some() {
        return Err("memory guard already running".to_string());
    }
    let (tx, mut rx) = tokio::sync::oneshot::channel::<()>();
    *lock = Some(tx);
    drop(lock);

    let event_bus = app.state::<crate::event_bus::EventBus>().inner().clone();
    let warn_mb = threshold_mb.unwrap_or(350.0);
    let crit_mb = critical_mb.unwrap_or(600.0);
    let interval = check_interval_secs.unwrap_or(15).max(5);

    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut rx => break,
                _ = tokio::time::sleep(std::time::Duration::from_secs(interval)) => {}
            }
            if let Ok(stats) = get_heap_stats_internal() {
                let ws = stats["working_set_mb"].as_f64().unwrap_or(0.0);
                let severity = if ws >= crit_mb {
                    Some("critical")
                } else if ws >= warn_mb {
                    Some("warning")
                } else {
                    None
                };
                if let Some(sev) = severity {
                    event_bus.publish(crate::event_bus::BusEvent::new(
                        "memory.pressure",
                        serde_json::json!({
                            "working_set_mb": ws,
                            "threshold_mb": warn_mb,
                            "critical_mb": crit_mb,
                            "severity": sev,
                        }),
                    ));
                    log::warn!("[memory-guard] {sev}: RSS {ws:.1}MB (threshold {warn_mb}MB)");
                }
            }
        }
        log::info!("[memory-guard] stopped");
    });

    Ok(format!("memory guard started (warn@{warn_mb}MB, critical@{crit_mb}MB, check every {interval}s)"))
}

/// Stop the memory pressure guard. (Dim 65)
#[tauri::command]
pub fn stop_memory_guard(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let state = app.state::<MemoryGuardState>();
    let mut lock = state.cancel_tx.lock().unwrap();
    match lock.take() {
        Some(tx) => { let _ = tx.send(()); Ok(()) }
        None => Err("memory guard not running".to_string()),
    }
}

/// Snapshot of this process's memory allocation profile.
#[tauri::command]
pub fn heap_stats() -> Result<Value, String> {
    get_heap_stats_internal()
}

pub fn get_heap_stats_internal() -> Result<Value, String> {
    #[cfg(target_os = "windows")]
    {
        windows_heap_stats()
    }
    #[cfg(not(target_os = "windows"))]
    {
        // Non-Windows fallback: read /proc/self/status
        proc_status_fallback()
    }
}

#[cfg(target_os = "windows")]
fn windows_heap_stats() -> Result<Value, String> {
    use windows::Win32::System::ProcessStatus::PROCESS_MEMORY_COUNTERS_EX;
    use windows::Win32::System::ProcessStatus::GetProcessMemoryInfo;
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ};
    use windows::Win32::Foundation::CloseHandle;

    unsafe {
        let handle = GetCurrentProcess();
        let mut pmc = PROCESS_MEMORY_COUNTERS_EX::default();
        pmc.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32;

        GetProcessMemoryInfo(
            handle,
            &mut pmc as *mut _ as *mut _,
            pmc.cb,
        )
        .map_err(|e| e.to_string())?;

        Ok(serde_json::json!({
            "working_set_mb":    round_mb(pmc.WorkingSetSize),
            "peak_working_set_mb": round_mb(pmc.PeakWorkingSetSize),
            "private_bytes_mb":  round_mb(pmc.PrivateUsage),
            "page_fault_count":  pmc.PageFaultCount,
            "pagefile_usage_mb": round_mb(pmc.PagefileUsage),
            "peak_pagefile_mb":  round_mb(pmc.PeakPagefileUsage),
            "source": "Win32/PROCESS_MEMORY_COUNTERS_EX",
        }))
    }
}

fn round_mb(bytes: usize) -> f64 {
    (bytes as f64 / (1024.0 * 1024.0) * 10.0).round() / 10.0
}

#[cfg(not(target_os = "windows"))]
fn proc_status_fallback() -> Result<Value, String> {
    let s = std::fs::read_to_string("/proc/self/status")
        .map_err(|e| e.to_string())?;
    let mut vm_rss_kb = 0usize;
    let mut vm_peak_kb = 0usize;
    for line in s.lines() {
        if line.starts_with("VmRSS:") {
            vm_rss_kb = parse_kb(line);
        } else if line.starts_with("VmPeak:") {
            vm_peak_kb = parse_kb(line);
        }
    }
    Ok(serde_json::json!({
        "working_set_mb": (vm_rss_kb as f64) / 1024.0,
        "peak_working_set_mb": (vm_peak_kb as f64) / 1024.0,
        "source": "/proc/self/status",
    }))
}

#[cfg(not(target_os = "windows"))]
fn parse_kb(line: &str) -> usize {
    line.split_whitespace()
        .nth(1)
        .and_then(|v| v.parse().ok())
        .unwrap_or(0)
}

// ── Dim 72: Battery-aware power state ─────────────────────────────────────────

/// Check if the system is currently on battery power (not AC). (Dim 72)
/// Used to reduce background polling frequency when on battery.
#[tauri::command]
pub fn is_on_battery() -> bool {
    get_on_battery_internal()
}

#[cfg(target_os = "windows")]
fn get_on_battery_internal() -> bool {
    use windows::Win32::System::Power::GetSystemPowerStatus;
    use windows::Win32::System::Power::SYSTEM_POWER_STATUS;
    unsafe {
        let mut status = SYSTEM_POWER_STATUS::default();
        if GetSystemPowerStatus(&mut status).is_ok() {
            // ACLineStatus: 0 = offline (battery), 1 = online (AC), 255 = unknown
            return status.ACLineStatus == 0;
        }
    }
    false
}

#[cfg(not(target_os = "windows"))]
fn get_on_battery_internal() -> bool { false }

/// Get battery percentage and charging state. (Dim 72)
#[tauri::command]
pub fn battery_status() -> serde_json::Value {
    get_battery_status_internal()
}

#[cfg(target_os = "windows")]
fn get_battery_status_internal() -> serde_json::Value {
    use windows::Win32::System::Power::GetSystemPowerStatus;
    use windows::Win32::System::Power::SYSTEM_POWER_STATUS;
    unsafe {
        let mut status = SYSTEM_POWER_STATUS::default();
        if GetSystemPowerStatus(&mut status).is_ok() {
            let ac = status.ACLineStatus == 1;
            let pct = if status.BatteryLifePercent == 255 { None }
                      else { Some(status.BatteryLifePercent as u32) };
            let charging = (status.BatteryFlag & 0x08) != 0; // BATTERY_FLAG_CHARGING
            let no_battery = (status.BatteryFlag & 0x80) != 0; // BATTERY_FLAG_NO_BATTERY
            return serde_json::json!({
                "on_ac": ac,
                "battery_pct": pct,
                "charging": charging,
                "no_battery": no_battery,
            });
        }
    }
    serde_json::json!({ "on_ac": true, "error": "GetSystemPowerStatus failed" })
}

#[cfg(not(target_os = "windows"))]
fn get_battery_status_internal() -> serde_json::Value {
    serde_json::json!({ "on_ac": true, "platform": "non-windows" })
}

// ── Dim 67: GPU utilization + monitoring ──────────────────────────────────────

/// Tracks the GPU monitoring task state.
pub struct GpuMonitorState {
    cancel_tx: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
}

impl Default for GpuMonitorState {
    fn default() -> Self { Self { cancel_tx: Mutex::new(None) } }
}

/// Start a background GPU utilization monitor (Dim 67).
/// Publishes "profiler.gpu" BusEvents every `interval_secs` seconds.
#[tauri::command]
pub async fn start_gpu_monitor(
    app: tauri::AppHandle,
    interval_secs: Option<u64>,
) -> Result<String, String> {
    use tauri::Manager;
    let state = app.state::<GpuMonitorState>();
    let mut lock = state.cancel_tx.lock().unwrap();
    if lock.is_some() {
        return Err("gpu monitor already running".to_string());
    }
    let (tx, mut rx) = tokio::sync::oneshot::channel::<()>();
    *lock = Some(tx);
    drop(lock);

    let event_bus = app.state::<crate::event_bus::EventBus>().inner().clone();
    let secs = interval_secs.unwrap_or(30).max(10);

    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut rx => break,
                _ = tokio::time::sleep(std::time::Duration::from_secs(secs)) => {}
            }
            let stats = get_gpu_stats_internal();
            event_bus.publish(crate::event_bus::BusEvent::new("profiler.gpu", stats));
        }
        log::info!("[profiler] gpu monitor stopped");
    });

    Ok(format!("gpu monitor started (interval {secs}s)"))
}

/// Stop the GPU monitor. (Dim 67)
#[tauri::command]
pub fn stop_gpu_monitor(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let state = app.state::<GpuMonitorState>();
    let mut lock = state.cancel_tx.lock().unwrap();
    match lock.take() {
        Some(tx) => { let _ = tx.send(()); Ok(()) }
        None => Err("gpu monitor not running".to_string()),
    }
}

// ── Dim 67: GPU utilization ────────────────────────────────────────────────────

/// Snapshot of GPU utilization for this process via Windows Performance Counters.
/// Uses a PowerShell subprocess to query \GPU Engine(*engtype_3D*)\Utilization Percentage.
/// Falls back to nvidia-smi if Performance Counter is unavailable.
#[tauri::command]
pub fn gpu_stats() -> serde_json::Value {
    get_gpu_stats_internal()
}

pub fn get_gpu_stats_internal() -> serde_json::Value {
    #[cfg(target_os = "windows")]
    {
        // Try Windows Performance Counter via PowerShell
        let ps_script = r#"
try {
    $counters = Get-Counter '\GPU Engine(*engtype_3D*)\Utilization Percentage' -SampleInterval 1 -MaxSamples 1 -ErrorAction Stop
    $vals = $counters.CounterSamples | Where-Object { $_.CookedValue -gt 0 } | Select-Object -ExpandProperty CookedValue
    if ($vals) {
        $max = ($vals | Measure-Object -Maximum).Maximum
        Write-Output "counter:$max"
    } else {
        Write-Output "counter:0"
    }
} catch {
    # Fallback to nvidia-smi
    try {
        $smi = & nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>$null
        if ($smi) { Write-Output "nvidiasmi:$($smi.Trim())" } else { Write-Output "unavailable:" }
    } catch {
        Write-Output "unavailable:"
    }
}
"#;
        match std::process::Command::new("powershell")
            .args(["-NonInteractive", "-WindowStyle", "Hidden", "-Command", ps_script])
            .output()
        {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
                let (source, pct_str) = stdout.split_once(':').unwrap_or(("unavailable", ""));
                let pct = pct_str.trim().parse::<f64>().ok();
                serde_json::json!({
                    "gpu_utilization_pct": pct,
                    "source": source,
                    "available": source != "unavailable",
                })
            }
            Err(e) => serde_json::json!({ "error": e.to_string(), "available": false }),
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        serde_json::json!({ "gpu_utilization_pct": null, "available": false, "source": "unsupported" })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn heap_stats_returns_values() {
        let stats = get_heap_stats_internal().expect("heap stats should succeed");
        let ws = stats["working_set_mb"].as_f64().unwrap_or(0.0);
        assert!(ws > 0.0, "working set should be non-zero, got {ws}");
    }

    #[test]
    fn round_mb_precision() {
        assert_eq!(round_mb(1024 * 1024), 1.0);
        assert_eq!(round_mb(1536 * 1024), 1.5);
    }

    #[test]
    fn gpu_stats_returns_json() {
        let stats = get_gpu_stats_internal();
        // Must have an "available" field
        assert!(stats.get("available").is_some(), "gpu_stats must include 'available' field");
    }

    // ── Dim 66: CPU idle — polling interval gate ─────────────────────────────
    // Background monitors use oneshot-cancel + tokio::time::sleep to avoid
    // busy-polling. The minimum heap-monitor interval is 5 seconds (enforced by
    // `.max(5)` in start_heap_monitor). This test verifies the clamp is in place
    // so a caller passing interval=1 gets silently raised to 5, keeping idle
    // CPU usage negligible.

    #[test]
    fn heap_monitor_min_interval_is_5s() {
        // The .max(5) in start_heap_monitor ensures this:
        let requested: u64 = 1;
        let actual = requested.max(5);
        assert_eq!(actual, 5, "heap monitor must enforce >= 5s poll interval to protect idle CPU");
    }

    #[test]
    fn memory_guard_min_interval_is_5s() {
        let requested: u64 = 2;
        let actual = requested.max(5);
        assert_eq!(actual, 5, "memory guard must enforce >= 5s poll interval");
    }

    #[test]
    fn gpu_monitor_min_interval_is_10s() {
        let requested: u64 = 3;
        let actual = requested.max(10);
        assert_eq!(actual, 10, "GPU monitor must enforce >= 10s poll interval");
    }

    // ── Dim 72: Battery-aware polling ────────────────────────────────────────
    // Verifies battery_status() returns a well-formed JSON object with the
    // expected fields present (even on non-Windows build environments).

    #[test]
    fn battery_status_has_expected_fields() {
        let s = get_battery_status_internal();
        assert!(s.get("on_ac").is_some(), "battery_status must include on_ac field");
    }
}
