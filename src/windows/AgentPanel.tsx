import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { colors, radii, typography } from "../lib/designSystem";

interface ToolCallEntry {
  timestamp: string;
  tool: string;
  args: string;
}

export function AgentPanel() {
  const [wsConnected, setWsConnected] = useState(false);
  const [connectionCount, setConnectionCount] = useState(0);
  const [recentTools, setRecentTools] = useState<ToolCallEntry[]>([]);

  useEffect(() => {
    const poll = () => {
      invoke<number>("get_ws_connection_count")
        .then((n) => {
          setConnectionCount(n);
          setWsConnected(n > 0);
        })
        .catch(() => {
          setConnectionCount(0);
          setWsConnected(false);
        });
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const unlisten = listen<{ tool: string; args: string }>("ws-tool-call", (e) => {
      setRecentTools((prev) => [
        {
          timestamp: new Date().toLocaleTimeString(),
          tool: e.payload.tool,
          args: e.payload.args,
        },
        ...prev.slice(0, 4),
      ]);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {/* Connection status */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          background: colors.backgroundSecondary,
          border: `1px solid ${colors.border}`,
          borderRadius: radii.md,
          padding: "10px 12px",
        }}
      >
        <div
          style={{
            width: "10px",
            height: "10px",
            borderRadius: radii.full,
            background: wsConnected ? "#32D74B" : colors.textTertiary,
            boxShadow: wsConnected ? "0 0 6px #32D74B" : "none",
            flexShrink: 0,
          }}
        />
        <div>
          <div
            style={{
              ...typography.body,
              color: wsConnected ? "#32D74B" : colors.textSecondary,
            }}
          >
            {wsConnected
              ? `DanteAgents connected (${connectionCount})`
              : "DanteAgents offline"}
          </div>
          <div style={{ ...typography.small, color: colors.textTertiary, marginTop: "2px" }}>
            WebSocket: ws://127.0.0.1:9001
          </div>
        </div>
      </div>

      {/* Recent tool calls */}
      <div
        style={{
          ...typography.small,
          color: colors.textTertiary,
          textTransform: "uppercase" as const,
          letterSpacing: "0.06em",
        }}
      >
        Recent Tool Calls
      </div>
      {recentTools.length === 0 ? (
        <div
          style={{
            ...typography.caption,
            color: colors.textTertiary,
            textAlign: "center" as const,
            padding: "16px 0",
          }}
        >
          No tool calls yet.
          <br />
          Connect DanteAgents to start.
        </div>
      ) : (
        recentTools.map((entry, i) => (
          <div
            key={i}
            style={{
              background: colors.backgroundSecondary,
              border: `1px solid ${colors.border}`,
              borderRadius: radii.sm,
              padding: "8px 10px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "2px",
              }}
            >
              <span
                style={{
                  ...typography.caption,
                  color: colors.accent,
                  fontFamily: "monospace",
                }}
              >
                {entry.tool}
              </span>
              <span style={{ ...typography.small, color: colors.textTertiary }}>
                {entry.timestamp}
              </span>
            </div>
            <div
              style={{
                ...typography.small,
                color: colors.textTertiary,
                fontFamily: "monospace",
              }}
            >
              {entry.args.slice(0, 80)}
              {entry.args.length > 80 ? "…" : ""}
            </div>
          </div>
        ))
      )}

      {/* Server info */}
      <div
        style={{
          background: colors.backgroundSecondary,
          border: `1px solid ${colors.border}`,
          borderRadius: radii.sm,
          padding: "10px 12px",
          display: "flex",
          flexDirection: "column",
          gap: "4px",
        }}
      >
        <div style={{ ...typography.small, color: colors.textTertiary }}>
          MCP Server: http://127.0.0.1:9002
        </div>
        <div style={{ ...typography.small, color: colors.textTertiary }}>
          Protocol: MCP 2024-11-05
        </div>
      </div>
    </div>
  );
}
