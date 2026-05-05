// computer_use.rs — multi-step computer use loop
// Claude can call tools iteratively: capture → reason → execute → re-capture → repeat

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime};

#[derive(Debug, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub input: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoopStep {
    pub step: u32,
    pub tool_name: String,
    pub label: String,
}

/// Emits a step-progress event to the overlay so it can show "Step 2/10: clicking..."
pub fn emit_step<R: Runtime>(app: &AppHandle<R>, step: u32, max_steps: u32, label: &str) {
    app.emit(
        "cu-step",
        serde_json::json!({
            "step": step,
            "max_steps": max_steps,
            "label": label,
        }),
    )
    .ok();
}

/// Emits a loop-done event when the loop finishes
pub fn emit_done<R: Runtime>(app: &AppHandle<R>, steps_taken: u32) {
    app.emit("cu-done", serde_json::json!({ "steps_taken": steps_taken }))
        .ok();
}
