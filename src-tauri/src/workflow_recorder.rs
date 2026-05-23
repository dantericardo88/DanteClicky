/// Dim 99 — Workflow recording and replay.
///
/// Records sequences of AI actions (keypress, screenshot, tool calls, agent
/// decisions) into a named workflow. Saved workflows can be replayed to
/// automate repetitive computer-use tasks.
///
/// Architecture:
///   - WorkflowRecorder holds an in-memory Vec<WorkflowStep> while recording.
///   - Steps are appended via record_step().
///   - stop_recording() serializes to JSON and saves to AppData/workflows/.
///   - replay_workflow() reads a saved workflow and re-executes each step.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowStep {
    pub step_type: String,   // "keypress" | "screenshot" | "tool_call" | "ai_response"
    pub params: Value,
    pub timestamp_ms: u64,
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workflow {
    pub name: String,
    pub description: Option<String>,
    pub steps: Vec<WorkflowStep>,
    pub recorded_at: String,
    pub version: u32,
}

pub struct WorkflowState {
    recording: Mutex<Option<(String, Vec<WorkflowStep>)>>,
}

impl Default for WorkflowState {
    fn default() -> Self {
        Self { recording: Mutex::new(None) }
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default()
}

fn workflows_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join("workflows"))
        .map_err(|e| e.to_string())
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Start recording a workflow with the given name. (Dim 99)
#[tauri::command]
pub fn start_recording(
    state: tauri::State<'_, WorkflowState>,
    name: String,
) -> Result<(), String> {
    if name.is_empty() || name.len() > 100 {
        return Err("name must be 1-100 chars".to_string());
    }
    let mut rec = state.recording.lock().unwrap();
    if rec.is_some() {
        return Err("already recording".to_string());
    }
    *rec = Some((name, Vec::new()));
    Ok(())
}

/// Append a step to the current recording. (Dim 99)
#[tauri::command]
pub fn record_step(
    state: tauri::State<'_, WorkflowState>,
    step_type: String,
    params: Value,
) -> Result<(), String> {
    let mut rec = state.recording.lock().unwrap();
    let (_, steps) = rec.as_mut().ok_or("not recording")?;
    steps.push(WorkflowStep {
        step_type,
        params,
        timestamp_ms: now_ms(),
        duration_ms: None,
    });
    Ok(())
}

/// Stop recording and save the workflow to disk. Returns the saved file path. (Dim 99)
#[tauri::command]
pub fn stop_recording(
    app: AppHandle,
    state: tauri::State<'_, WorkflowState>,
    description: Option<String>,
) -> Result<String, String> {
    let (name, steps) = {
        let mut rec = state.recording.lock().unwrap();
        rec.take().ok_or("not recording")?
    };

    let workflow = Workflow {
        name: name.clone(),
        description,
        steps,
        recorded_at: chrono_now_iso(),
        version: 1,
    };

    let dir = workflows_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // Sanitize filename
    let safe_name: String = name.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let path = dir.join(format!("{safe_name}.workflow.json"));

    let json = serde_json::to_string_pretty(&workflow).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;

    log::info!("[workflow] saved '{}' ({} steps) to {:?}", name, workflow.steps.len(), path);
    Ok(path.to_string_lossy().into_owned())
}

/// Replay a saved workflow — re-execute each step using DC's Tauri commands.
/// Returns a list of step results. (Dim 99)
#[tauri::command]
pub async fn replay_workflow(
    app: AppHandle,
    name: String,
    dry_run: Option<bool>,
) -> Result<Vec<serde_json::Value>, String> {
    let dir = workflows_dir(&app)?;
    let safe_name: String = name.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let path = dir.join(format!("{safe_name}.workflow.json"));
    let bytes = std::fs::read(&path).map_err(|e| format!("workflow not found: {e}"))?;
    let workflow: Workflow = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;

    let is_dry = dry_run.unwrap_or(false);
    let mut results = Vec::new();

    for (i, step) in workflow.steps.iter().enumerate() {
        let t0 = std::time::Instant::now();
        let result = if is_dry {
            serde_json::json!({ "step": i, "type": step.step_type, "dry_run": true, "skipped": true })
        } else {
            execute_step(&app, step).await
        };
        let elapsed = t0.elapsed().as_millis();
        results.push(serde_json::json!({
            "step": i,
            "type": step.step_type,
            "elapsed_ms": elapsed,
            "result": result,
        }));

        // Honour any recorded inter-step delay (capped at 5s for safety)
        if let Some(dur) = step.duration_ms {
            let delay = std::cmp::min(dur, 5_000);
            if delay > 0 && !is_dry {
                tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
            }
        }
    }

    log::info!("[workflow] replayed '{}' — {} steps", name, results.len());
    Ok(results)
}

async fn execute_step(app: &AppHandle, step: &WorkflowStep) -> serde_json::Value {
    match step.step_type.as_str() {
        "keypress" => {
            let keys: Vec<String> = step.params["keys"]
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect();
            match crate::input::computer_use_keypress(keys) {
                Ok(()) => serde_json::json!({ "ok": true }),
                Err(e) => serde_json::json!({ "error": e }),
            }
        }
        "screenshot" => {
            let monitor = step.params["monitor"].as_u64().unwrap_or(0) as usize;
            match crate::capture::capture_monitor(monitor) {
                Ok(r) => r,
                Err(e) => serde_json::json!({ "error": e }),
            }
        }
        "wait_ms" => {
            let ms = step.params["ms"].as_u64().unwrap_or(0).min(5_000);
            tokio::time::sleep(std::time::Duration::from_millis(ms)).await;
            serde_json::json!({ "waited_ms": ms })
        }
        "tool_call" => {
            // Replay a recorded tool call by re-routing to the MCP server over localhost.
            // This lets recorded workflows re-invoke any registered tool without direct coupling.
            let tool_name = step.params["tool"].as_str().unwrap_or("").to_string();
            let input = step.params.get("input").cloned().unwrap_or_default();
            if tool_name.is_empty() {
                return serde_json::json!({ "error": "tool_call step missing 'tool' field" });
            }
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .unwrap_or_default();
            match client
                .post(format!("http://127.0.0.1:9002/v1/tool/{tool_name}"))
                .json(&serde_json::json!({ "name": tool_name, "input": input }))
                .send()
                .await
            {
                Ok(r) => r.json::<serde_json::Value>().await
                    .unwrap_or_else(|_| serde_json::json!({ "ok": true })),
                Err(e) => serde_json::json!({ "error": format!("tool_call failed: {e}") }),
            }
        }
        "mouse_click" => {
            let x = step.params["x"].as_i64().unwrap_or(0) as i32;
            let y = step.params["y"].as_i64().unwrap_or(0) as i32;
            match crate::input::computer_use_click(x, y) {
                Ok(()) => serde_json::json!({ "ok": true, "x": x, "y": y }),
                Err(e) => serde_json::json!({ "error": e }),
            }
        }
        "type_text" => {
            let text = step.params["text"].as_str().unwrap_or("").to_string();
            match crate::input::computer_use_type(text.clone()) {
                Ok(()) => serde_json::json!({ "ok": true, "chars": text.len() }),
                Err(e) => serde_json::json!({ "error": e }),
            }
        }
        _ => {
            serde_json::json!({ "skipped": true, "reason": "unsupported step type" })
        }
    }
}

/// List saved workflows. (Dim 99)
#[tauri::command]
pub fn list_workflows(app: AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let dir = workflows_dir(&app)?;
    if !dir.exists() { return Ok(vec![]); }

    let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
    let mut result = vec![];
    for entry in entries.filter_map(|e| e.ok()) {
        if entry.path().extension().and_then(|x| x.to_str()) != Some("json") { continue; }
        if let Ok(bytes) = std::fs::read(entry.path()) {
            if let Ok(w) = serde_json::from_slice::<Workflow>(&bytes) {
                result.push(serde_json::json!({
                    "name": w.name,
                    "description": w.description,
                    "steps": w.steps.len(),
                    "recordedAt": w.recorded_at,
                }));
            }
        }
    }
    Ok(result)
}

/// Load a saved workflow by name. (Dim 99)
#[tauri::command]
pub fn load_workflow(app: AppHandle, name: String) -> Result<Workflow, String> {
    let dir = workflows_dir(&app)?;
    let safe_name: String = name.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let path = dir.join(format!("{safe_name}.workflow.json"));
    let bytes = std::fs::read(&path).map_err(|e| format!("workflow not found: {e}"))?;
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}

fn chrono_now_iso() -> String {
    let d = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = d.as_secs();
    // Simple ISO 8601 approximation (seconds precision)
    let (y, mo, day, h, mi, s) = secs_to_ymdhms(secs);
    format!("{y:04}-{mo:02}-{day:02}T{h:02}:{mi:02}:{s:02}Z")
}

fn secs_to_ymdhms(secs: u64) -> (u64, u64, u64, u64, u64, u64) {
    let s = secs % 60;
    let mins = secs / 60;
    let mi = mins % 60;
    let hours = mins / 60;
    let h = hours % 24;
    let days = hours / 24;
    // Simplified Gregorian calendar (good enough for timestamps)
    let mut year = 1970u64;
    let mut remaining = days;
    loop {
        let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
        let days_in_year = if leap { 366 } else { 365 };
        if remaining < days_in_year { break; }
        remaining -= days_in_year;
        year += 1;
    }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days_in_month = [31u64, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut month = 0u64;
    for dim in &days_in_month {
        if remaining < *dim { break; }
        remaining -= dim;
        month += 1;
    }
    (year, month + 1, remaining + 1, h, mi, s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn workflow_step_serializes() {
        let step = WorkflowStep {
            step_type: "keypress".to_string(),
            params: json!({ "keys": ["ctrl", "c"] }),
            timestamp_ms: 1716_000_000_000,
            duration_ms: Some(50),
        };
        let s = serde_json::to_string(&step).unwrap();
        assert!(s.contains("keypress"));
        assert!(s.contains("ctrl"));
    }

    #[test]
    fn iso_timestamp_format() {
        let ts = chrono_now_iso();
        assert!(ts.contains('T'));
        assert!(ts.ends_with('Z'));
        assert_eq!(ts.len(), 20); // YYYY-MM-DDTHH:MM:SSZ
    }
}
