use serde::Serialize;
use std::process::Command;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuAdapter {
    pub name: String,
    pub vendor: Option<String>,
    pub vram_gb: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareProfile {
    pub os: String,
    pub arch: String,
    pub cpu_brand: String,
    pub physical_cores: usize,
    pub logical_cores: usize,
    pub total_ram_gb: f64,
    pub disk_free_gb: Option<f64>,
    pub gpu_adapters: Vec<GpuAdapter>,
    pub has_nvidia: bool,
    pub has_amd: bool,
    pub has_apple_silicon: bool,
    pub ollama_installed: bool,
    pub ollama_running: bool,
    pub ollama_version: Option<String>,
}

#[tauri::command]
pub async fn get_hardware_profile() -> HardwareProfile {
    collect_hardware_profile().await
}

pub async fn collect_hardware_profile() -> HardwareProfile {
    let gpu_adapters = gpu_adapters();
    let has_nvidia = gpu_adapters
        .iter()
        .any(|gpu| gpu.name.to_lowercase().contains("nvidia"));
    let has_amd = gpu_adapters.iter().any(|gpu| {
        let name = gpu.name.to_lowercase();
        name.contains("amd") || name.contains("radeon")
    });
    let ollama_version = ollama_version();

    HardwareProfile {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        cpu_brand: cpu_brand(),
        physical_cores: num_cpus::get_physical(),
        logical_cores: num_cpus::get(),
        total_ram_gb: total_ram_gb(),
        disk_free_gb: disk_free_gb(),
        has_apple_silicon: cfg!(target_os = "macos") && std::env::consts::ARCH == "aarch64",
        gpu_adapters,
        has_nvidia,
        has_amd,
        ollama_installed: ollama_version.is_some(),
        ollama_running: ollama_running().await,
        ollama_version,
    }
}

fn cpu_brand() -> String {
    std::env::var("PROCESSOR_IDENTIFIER")
        .or_else(|_| std::env::var("PROCESSOR_ARCHITECTURE"))
        .unwrap_or_else(|_| std::env::consts::ARCH.to_string())
}

#[cfg(target_os = "windows")]
fn total_ram_gb() -> f64 {
    let output = powershell_scalar("(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory");
    output
        .and_then(|s| s.trim().parse::<f64>().ok())
        .map(bytes_to_gb)
        .unwrap_or(0.0)
}

#[cfg(not(target_os = "windows"))]
fn total_ram_gb() -> f64 {
    0.0
}

#[cfg(target_os = "windows")]
fn disk_free_gb() -> Option<f64> {
    powershell_scalar("(Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='C:'\").FreeSpace")
        .and_then(|s| s.trim().parse::<f64>().ok())
        .map(bytes_to_gb)
}

#[cfg(not(target_os = "windows"))]
fn disk_free_gb() -> Option<f64> {
    None
}

#[cfg(target_os = "windows")]
fn gpu_adapters() -> Vec<GpuAdapter> {
    let script = "Get-CimInstance Win32_VideoController | ForEach-Object { \"$($_.Name)|$($_.AdapterRAM)\" }";
    powershell_scalar(script)
        .map(|raw| {
            raw.lines()
                .filter_map(|line| {
                    let mut parts = line.split('|');
                    let name = parts.next()?.trim();
                    if name.is_empty() {
                        return None;
                    }
                    let vram_gb = parts
                        .next()
                        .and_then(|value| value.trim().parse::<f64>().ok())
                        .map(bytes_to_gb)
                        .filter(|value| *value > 0.0);
                    Some(GpuAdapter {
                        name: name.to_string(),
                        vendor: vendor_for_gpu(name),
                        vram_gb,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(not(target_os = "windows"))]
fn gpu_adapters() -> Vec<GpuAdapter> {
    Vec::new()
}

fn vendor_for_gpu(name: &str) -> Option<String> {
    let lower = name.to_lowercase();
    if lower.contains("nvidia") {
        Some("NVIDIA".to_string())
    } else if lower.contains("amd") || lower.contains("radeon") {
        Some("AMD".to_string())
    } else if lower.contains("intel") {
        Some("Intel".to_string())
    } else {
        None
    }
}

fn bytes_to_gb(bytes: f64) -> f64 {
    ((bytes / 1_073_741_824.0) * 10.0).round() / 10.0
}

#[cfg(target_os = "windows")]
fn powershell_scalar(script: &str) -> Option<String> {
    let output = Command::new("powershell")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn ollama_version() -> Option<String> {
    let output = Command::new("ollama").arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

async fn ollama_running() -> bool {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(600))
        .build();
    let Ok(client) = client else {
        return false;
    };
    client
        .get("http://localhost:11434/api/tags")
        .send()
        .await
        .map(|res| res.status().is_success())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hardware_profile_has_stable_schema() {
        let profile = tauri::async_runtime::block_on(collect_hardware_profile());
        assert!(!profile.os.is_empty());
        assert!(profile.logical_cores >= 1);
    }
}
