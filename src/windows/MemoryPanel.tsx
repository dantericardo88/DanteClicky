import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { colors, radii, typography } from "../lib/designSystem";

interface TurnRow {
  id: number;
  user_prompt: string;
  assistant_response: string;
  screenshot_path: string | null;
  created_at: string;
}

export function MemoryPanel() {
  const [turns, setTurns] = useState<TurnRow[]>([]);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    invoke<TurnRow[]>("get_recent_turns", { limit: 20 })
      .then(setTurns)
      .catch(console.error);
  }, []);

  async function handleSearch(q: string) {
    setQuery(q);
    if (!q.trim()) {
      const recent = await invoke<TurnRow[]>("get_recent_turns", { limit: 20 });
      setTurns(recent);
      return;
    }
    setSearching(true);
    try {
      const results = await invoke<TurnRow[]>("search_history", { query: q, limit: 20 });
      setTurns(results);
    } catch (e) {
      console.error("[MemoryPanel] search failed:", e);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <input
        type="text"
        value={query}
        onChange={(e) => handleSearch(e.target.value)}
        placeholder="Search conversation history…"
        style={{
          width: "100%",
          padding: "8px 10px",
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: radii.sm,
          color: colors.text,
          fontSize: "13px",
          boxSizing: "border-box",
          outline: "none",
          fontFamily: "inherit",
        }}
      />
      {searching && (
        <div style={{ ...typography.small, color: colors.textTertiary }}>
          Searching…
        </div>
      )}
      {turns.length === 0 && !searching && (
        <div
          style={{
            ...typography.caption,
            color: colors.textTertiary,
            textAlign: "center",
            padding: "24px 0",
          }}
        >
          No conversation history yet.
          <br />
          Start talking to build memory.
        </div>
      )}
      {turns.map((turn) => (
        <div
          key={turn.id}
          style={{
            background: colors.backgroundSecondary,
            border: `1px solid ${colors.border}`,
            borderRadius: radii.sm,
            padding: "10px 12px",
          }}
        >
          <div style={{ ...typography.small, color: colors.textTertiary, marginBottom: "4px" }}>
            {new Date(turn.created_at + "Z").toLocaleString()}
          </div>
          <div
            style={{
              ...typography.caption,
              color: colors.accent,
              fontStyle: "italic",
              marginBottom: "4px",
            }}
          >
            You: {turn.user_prompt.slice(0, 120)}
            {turn.user_prompt.length > 120 ? "…" : ""}
          </div>
          <div style={{ ...typography.caption, color: colors.textSecondary }}>
            {turn.assistant_response.slice(0, 200)}
            {turn.assistant_response.length > 200 ? "…" : ""}
          </div>
        </div>
      ))}
    </div>
  );
}
