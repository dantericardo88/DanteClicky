import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { colors, radii, typography } from "../lib/designSystem";
import { useMoondream } from "../hooks/useMoondream";

interface ToolCallEntry {
  timestamp: string;
  tool: string;
  args: string;
}

export function AgentPanel() {
  const [wsConnected, setWsConnected] = useState(false);
  const [connectionCount, setConnectionCount] = useState(0);
  const [recentTools, setRecentTools] = useState<ToolCallEntry[]>([]);
  const [mcpOnline, setMcpOnline] = useState(false);
  const [mcpCopied, setMcpCopied] = useState(false);
  const moondream = useMoondream();

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
    const check = () => {
      const ctrl = new AbortController();
      fetch("http://127.0.0.1:9002/sse", { signal: ctrl.signal })
        .then(() => setMcpOnline(true))
        .catch((e) => { if (e.name !== "AbortError") setMcpOnline(false); });
      setTimeout(() => ctrl.abort(), 800);
    };
    check();
    const id = setInterval(check, 5000);
    return () => clearInterval(id);
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

      {/* MCP server status */}
      <div
        style={{
          background: colors.backgroundSecondary,
          border: `1px solid ${colors.border}`,
          borderRadius: radii.sm,
          padding: "10px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1 }}>
          <div
            style={{
              width: "8px",
              height: "8px",
              borderRadius: radii.full,
              background: mcpOnline ? colors.success : colors.error,
              boxShadow: mcpOnline ? `0 0 6px ${colors.success}` : "none",
              flexShrink: 0,
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <div style={{ ...typography.body, color: mcpOnline ? colors.success : colors.error }}>
              {mcpOnline ? "MCP online" : "MCP offline"} · :9002
            </div>
            <div style={{ ...typography.small, color: colors.textTertiary }}>
              Protocol: MCP 2024-11-05
            </div>
          </div>
        </div>
        <button
          onClick={() => {
            const config = JSON.stringify({
              "mcpServers": {
                "danteclicky": {
                  "url": "http://localhost:9002/sse"
                }
              }
            }, null, 2);
            navigator.clipboard.writeText(config).catch(() => {});
            setMcpCopied(true);
            setTimeout(() => setMcpCopied(false), 2000);
          }}
          style={{
            padding: "6px 10px",
            background: mcpCopied ? colors.success : colors.accent,
            border: "none",
            borderRadius: radii.sm,
            color: "#fff",
            cursor: "pointer",
            ...typography.caption,
            fontWeight: 600,
            flexShrink: 0,
            transition: "background 0.15s",
          }}
        >
          {mcpCopied ? "✓ Copied!" : "Copy config"}
        </button>
      </div>

      {/* Local Vision (Moondream2) status */}
      <div
        style={{
          background: colors.backgroundSecondary,
          border: `1px solid ${colors.border}`,
          borderRadius: radii.sm,
          padding: "10px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1 }}>
          <div
            style={{
              width: "8px",
              height: "8px",
              borderRadius: radii.full,
              background: moondream.status?.session_loaded
                ? colors.success
                : moondream.status?.available
                ? colors.warning
                : colors.border,
              boxShadow: moondream.status?.session_loaded ? `0 0 6px ${colors.success}` : "none",
              flexShrink: 0,
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: "2px", flex: 1 }}>
            <div
              style={{
                ...typography.body,
                color: moondream.status?.session_loaded ? colors.success : colors.text,
              }}
            >
              {moondream.status?.session_loaded
                ? "Vision ready"
                : moondream.status?.available
                ? "Model ready"
                : "Vision offline"}
            </div>
            <div style={{ ...typography.small, color: colors.textTertiary }}>
              {moondream.downloading
                ? `Downloading: ${moondream.downloadProgress?.file || "..."}`
                : moondream.status?.last_inference_ms
                ? `Last: ${moondream.status.last_inference_ms}ms`
                : "~900MB · CPU 5-15s"}
            </div>
            {moondream.status?.last_description && (
              <div
                style={{
                  ...typography.small,
                  color: colors.textTertiary,
                  maxWidth: "300px",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {moondream.status.last_description.slice(0, 80)}
              </div>
            )}
          </div>
        </div>
        {moondream.downloading && moondream.downloadProgress ? (
          <div
            style={{
              width: "60px",
              height: "4px",
              background: colors.border,
              borderRadius: radii.full,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                background: colors.accent,
                width: `${Math.round((moondream.downloadProgress.bytes_done / moondream.downloadProgress.bytes_total) * 100)}%`,
                transition: "width 0.2s",
              }}
            />
          </div>
        ) : !moondream.status?.available ? (
          <button
            onClick={() => {
              moondream.download().catch(() => {});
            }}
            disabled={moondream.downloading}
            style={{
              padding: "6px 10px",
              background: moondream.downloading ? colors.border : colors.accent,
              border: "none",
              borderRadius: radii.sm,
              color: "#fff",
              cursor: moondream.downloading ? "default" : "pointer",
              ...typography.caption,
              fontWeight: 600,
              flexShrink: 0,
              opacity: moondream.downloading ? 0.6 : 1,
            }}
          >
            {moondream.downloading ? "..." : "Download"}
          </button>
        ) : !moondream.status?.session_loaded ? (
          <button
            onClick={() => {
              moondream.loadModel().catch(() => {});
            }}
            style={{
              padding: "6px 10px",
              background: colors.accent,
              border: "none",
              borderRadius: radii.sm,
              color: "#fff",
              cursor: "pointer",
              ...typography.caption,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            Load
          </button>
        ) : null}
      </div>
    </div>
  );
}
