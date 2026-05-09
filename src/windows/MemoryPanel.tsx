import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { colors, radii, typography } from "../lib/designSystem";
import { useEmbedding } from "../hooks/useEmbedding";
import { useCompanionStore } from "../state/companionStore";
import type { DigestFact } from "../lib/memoryConsolidation";
import type { PreferenceProfile, PreferenceTrait } from "../lib/preferenceLearning";

interface TurnRow {
  id: number;
  user_prompt: string;
  assistant_response: string;
  screenshot_path: string | null;
  created_at: string;
}

type ScoredTurnRow = TurnRow & { score: number };

interface PreferenceEventRow {
  id: number;
  turn_id: number;
  signal: string;
  source: string;
  weight: number;
  reason?: string | null;
  raw_text?: string | null;
  active: boolean;
  created_at: string;
  user_prompt: string;
  assistant_response: string;
}

interface SessionMetaRow {
  date_key: string;
  label: string | null;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatPercent(value: number | undefined): string {
  const clamped = Math.max(0, Math.min(1, value ?? 0));
  return `${Math.round(clamped * 100)}%`;
}

function formatSignal(signal: string): string {
  return signal.replace(/_/g, " ");
}

function compactText(text: string | null | undefined, maxLength: number): string {
  const normalized = (text ?? "").replace(/\s+/g, " ").trim();
  const chars = Array.from(normalized);
  if (chars.length <= maxLength) return normalized;
  return `${chars.slice(0, Math.max(0, maxLength - 3)).join("").trimEnd()}...`;
}

function traitDisplayLabel(trait: PreferenceTrait): string {
  return trait.user_label?.trim() || trait.label;
}

function traitStatusColor(trait: PreferenceTrait): string {
  if (trait.status === "disabled" || trait.status === "deleted") return colors.textTertiary;
  if (trait.status === "conflicted") return colors.warning;
  if (trait.status === "low_confidence") return colors.textTertiary;
  return trait.score >= 0 ? colors.success : colors.error;
}

function traitStatusBackground(trait: PreferenceTrait): string {
  if (trait.status === "conflicted") return "rgba(255,159,10,0.14)";
  if (trait.status === "disabled" || trait.status === "deleted" || trait.status === "low_confidence") {
    return "rgba(235,235,245,0.08)";
  }
  return trait.score >= 0 ? "rgba(50,215,75,0.14)" : "rgba(255,69,58,0.14)";
}

function TurnCard({
  turn,
  deletingId,
  onDelete,
}: {
  turn: TurnRow & { score?: number };
  deletingId: number | null;
  onDelete: (id: number) => void;
}) {
  return (
    <div
      style={{
        background: colors.backgroundSecondary,
        border: `1px solid ${colors.border}`,
        borderRadius: radii.sm,
        padding: "10px 12px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
        <span style={{ ...typography.small, color: colors.textTertiary }}>
          {new Date(turn.created_at + "Z").toLocaleString()}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {turn.score !== undefined && (
            <span
              style={{
                fontSize: "9px",
                fontFamily: "inherit",
                padding: "1px 5px",
                borderRadius: 3,
                background:
                  turn.score >= 0.7 ? "rgba(52,199,89,0.15)" :
                  turn.score >= 0.4 ? "rgba(255,159,10,0.15)" :
                  "rgba(255,255,255,0.06)",
                color:
                  turn.score >= 0.7 ? "#34C759" :
                  turn.score >= 0.4 ? "#FF9F0A" :
                  colors.textTertiary,
              }}
            >
              {turn.score.toFixed(2)}
            </span>
          )}
          <button
            onClick={() => onDelete(turn.id)}
            disabled={deletingId === turn.id}
            title="Delete this conversation"
            style={{
              padding: "1px 5px",
              background: "transparent",
              border: "1px solid rgba(255,69,58,0.3)",
              borderRadius: 3,
              color: "rgba(255,69,58,0.7)",
              cursor: deletingId === turn.id ? "default" : "pointer",
              fontSize: "10px",
              fontFamily: "inherit",
              opacity: deletingId === turn.id ? 0.5 : 1,
              lineHeight: 1,
            }}
          >
            {deletingId === turn.id ? "…" : "✕"}
          </button>
        </div>
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
  );
}

export function MemoryPanel() {
  const PAGE_SIZE = 40;
  const [turns, setTurns] = useState<(TurnRow & { score?: number })[]>([]);
  const [searchMode, setSearchMode] = useState<"semantic" | "keyword" | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [turnCount, setTurnCount] = useState<number>(0);
  const [clearing, setClearing] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [unembeddedCount, setUnembeddedCount] = useState<number | null>(null);
  const [reindexing, setReindexing] = useState(false);
  const [digestFacts, setDigestFacts] = useState<DigestFact[]>([]);
  const [consolidating, setConsolidating] = useState(false);
  const [lastConsolidatedAt, setLastConsolidatedAt] = useState<string | null>(null);
  const [preferenceProfile, setPreferenceProfile] = useState<PreferenceProfile | null>(null);
  const [preferenceEvents, setPreferenceEvents] = useState<PreferenceEventRow[]>([]);
  const [preferenceLoading, setPreferenceLoading] = useState(false);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [preferenceMutating, setPreferenceMutating] = useState(false);
  const [sessionMeta, setSessionMeta] = useState<Map<string, SessionMetaRow>>(new Map());
  const [summarizingDates, setSummarizingDates] = useState<Set<string>>(new Set());
  const [editingLabelDate, setEditingLabelDate] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");

  const {
    openaiKey,
    clearConversation,
    anthropicKey,
    selectedModel,
    memoryEnabled,
    preferenceLearningEnabled,
    incognitoMode,
  } = useCompanionStore();
  const { status: embeddingStatus, loadProgress, embed, embedAndSave, retry, ensureLoaded } = useEmbedding();

  function loadRecent(offset = 0) {
    setSearchMode(null);
    invoke<TurnRow[]>("get_recent_turns", { limit: PAGE_SIZE + offset })
      .then(setTurns)
      .catch(console.error);
    invoke<number>("db_turn_count")
      .then(setTurnCount)
      .catch(() => {});
    loadSessionMeta();
  }

  async function loadSessionMeta() {
    if (!memoryEnabled || incognitoMode) return;
    try {
      const rows = await invoke<SessionMetaRow[]>("get_session_meta");
      setSessionMeta(new Map(rows.map((r) => [r.date_key, r])));
    } catch { /* non-fatal */ }
  }

  async function handleSaveLabel(dateKey: string, label: string) {
    setEditingLabelDate(null);
    const trimmed = label.trim().slice(0, 80);
    if (!trimmed) return;
    try {
      await invoke("upsert_session_meta", { dateKey, label: trimmed, summary: null });
      setSessionMeta((prev) => {
        const next = new Map(prev);
        const existing = next.get(dateKey);
        next.set(dateKey, {
          date_key: dateKey,
          label: trimmed,
          summary: existing?.summary ?? null,
          created_at: existing?.created_at ?? new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        return next;
      });
    } catch { /* non-fatal */ }
  }

  async function generateMissingSummaries(
    pastDates: string[],
    byDate: Record<string, (TurnRow & { score?: number })[]>,
    currentMeta: Map<string, SessionMetaRow>,
  ) {
    if (!memoryEnabled || incognitoMode) return;
    if (!openaiKey && !anthropicKey) return;

    const needsSummary = pastDates.filter((dk) =>
      !(currentMeta.get(dk)?.label) &&
      !(currentMeta.get(dk)?.summary) &&
      (byDate[dk]?.length ?? 0) > 0
    );
    if (needsSummary.length === 0) return;

    setSummarizingDates((prev) => new Set([...prev, ...needsSummary]));

    for (const dk of needsSummary) {
      const snippet = (byDate[dk] ?? []).slice(0, 4).map((t, i) =>
        `Turn ${i + 1}:\nUser: ${compactText(t.user_prompt, 150)}\nAssistant: ${compactText(t.assistant_response, 150)}`
      ).join("\n\n");

      const prompt = `Write ONE sentence (max 12 words) summarizing what was discussed in this AI session. No quotes. Examples: "Debugging React auth flow and JWT expiry issues", "Planning a marketing campaign for a SaaS product".\n\nSession date: ${dk}\n\n${snippet}\n\nOne-sentence summary:`;

      try {
        const raw = await invoke<string>("extract_facts_oneshot", {
          prompt,
          provider: anthropicKey ? "anthropic" : "openai",
          modelId: selectedModel.modelId,
        });
        const summary = raw.trim().replace(/^["']|["']$/g, "").slice(0, 200);
        if (summary.length > 5) {
          await invoke("upsert_session_meta", { dateKey: dk, label: null, summary });
          setSessionMeta((prev) => {
            const next = new Map(prev);
            const existing = next.get(dk);
            next.set(dk, {
              date_key: dk, label: existing?.label ?? null, summary,
              created_at: existing?.created_at ?? new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
            return next;
          });
        }
      } catch { /* non-fatal — best effort */ }
      finally {
        setSummarizingDates((prev) => { const n = new Set(prev); n.delete(dk); return n; });
      }
    }
  }

  function refreshUnembeddedCount() {
    invoke<number>("count_unembedded_turns")
      .then(setUnembeddedCount)
      .catch(() => setUnembeddedCount(null));
  }

  async function loadPreferences() {
    if (!memoryEnabled || !preferenceLearningEnabled || incognitoMode) {
      setPreferenceProfile(null);
      setPreferenceEvents([]);
      return;
    }
    setPreferenceLoading(true);
    setPreferenceError(null);
    try {
      const [profile, events] = await Promise.all([
        invoke<PreferenceProfile>("get_preference_profile", { limit: 20 }),
        invoke<PreferenceEventRow[]>("get_preference_events", { limit: 20 }),
      ]);
      setPreferenceProfile(profile);
      setPreferenceEvents(events);
    } catch (err) {
      setPreferenceError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreferenceLoading(false);
    }
  }

  useEffect(() => {
    loadRecent();
    refreshUnembeddedCount();
    invoke<DigestFact[]>("get_digest_facts", { limit: 20 })
      .then(setDigestFacts)
      .catch(() => {});
    invoke<string | null>("get_last_consolidation_time")
      .then(setLastConsolidatedAt)
      .catch(() => {});
    loadPreferences();
    loadSessionMeta();
  }, []);

  useEffect(() => {
    loadPreferences();
  }, [memoryEnabled, preferenceLearningEnabled, incognitoMode]);

  // Refresh unembedded count when embedding model becomes ready
  useEffect(() => {
    if (embeddingStatus === "ready") refreshUnembeddedCount();
  }, [embeddingStatus]);

  // Background-index unembedded turns using API key whenever panel mounts with key set.
  // Batches of 5 with 300ms gaps — respects OpenAI 3000 RPM rate limit.
  useEffect(() => {
    if (!openaiKey) return;
    let cancelled = false;
    const BATCH_SIZE = 5;
    (async () => {
      try {
        const unembedded = await invoke<TurnRow[]>("get_unembedded_turns", { limit: 200 });
        for (let i = 0; i < unembedded.length; i += BATCH_SIZE) {
          if (cancelled) break;
          const batch = unembedded.slice(i, i + BATCH_SIZE);
          await Promise.all(batch.map(async (turn) => {
            try {
              const combinedText = `${turn.user_prompt} ${turn.assistant_response}`;
              const embedding = await invoke<number[]>("generate_embedding", { text: combinedText, apiKey: openaiKey });
              await invoke("save_embedding", { turnId: turn.id, embedding });
            } catch { /* best-effort */ }
          }));
          if (i + BATCH_SIZE < unembedded.length && !cancelled) {
            await new Promise<void>((r) => setTimeout(r, 300));
          }
        }
        if (!cancelled) refreshUnembeddedCount();
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [openaiKey]);

  async function handleSearch(q: string) {
    setQuery(q);
    if (!q.trim()) {
      setSearchMode(null);
      const recent = await invoke<TurnRow[]>("get_recent_turns", { limit: 20 });
      setTurns(recent);
      return;
    }
    setSearching(true);
    try {
      if (openaiKey) {
        // Tier 1: API embedding — no minScore for interactive search
        try {
          const queryEmbedding = await invoke<number[]>("generate_embedding", { text: q, apiKey: openaiKey });
          const results = await invoke<ScoredTurnRow[]>("search_semantic", { queryEmbedding, limit: 20 });
          setSearchMode("semantic");
          setTurns(results);
        } catch {
          const results = await invoke<TurnRow[]>("search_history", { query: q, limit: 20 });
          setSearchMode("keyword");
          setTurns(results);
        }
      } else {
        // Tier 2: WASM embedding
        try {
          const queryEmbedding = await embed(q);
          const results = await invoke<ScoredTurnRow[]>("search_semantic", { queryEmbedding, limit: 20 });
          setSearchMode("semantic");
          setTurns(results);
        } catch {
          const results = await invoke<TurnRow[]>("search_history", { query: q, limit: 20 });
          setSearchMode("keyword");
          setTurns(results);
        }
      }
    } catch (e) {
      console.error("[MemoryPanel] search failed:", e);
    } finally {
      setSearching(false);
    }
  }

  async function handleClear() {
    if (!window.confirm(`Delete all ${turnCount} stored conversations? This cannot be undone.`)) return;
    setClearing(true);
    try {
      await invoke("db_clear_turns");
      setTurns([]);
      setTurnCount(0);
      setUnembeddedCount(0);
      clearConversation();
    } catch (e) {
      console.error("[MemoryPanel] clear failed:", e);
    } finally {
      setClearing(false);
    }
  }

  async function handleDelete(id: number) {
    setDeletingId(id);
    try {
      await invoke("delete_turn", { turnId: id });
      setTurns((prev) => prev.filter((t) => t.id !== id));
      setTurnCount((c) => Math.max(0, c - 1));
    } catch (e) {
      console.error("[MemoryPanel] delete turn failed:", e);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleReindex() {
    setReindexing(true);
    try {
      const unembedded = await invoke<TurnRow[]>("get_unembedded_turns", { limit: 200 });
      const BATCH_SIZE = 5;
      if (!openaiKey) {
        await ensureLoaded();
      }
      for (let i = 0; i < unembedded.length; i += BATCH_SIZE) {
        const batch = unembedded.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (turn) => {
          const combinedText = `${turn.user_prompt} ${turn.assistant_response}`;
          if (openaiKey) {
            try {
              const embedding = await invoke<number[]>("generate_embedding", { text: combinedText, apiKey: openaiKey });
              await invoke("save_embedding", { turnId: turn.id, embedding });
              return;
            } catch { /* fall through to WASM */ }
          }
          await embedAndSave(turn.id, turn.user_prompt, turn.assistant_response);
        }));
        if (i + BATCH_SIZE < unembedded.length) {
          await new Promise<void>((r) => setTimeout(r, 300));
        }
      }
      refreshUnembeddedCount();
    } catch (e) {
      console.error("[MemoryPanel] reindex failed:", e);
    } finally {
      setReindexing(false);
    }
  }

  async function mutatePreference(action: () => Promise<unknown>) {
    setPreferenceMutating(true);
    setPreferenceError(null);
    try {
      await action();
      await loadPreferences();
    } catch (err) {
      setPreferenceError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreferenceMutating(false);
    }
  }

  async function handlePreferenceStatus(trait: PreferenceTrait, status: "active" | "disabled") {
    await mutatePreference(() =>
      invoke("update_preference_trait", {
        traitKey: trait.key,
        status,
      })
    );
  }

  async function handlePreferenceRename(trait: PreferenceTrait) {
    const next = window.prompt("Rename this learned preference", traitDisplayLabel(trait));
    if (next === null) return;
    const label = next.trim();
    if (!label) return;
    await mutatePreference(() =>
      invoke("update_preference_trait", {
        traitKey: trait.key,
        label,
      })
    );
  }

  async function handlePreferenceNote(trait: PreferenceTrait) {
    const next = window.prompt("Add a review note for this preference", trait.user_note ?? "");
    if (next === null) return;
    await mutatePreference(() =>
      invoke("update_preference_trait", {
        traitKey: trait.key,
        note: next.trim(),
      })
    );
  }

  async function handlePreferenceDelete(trait: PreferenceTrait) {
    if (!window.confirm(`Delete learned preference "${traitDisplayLabel(trait)}"?`)) return;
    await mutatePreference(() => invoke("delete_preference_trait", { traitKey: trait.key }));
  }

  async function handlePreferenceRebuild() {
    await mutatePreference(() => invoke("rebuild_preference_profile"));
  }

  async function handlePreferenceClear() {
    if (!window.confirm("Clear all preference learning evidence and derived traits?")) return;
    await mutatePreference(() => invoke("clear_preference_learning"));
  }

  const embeddedCount = unembeddedCount !== null ? turnCount - unembeddedCount : null;

  // Group turns by date (today vs past sessions)
  const todayStr = new Date().toISOString().slice(0, 10);
  const groupedTurns = useMemo(() => {
    const today: (TurnRow & { score?: number })[] = [];
    const byDate: Record<string, (TurnRow & { score?: number })[]> = {};
    for (const t of turns) {
      const dateStr = t.created_at.slice(0, 10);
      if (dateStr === todayStr) {
        today.push(t);
      } else {
        if (!byDate[dateStr]) byDate[dateStr] = [];
        byDate[dateStr].push(t);
      }
    }
    return { today, byDate, pastDates: Object.keys(byDate).sort().reverse() };
  }, [turns, todayStr]);

  useEffect(() => {
    if (groupedTurns.pastDates.length === 0) return;
    generateMissingSummaries(groupedTurns.pastDates, groupedTurns.byDate, sessionMeta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupedTurns.pastDates.join(","), sessionMeta.size]);

  const semanticReady = (!!openaiKey || embeddingStatus === "ready") && (embeddedCount ?? 0) > 0;
  const preferenceUnavailableReason = incognitoMode
    ? "Incognito is on. Preference learning is paused."
    : !memoryEnabled
    ? "Memory is off. Enable memory to review preferences."
    : !preferenceLearningEnabled
    ? "Preference learning is off."
    : null;

  function embeddingStatusLabel() {
    const apiAvailable = !!openaiKey;
    if (apiAvailable && (embeddedCount ?? 0) === 0) {
      return unembeddedCount !== null && unembeddedCount > 0
        ? `Indexing ${unembeddedCount} conversations…`
        : "OpenAI key set — semantic search ready on first conversation";
    }
    if (apiAvailable && embeddedCount !== null) {
      return `Semantic search ready (API) · ${embeddedCount}/${turnCount} indexed`;
    }
    if (embeddingStatus === "loading") {
      return `Loading semantic model… ${loadProgress > 0 ? `${Math.round(loadProgress)}%` : ""}`;
    }
    if (embeddingStatus === "ready" && (embeddedCount ?? 0) > 0) {
      return `Semantic search ready (local) · ${embeddedCount}/${turnCount} indexed`;
    }
    if (embeddingStatus === "error") return "Set OpenAI key for reliable semantic search";
    return "Local semantic model loads on first search or index";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {/* Semantic embedding status bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "5px 8px",
          background:
            semanticReady
              ? "rgba(52, 199, 89, 0.08)"
              : embeddingStatus === "error"
              ? "rgba(255, 69, 58, 0.08)"
              : "rgba(255, 159, 10, 0.08)",
          border: `1px solid ${
            semanticReady
              ? "rgba(52,199,89,0.25)"
              : embeddingStatus === "error"
              ? "rgba(255,69,58,0.25)"
              : "rgba(255,159,10,0.25)"
          }`,
          borderRadius: radii.sm,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            flexShrink: 0,
            background:
              semanticReady
                ? "#34C759"
                : embeddingStatus === "error"
                ? "#FF453A"
                : "#FF9F0A",
          }}
        />
        <span style={{ ...typography.caption, color: colors.textSecondary, flex: 1 }}>
          {embeddingStatusLabel()}
        </span>
        {unembeddedCount !== null && unembeddedCount > 0 && (
          <button
            onClick={handleReindex}
            disabled={reindexing || embeddingStatus === "loading"}
            style={{
              padding: "2px 7px",
              background: "transparent",
              border: `1px solid rgba(52,199,89,0.4)`,
              borderRadius: radii.sm,
              color: "#34C759",
              cursor: reindexing || embeddingStatus === "loading" ? "default" : "pointer",
              fontSize: "10px",
              fontFamily: "inherit",
              opacity: reindexing || embeddingStatus === "loading" ? 0.5 : 1,
            }}
          >
            {reindexing ? "Indexing…" : `Index ${unembeddedCount}`}
          </button>
        )}
        {embeddingStatus === "error" && (
          <button
            onClick={retry}
            style={{
              padding: "2px 7px",
              background: "transparent",
              border: "1px solid rgba(255,69,58,0.4)",
              borderRadius: radii.sm,
              color: "#FF453A",
              cursor: "pointer",
              fontSize: "10px",
              fontFamily: "inherit",
            }}
          >
            Retry
          </button>
        )}
      </div>
      {embeddingStatus === "loading" && loadProgress > 0 && (
        <div
          style={{
            height: 4,
            background: "rgba(255,159,10,0.15)",
            borderRadius: 2,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${loadProgress}%`,
              background: "#FF9F0A",
              borderRadius: 2,
              transition: "width 0.3s ease",
            }}
          />
        </div>
      )}

      {/* Learned Preferences */}
      <div
        style={{
          border: `1px solid ${colors.border}`,
          borderRadius: radii.sm,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px",
            padding: "7px 10px",
            background: colors.backgroundSecondary,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0, flex: 1 }}>
            <span style={{ ...typography.small, color: colors.textSecondary, fontWeight: 600 }}>
              Preferences
            </span>
            {preferenceProfile && (
              <>
                <span
                  style={{
                    fontSize: 10,
                    background: "rgba(48,209,88,0.15)",
                    color: colors.success,
                    padding: "1px 5px",
                    borderRadius: 8,
                  }}
                >
                  {preferenceProfile.traits.length} traits
                </span>
                <span style={{ ...typography.caption, color: colors.textTertiary }}>
                  {preferenceProfile.explicit_feedback_count} explicit / {preferenceProfile.implicit_feedback_count} implicit
                </span>
              </>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "5px", flexShrink: 0 }}>
            <button
              onClick={handlePreferenceRebuild}
              disabled={!!preferenceUnavailableReason || preferenceLoading || preferenceMutating}
              style={{
                background: "none",
                border: `1px solid ${colors.border}`,
                borderRadius: radii.xs,
                color: colors.textTertiary,
                fontSize: 10,
                cursor: preferenceLoading || preferenceMutating || preferenceUnavailableReason ? "default" : "pointer",
                padding: "2px 7px",
                fontFamily: "inherit",
                opacity: preferenceLoading || preferenceMutating || preferenceUnavailableReason ? 0.55 : 1,
              }}
            >
              Rebuild
            </button>
            <button
              onClick={handlePreferenceClear}
              disabled={!!preferenceUnavailableReason || preferenceLoading || preferenceMutating || !preferenceProfile}
              style={{
                background: "none",
                border: "1px solid rgba(255,69,58,0.3)",
                borderRadius: radii.xs,
                color: "rgba(255,69,58,0.78)",
                fontSize: 10,
                cursor:
                  preferenceLoading || preferenceMutating || preferenceUnavailableReason || !preferenceProfile
                    ? "default"
                    : "pointer",
                padding: "2px 7px",
                fontFamily: "inherit",
                opacity:
                  preferenceLoading || preferenceMutating || preferenceUnavailableReason || !preferenceProfile
                    ? 0.55
                    : 1,
              }}
            >
              Clear
            </button>
          </div>
        </div>
        <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: "8px" }}>
          {preferenceUnavailableReason ? (
            <div style={{ ...typography.caption, color: colors.textTertiary }}>
              {preferenceUnavailableReason}
            </div>
          ) : preferenceLoading ? (
            <div style={{ ...typography.caption, color: colors.textTertiary }}>
              Loading preference evidence...
            </div>
          ) : preferenceError ? (
            <div style={{ ...typography.caption, color: colors.error }}>
              {preferenceError}
            </div>
          ) : !preferenceProfile || preferenceProfile.traits.length === 0 ? (
            <div style={{ ...typography.caption, color: colors.textTertiary }}>
              No learned preferences yet. Rate responses, copy useful answers, or correct a response to build evidence.
            </div>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: 220, overflowY: "auto" }}>
                {preferenceProfile.traits.map((trait) => {
                  const confidence = trait.confidence ?? Math.min(0.99, Math.abs(trait.score) / Math.max(1, trait.evidence_count));
                  const status = trait.status ?? "active";
                  const disabled = status === "disabled" || status === "deleted";
                  const tone = traitStatusColor(trait);
                  const support = trait.support_score ?? Math.max(0, trait.score);
                  const conflict = trait.conflict_score ?? (trait.positive_count > 0 && trait.negative_count > 0 ? Math.min(trait.positive_count, trait.negative_count) : 0);
                  return (
                    <div
                      key={trait.key}
                      style={{
                        padding: "7px 8px",
                        background: colors.background,
                        border: `1px solid ${colors.border}`,
                        borderRadius: radii.xs,
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                        opacity: status === "deleted" ? 0.55 : 1,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                            <span style={{ ...typography.caption, color: tone, fontWeight: 600 }}>
                              {trait.score >= 0 ? "Prefer" : "Avoid"}
                            </span>
                            <span style={{ ...typography.caption, color: colors.text }}>
                              {traitDisplayLabel(trait)}
                            </span>
                            <span
                              style={{
                                fontSize: 9,
                                color: tone,
                                background: traitStatusBackground(trait),
                                borderRadius: 7,
                                padding: "1px 5px",
                              }}
                            >
                              {status}
                            </span>
                          </div>
                          {trait.user_note && (
                            <div style={{ ...typography.small, color: colors.textTertiary, marginTop: 2 }}>
                              Note: {compactText(trait.user_note, 120)}
                            </div>
                          )}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
                          <button
                            onClick={() => handlePreferenceStatus(trait, disabled ? "active" : "disabled")}
                            disabled={preferenceMutating || status === "deleted"}
                            style={{
                              background: "none",
                              border: `1px solid ${colors.border}`,
                              borderRadius: radii.xs,
                              color: colors.textTertiary,
                              cursor: preferenceMutating || status === "deleted" ? "default" : "pointer",
                              fontSize: 10,
                              padding: "2px 6px",
                              fontFamily: "inherit",
                            }}
                          >
                            {disabled ? "Use" : "Pause"}
                          </button>
                          <button
                            onClick={() => handlePreferenceRename(trait)}
                            disabled={preferenceMutating || status === "deleted"}
                            style={{
                              background: "none",
                              border: `1px solid ${colors.border}`,
                              borderRadius: radii.xs,
                              color: colors.textTertiary,
                              cursor: preferenceMutating || status === "deleted" ? "default" : "pointer",
                              fontSize: 10,
                              padding: "2px 6px",
                              fontFamily: "inherit",
                            }}
                          >
                            Rename
                          </button>
                          <button
                            onClick={() => handlePreferenceNote(trait)}
                            disabled={preferenceMutating || status === "deleted"}
                            style={{
                              background: "none",
                              border: `1px solid ${colors.border}`,
                              borderRadius: radii.xs,
                              color: colors.textTertiary,
                              cursor: preferenceMutating || status === "deleted" ? "default" : "pointer",
                              fontSize: 10,
                              padding: "2px 6px",
                              fontFamily: "inherit",
                            }}
                          >
                            Note
                          </button>
                          <button
                            onClick={() => handlePreferenceDelete(trait)}
                            disabled={preferenceMutating || status === "deleted"}
                            style={{
                              background: "none",
                              border: "1px solid rgba(255,69,58,0.3)",
                              borderRadius: radii.xs,
                              color: "rgba(255,69,58,0.78)",
                              cursor: preferenceMutating || status === "deleted" ? "default" : "pointer",
                              fontSize: 10,
                              padding: "2px 6px",
                              fontFamily: "inherit",
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "8px", alignItems: "center" }}>
                        <div style={{ height: 4, background: colors.surface, borderRadius: 3, overflow: "hidden" }}>
                          <div
                            style={{
                              height: "100%",
                              width: formatPercent(confidence),
                              background: tone,
                              borderRadius: 3,
                              transition: "width 0.2s",
                            }}
                          />
                        </div>
                        <span style={{ ...typography.small, color: colors.textTertiary }}>
                          {formatPercent(confidence)}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                        <span style={{ ...typography.small, color: colors.textTertiary }}>
                          evidence {trait.evidence_count}
                        </span>
                        <span style={{ ...typography.small, color: colors.success }}>
                          +{trait.positive_count}
                        </span>
                        <span style={{ ...typography.small, color: colors.error }}>
                          -{trait.negative_count}
                        </span>
                        <span style={{ ...typography.small, color: colors.textTertiary }}>
                          support {support.toFixed(2)}
                        </span>
                        <span style={{ ...typography.small, color: colors.textTertiary }}>
                          conflict {conflict.toFixed(2)}
                        </span>
                        <span style={{ ...typography.small, color: colors.textTertiary }}>
                          last seen {formatRelativeTime(trait.last_seen)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: "7px" }}>
                <div style={{ ...typography.small, color: colors.textTertiary, marginBottom: "5px", fontWeight: 600 }}>
                  Recent Evidence
                </div>
                {preferenceEvents.length === 0 ? (
                  <div style={{ ...typography.caption, color: colors.textTertiary }}>
                    No event evidence is currently active.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "5px", maxHeight: 170, overflowY: "auto" }}>
                    {preferenceEvents.slice(0, 8).map((event) => (
                      <div
                        key={event.id}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "3px",
                          padding: "6px 7px",
                          background: colors.background,
                          borderRadius: radii.xs,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                          <span style={{ ...typography.small, color: event.weight >= 0 ? colors.success : colors.error, fontWeight: 600 }}>
                            {formatSignal(event.signal)}
                          </span>
                          <span style={{ ...typography.small, color: colors.textTertiary }}>
                            {event.source}
                          </span>
                          <span style={{ ...typography.small, color: colors.textTertiary }}>
                            weight {event.weight.toFixed(2)}
                          </span>
                          <span style={{ ...typography.small, color: colors.textTertiary }}>
                            {formatRelativeTime(event.created_at)}
                          </span>
                        </div>
                        {event.reason && (
                          <div style={{ ...typography.caption, color: colors.textSecondary }}>
                            {compactText(event.reason, 140)}
                          </div>
                        )}
                        {event.raw_text && (
                          <div style={{ ...typography.small, color: colors.textTertiary }}>
                            Evidence: {compactText(event.raw_text, 180)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Memory Digest */}
      <div
        style={{
          border: `1px solid ${colors.border}`,
          borderRadius: radii.sm,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "7px 10px",
            background: colors.backgroundSecondary,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flex: 1 }}>
            <span style={{ ...typography.small, color: colors.textSecondary, fontWeight: 600 }}>
              Memory Digest
            </span>
            {digestFacts.length > 0 && (
              <span
                style={{
                  fontSize: 10,
                  background: "rgba(10,132,255,0.15)",
                  color: colors.accent,
                  padding: "1px 5px",
                  borderRadius: 8,
                }}
              >
                {digestFacts.length}
              </span>
            )}
            <span style={{ ...typography.caption, color: colors.textTertiary, marginLeft: "auto" }}>
              {formatRelativeTime(lastConsolidatedAt)}
            </span>
          </div>
          <button
            onClick={async () => {
              setConsolidating(true);
              try {
                const { runConsolidation } = await import("../lib/memoryConsolidation");
                await runConsolidation({
                  anthropicKey,
                  openaiKey,
                  modelId: selectedModel.modelId,
                  provider: selectedModel.provider,
                });
                const fresh = await invoke<DigestFact[]>("get_digest_facts", { limit: 20 });
                setDigestFacts(fresh);
                const ts = await invoke<string | null>("get_last_consolidation_time").catch(() => null);
                setLastConsolidatedAt(ts);
              } catch { /* ignore */ } finally {
                setConsolidating(false);
              }
            }}
            disabled={consolidating}
            style={{
              background: "none",
              border: `1px solid ${colors.border}`,
              borderRadius: radii.xs,
              color: colors.textTertiary,
              fontSize: 10,
              cursor: consolidating ? "default" : "pointer",
              padding: "2px 7px",
              fontFamily: "inherit",
              opacity: consolidating ? 0.6 : 1,
            }}
          >
            {consolidating ? "Consolidating…" : "Consolidate now"}
          </button>
        </div>
        <div style={{ padding: "8px 10px" }}>
          {digestFacts.length === 0 ? (
            <div style={{ ...typography.caption, color: colors.textTertiary }}>
              No facts extracted yet. Facts appear after 5+ conversations.
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                maxHeight: 160,
                overflowY: "auto",
              }}
            >
              {digestFacts.map((f) => (
                <div
                  key={f.id}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "6px",
                    padding: "4px 6px",
                    background: colors.background,
                    borderRadius: radii.xs,
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      padding: "1px 4px",
                      borderRadius: 3,
                      flexShrink: 0,
                      marginTop: 1,
                      background:
                        f.category === "preference"
                          ? "rgba(48,209,88,0.15)"
                          : f.category === "pattern"
                          ? "rgba(245,158,11,0.15)"
                          : "rgba(10,132,255,0.12)",
                      color:
                        f.category === "preference"
                          ? "#30d158"
                          : f.category === "pattern"
                          ? "#f59e0b"
                          : colors.accent,
                    }}
                  >
                    {f.category}
                  </span>
                  <span
                    style={{
                      ...typography.caption,
                      color: colors.text,
                      flex: 1,
                      lineHeight: 1.4,
                    }}
                  >
                    {f.fact}
                  </span>
                  <button
                    onClick={async () => {
                      if (!f.id) return;
                      await invoke("delete_digest_fact", { id: f.id }).catch(() => {});
                      setDigestFacts((prev) => prev.filter((x) => x.id !== f.id));
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      color: colors.textTertiary,
                      cursor: "pointer",
                      fontSize: 10,
                      padding: "0 2px",
                      flexShrink: 0,
                      lineHeight: 1,
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Search bar */}
      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
        <input
          type="text"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder={
            semanticReady
              ? "Semantic search conversation history…"
              : "Search conversation history…"
          }
          style={{
            flex: 1,
            padding: "8px 10px",
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: radii.sm,
            color: colors.text,
            fontSize: "13px",
            boxSizing: "border-box" as const,
            outline: "none",
            fontFamily: "inherit",
          }}
        />
        {turnCount > 0 && (
          <button
            onClick={handleClear}
            disabled={clearing}
            title="Clear all conversation history"
            style={{
              padding: "6px 10px",
              background: "transparent",
              border: `1px solid rgba(255,69,58,0.4)`,
              borderRadius: radii.sm,
              color: "rgba(255,69,58,0.8)",
              cursor: clearing ? "default" : "pointer",
              fontSize: "11px",
              whiteSpace: "nowrap" as const,
              fontFamily: "inherit",
              opacity: clearing ? 0.5 : 1,
            }}
          >
            {clearing ? "Clearing…" : `Clear (${turnCount})`}
          </button>
        )}
      </div>

      {searching && (
        <div style={{ ...typography.small, color: colors.textTertiary }}>
          {semanticReady ? "Searching semantically…" : "Searching…"}
        </div>
      )}

      {query && searchMode && turns.length > 0 && (
        <div style={{ ...typography.caption, color: colors.textTertiary, paddingLeft: 2 }}>
          {searchMode === "semantic" ? "Semantic" : `Keyword · searched all ${turnCount}`} · {turns.length} result{turns.length !== 1 ? "s" : ""}
        </div>
      )}

      {query && searchMode && turns.length === 0 && !searching && (
        <div style={{ ...typography.caption, color: colors.textTertiary, paddingLeft: 2 }}>
          {searchMode === "keyword" && turnCount > 0 ? `Searched all ${turnCount} conversations — no matches` : "No results"}
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

      {/* This Session */}
      {!searchMode && groupedTurns.today.length > 0 && (
        <>
          <div style={{ ...typography.small, color: colors.textTertiary, fontWeight: 600, marginTop: "8px", marginBottom: "6px" }}>
            This Session
          </div>
          {groupedTurns.today.map((turn) => (
            <TurnCard key={turn.id} turn={turn} deletingId={deletingId} onDelete={handleDelete} />
          ))}
        </>
      )}

      {/* Past Sessions */}
      {!searchMode && groupedTurns.pastDates.length > 0 && (
        <>
          <div style={{ ...typography.small, color: colors.textTertiary, fontWeight: 600, marginTop: "8px", marginBottom: "6px" }}>
            Past Sessions
          </div>
          {groupedTurns.pastDates.map((dateStr) => {
            const meta = sessionMeta.get(dateStr);
            const isSummarizing = summarizingDates.has(dateStr);
            return (
              <div key={dateStr}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px", paddingLeft: "4px" }}>
                  <span style={{ ...typography.caption, color: colors.textTertiary }}>
                    {new Date(dateStr + "T00:00:00Z").toLocaleDateString()}
                  </span>
                  {editingLabelDate === dateStr ? (
                    <input
                      autoFocus
                      value={labelDraft}
                      onChange={(e) => setLabelDraft(e.target.value)}
                      onBlur={() => handleSaveLabel(dateStr, labelDraft)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveLabel(dateStr, labelDraft);
                        if (e.key === "Escape") setEditingLabelDate(null);
                      }}
                      placeholder="Name this session…"
                      style={{
                        flex: 1, fontSize: 10, fontFamily: "inherit",
                        background: colors.surface, border: `1px solid ${colors.border}`,
                        borderRadius: radii.xs, color: colors.text, padding: "1px 5px", outline: "none",
                      }}
                    />
                  ) : (
                    <>
                      {meta?.label && (
                        <span style={{ ...typography.caption, color: colors.accent, fontStyle: "italic" }}>
                          {meta.label}
                        </span>
                      )}
                      {!meta?.label && (meta?.summary || isSummarizing) && (
                        <span style={{ ...typography.caption, color: colors.textTertiary, fontStyle: "italic" }}>
                          {isSummarizing ? "Summarizing…" : compactText(meta!.summary!, 70)}
                        </span>
                      )}
                      <button
                        onClick={() => { setEditingLabelDate(dateStr); setLabelDraft(meta?.label ?? ""); }}
                        title="Name this session"
                        style={{ background: "none", border: "none", cursor: "pointer",
                                 color: colors.textTertiary, fontSize: 10, padding: "0 2px",
                                 fontFamily: "inherit", lineHeight: 1 }}
                      >✎</button>
                    </>
                  )}
                </div>
                {groupedTurns.byDate[dateStr]?.map((turn) => (
                  <TurnCard key={turn.id} turn={turn} deletingId={deletingId} onDelete={handleDelete} />
                ))}
              </div>
            );
          })}
          {turnCount > turns.length && (
            <button
              onClick={() => loadRecent(turns.length)}
              style={{
                width: "100%", padding: "6px", background: "transparent",
                border: `1px solid ${colors.border}`, borderRadius: radii.sm,
                color: colors.textTertiary, cursor: "pointer", fontSize: "11px",
                fontFamily: "inherit", marginTop: "4px",
              }}
            >
              Load more ({turnCount - turns.length} remaining)
            </button>
          )}
        </>
      )}

      {/* Search results grouped by session */}
      {searchMode && (() => {
        const byDate = new Map<string, (TurnRow & { score?: number })[]>();
        for (const t of turns) {
          const dk = t.created_at.slice(0, 10);
          if (!byDate.has(dk)) byDate.set(dk, []);
          byDate.get(dk)!.push(t);
        }
        return [...byDate.keys()].sort().reverse().map((dk) => {
          const meta = sessionMeta.get(dk);
          const label = meta?.label ?? (meta?.summary ? compactText(meta.summary, 60) : null);
          return (
            <div key={dk}>
              <div style={{ ...typography.caption, color: colors.textTertiary, marginBottom: "4px", paddingLeft: "4px" }}>
                {new Date(dk + "T00:00:00Z").toLocaleDateString()}
                {label && (
                  <span style={{ color: colors.accent, fontStyle: "italic", marginLeft: "6px" }}>
                    {label}
                  </span>
                )}
              </div>
              {byDate.get(dk)!.map((turn) => (
                <TurnCard key={turn.id} turn={turn} deletingId={deletingId} onDelete={handleDelete} />
              ))}
            </div>
          );
        });
      })()}
    </div>
  );
}
