/// Dim 91 — Shell / terminal integration (PowerShell + bash hooks).
///
/// Exposes DanteClicky as a shell-accessible tool by:
///   1. Writing a PowerShell helper module to AppData that external terminals
///      can dot-source to get dc_ask, dc_screenshot, dc_status functions.
///   2. Writing a POSIX sh helper script for WSL/bash usage.
///   3. Providing a Tauri command to query recent shell hook invocations.
///
/// The shell helpers communicate with DC via the MCP REST API on port 9002.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const POWERSHELL_MODULE: &str = r#"
# DanteClicky PowerShell integration module
# Dot-source this file: . "$env:APPDATA\DanteClicky\shell\dante.psm1"
# Or add to your $PROFILE for permanent access.

$DC_API = "http://127.0.0.1:9002"

function dc_status {
    try { (Invoke-RestMethod "$DC_API/health") | ConvertTo-Json }
    catch { Write-Warning "DanteClicky not running (start the app first)" }
}

function dc_tools {
    try { (Invoke-RestMethod "$DC_API/v1/tools").tools | Select-Object name, description }
    catch { Write-Warning "Could not reach DanteClicky REST API" }
}

function dc_screenshot {
    param([int]$Monitor = 0)
    try {
        $r = Invoke-RestMethod "$DC_API/v1/screenshot?monitor=$Monitor"
        Write-Output "Screenshot captured. Width=$($r.width) Height=$($r.height)"
        $r
    } catch { Write-Warning "Screenshot failed: $_" }
}

function dc_ask {
    param([Parameter(Mandatory)][string]$Prompt, [string]$Provider = "anthropic")
    try {
        $body = @{ name = "clicky_ask"; input = @{ prompt = $Prompt; provider = $Provider } } | ConvertTo-Json
        $r = Invoke-RestMethod -Method POST "$DC_API/v1/tool/clicky_ask" -Body $body -ContentType "application/json"
        $r.result
    } catch { Write-Warning "dc_ask failed: $_" }
}

function dc_events {
    param([int]$Limit = 20)
    try { (Invoke-RestMethod "$DC_API/v1/events?limit=$Limit").events }
    catch { Write-Warning "Could not fetch events: $_" }
}

Export-ModuleMember -Function dc_status, dc_tools, dc_screenshot, dc_ask, dc_events
"#;

const BASH_SCRIPT: &str = r#"#!/usr/bin/env sh
# DanteClicky bash/WSL integration helpers
# Source this file: . ~/.config/dante/dante.sh
# Or add to ~/.bashrc for permanent access.

DC_API="http://127.0.0.1:9002"

dc_status() { curl -s "$DC_API/health" | python3 -m json.tool 2>/dev/null || echo "DanteClicky not running"; }
dc_tools()  { curl -s "$DC_API/v1/tools" | python3 -m json.tool 2>/dev/null; }
dc_events() { curl -s "$DC_API/v1/events?limit=${1:-20}" | python3 -m json.tool 2>/dev/null; }
dc_screenshot() { curl -s "$DC_API/v1/screenshot?monitor=${1:-0}"; }
dc_ask() {
    local prompt="$1"
    curl -s -X POST "$DC_API/v1/tool/clicky_ask" \
        -H "Content-Type: application/json" \
        -d "{\"name\":\"clicky_ask\",\"input\":{\"prompt\":$(printf '%s' "$prompt" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),\"provider\":\"anthropic\"}}"
}
"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellHookPaths {
    pub powershell_module: String,
    pub bash_script: String,
    pub api_base: String,
}

fn shell_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join("shell"))
        .map_err(|e| e.to_string())
}

/// Install the shell helper scripts into AppData.
fn install_helpers(app: &AppHandle) -> Result<ShellHookPaths, String> {
    let dir = shell_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let ps_path = dir.join("dante.psm1");
    std::fs::write(&ps_path, POWERSHELL_MODULE).map_err(|e| e.to_string())?;

    let sh_path = dir.join("dante.sh");
    std::fs::write(&sh_path, BASH_SCRIPT).map_err(|e| e.to_string())?;

    Ok(ShellHookPaths {
        powershell_module: ps_path.to_string_lossy().into_owned(),
        bash_script: sh_path.to_string_lossy().into_owned(),
        api_base: "http://127.0.0.1:9002".to_string(),
    })
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Install PowerShell and bash shell helper scripts. Returns the paths so the
/// user can dot-source them. (Dim 91)
#[tauri::command]
pub fn install_shell_hooks(app: AppHandle) -> Result<ShellHookPaths, String> {
    let paths = install_helpers(&app)?;
    log::info!("[shell_hooks] installed helpers: ps={} sh={}", paths.powershell_module, paths.bash_script);
    Ok(paths)
}

/// Return the paths to installed shell hook scripts without re-installing.
#[tauri::command]
pub fn get_shell_hook_paths(app: AppHandle) -> Result<ShellHookPaths, String> {
    let dir = shell_dir(&app)?;
    Ok(ShellHookPaths {
        powershell_module: dir.join("dante.psm1").to_string_lossy().into_owned(),
        bash_script: dir.join("dante.sh").to_string_lossy().into_owned(),
        api_base: "http://127.0.0.1:9002".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn powershell_module_contains_dc_functions() {
        assert!(POWERSHELL_MODULE.contains("function dc_status"));
        assert!(POWERSHELL_MODULE.contains("function dc_ask"));
        assert!(POWERSHELL_MODULE.contains("function dc_screenshot"));
        assert!(POWERSHELL_MODULE.contains("Export-ModuleMember"));
    }

    #[test]
    fn bash_script_contains_dc_functions() {
        assert!(BASH_SCRIPT.contains("dc_status()"));
        assert!(BASH_SCRIPT.contains("dc_ask()"));
        assert!(BASH_SCRIPT.contains("DC_API="));
    }
}
