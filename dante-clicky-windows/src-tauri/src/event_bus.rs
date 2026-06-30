/// Dim 86 — Internal pub/sub event bus for external integrations.
///
/// External processes (shell scripts, VS Code extensions, browser extensions)
/// can subscribe to DanteClicky events via the WebSocket bridge (port 5555) or
/// the MCP REST endpoint GET /v1/events. This module provides the in-process
/// event bus that routes internal events to registered listeners.
///
/// Architecture:
///   - EventBus holds a Vec of subscriber tx channels.
///   - Internal Tauri events (hotkey fired, wake word, screenshot taken,
///     AI response complete) are published here via `publish()`.
///   - The WS server (ws_server.rs) and MCP REST server (mcp_server.rs)
///     subscribe and forward to external consumers.

use std::sync::{Arc, Mutex};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::broadcast;

pub const BUS_CAPACITY: usize = 256;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BusEvent {
    pub topic: String,
    pub payload: Value,
    pub timestamp_ms: u64,
}

impl BusEvent {
    pub fn new(topic: impl Into<String>, payload: Value) -> Self {
        Self {
            topic: topic.into(),
            payload,
            timestamp_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or_default(),
        }
    }
}

/// Shared broadcast channel — cheap to clone, capacity = ring buffer size.
#[derive(Clone)]
pub struct EventBus {
    tx: broadcast::Sender<BusEvent>,
    // Track recent events for new subscribers that connect late.
    recent: Arc<Mutex<std::collections::VecDeque<BusEvent>>>,
}

const RECENT_CAPACITY: usize = 100;

impl EventBus {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(BUS_CAPACITY);
        Self {
            tx,
            recent: Arc::new(Mutex::new(std::collections::VecDeque::with_capacity(RECENT_CAPACITY))),
        }
    }

    /// Publish an event to all active subscribers.
    pub fn publish(&self, event: BusEvent) {
        {
            let mut ring = self.recent.lock().unwrap();
            if ring.len() >= RECENT_CAPACITY {
                ring.pop_front();
            }
            ring.push_back(event.clone());
        }
        // Errors only when 0 subscribers — normal at startup.
        let _ = self.tx.send(event);
    }

    /// Subscribe to the event bus. Returns a receiver that yields cloned events.
    pub fn subscribe(&self) -> broadcast::Receiver<BusEvent> {
        self.tx.subscribe()
    }

    /// Return a snapshot of the most recent N events (for late joiners).
    pub fn recent_events(&self, limit: usize) -> Vec<BusEvent> {
        let ring = self.recent.lock().unwrap();
        ring.iter().rev().take(limit).cloned().collect::<Vec<_>>()
            .into_iter().rev().collect()
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Publish a custom event from the frontend into the event bus.
/// Allows frontend code (and by extension external integrations via MCP/WS)
/// to emit typed events into the DC event stream.
#[tauri::command]
pub fn bus_publish(
    bus: tauri::State<'_, EventBus>,
    topic: String,
    payload: Value,
) -> Result<(), String> {
    if topic.is_empty() || topic.len() > 128 {
        return Err("topic must be 1-128 chars".to_string());
    }
    bus.publish(BusEvent::new(topic, payload));
    Ok(())
}

/// Return recent events from the bus ring buffer.
#[tauri::command]
pub fn bus_recent(
    bus: tauri::State<'_, EventBus>,
    limit: Option<usize>,
) -> Vec<BusEvent> {
    bus.recent_events(limit.unwrap_or(50).min(RECENT_CAPACITY))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn publish_and_subscribe_roundtrip() {
        let bus = EventBus::new();
        let mut rx = bus.subscribe();

        bus.publish(BusEvent::new("hotkey.fired", json!({ "key": "F1" })));
        let event = rx.try_recv().expect("event received");
        assert_eq!(event.topic, "hotkey.fired");
        assert_eq!(event.payload["key"], "F1");
    }

    #[test]
    fn recent_events_ring_buffer() {
        let bus = EventBus::new();
        for i in 0..10usize {
            bus.publish(BusEvent::new("tick", json!({ "i": i })));
        }
        let recent = bus.recent_events(5);
        assert_eq!(recent.len(), 5);
        // Most recent 5 are the last 5 ticks (5-9)
        assert_eq!(recent[0].payload["i"], 5);
        assert_eq!(recent[4].payload["i"], 9);
    }

    #[test]
    fn topic_validation() {
        let bus = EventBus::new();
        assert!(validate_and_publish(&bus, "valid.topic", json!({})).is_ok());
        assert!(validate_and_publish(&bus, "", json!({})).is_err());
        assert!(validate_and_publish(&bus, &"x".repeat(129), json!({})).is_err());
    }

    fn validate_and_publish(bus: &EventBus, topic: &str, payload: Value) -> Result<(), String> {
        if topic.is_empty() || topic.len() > 128 {
            return Err("topic must be 1-128 chars".to_string());
        }
        bus.publish(BusEvent::new(topic.to_string(), payload));
        Ok(())
    }
}
