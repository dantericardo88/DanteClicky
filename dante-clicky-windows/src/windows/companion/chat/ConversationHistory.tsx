import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { colors, radii, typography } from "../../../lib/designSystem";
import { useCompanionStore, type ConversationTurn } from "../../../state/companionStore";
import { preferenceFeedbackQueue } from "../../../lib/preferenceClient";
import { SectionLabel } from "../settings/SettingsShared";
import { requestThumbsDownReason } from "../utils";
export function ConversationHistory({ turns }: { turns: ConversationTurn[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [ratings, setRatings] = useState<Record<string, 1 | -1>>({});
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns]);

  async function copyResponse(text: string, index: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 1500);
      const state = useCompanionStore.getState();
      const turn = state.conversationHistory[index];
      if (turn) {
        preferenceFeedbackQueue.recordForTurn(
          { id: turn.id, clientTurnId: turn.clientTurnId },
          {
            signal: "copied_response",
            reason: "user copied the answer",
            rawText: text,
            idempotencyKey: turn.id ? `copy:${turn.id}:${text.slice(0, 32)}` : undefined,
          },
          state
        ).catch(() => {});
      }
    } catch {
      // clipboard unavailable
    }
  }

  function turnRatingKey(turn: ConversationTurn, index: number): string {
    return turn.id ? `id:${turn.id}` : `idx:${index}`;
  }

  async function rateTurn(turn: ConversationTurn, index: number, rating: 1 | -1) {
    const ratingKey = turnRatingKey(turn, index);
    const previousRating = ratings[ratingKey];
    const nextRating: 1 | -1 | 0 = previousRating === rating ? 0 : rating;
    const feedbackReason = nextRating === -1 ? requestThumbsDownReason() : null;
    if (nextRating === -1 && feedbackReason === null) return;
    setRatings((r) => {
      const next = { ...r };
      if (nextRating === 0) delete next[ratingKey];
      else next[ratingKey] = nextRating;
      return next;
    });
    const prefs = useCompanionStore.getState();
    if (!prefs.memoryEnabled || !prefs.preferenceLearningEnabled || prefs.incognitoMode) {
      return;
    }
    if (!turn.id) {
      let attempts = 0;
      const poll = setInterval(() => {
        const current = useCompanionStore.getState().conversationHistory[index];
        if (current?.id) {
          clearInterval(poll);
          invoke("rate_turn", { turnId: current.id, rating: nextRating, reason: feedbackReason })
            .catch(() => {
              setRatings((r) => {
                const next = { ...r };
                if (previousRating === undefined) delete next[ratingKey];
                else next[ratingKey] = previousRating;
                return next;
              });
            });
        } else if (++attempts > 20) {
          clearInterval(poll);
        }
      }, 100);
      return;
    }
    try {
      await invoke("rate_turn", { turnId: turn.id, rating: nextRating, reason: feedbackReason });
    } catch {
      // DB unavailable — local state already reflects intent
    }
  }

  return (
    <div>
      <SectionLabel>Conversation</SectionLabel>
      <div
        ref={scrollRef}
        style={{
          maxHeight: "240px",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          scrollbarWidth: "thin",
          scrollbarColor: `${colors.border} transparent`,
        }}
      >
        {turns.map((turn, i) => (
          <div
            key={i}
            style={{ display: "flex", flexDirection: "column", gap: "4px", animation: i === turns.length - 1 ? "fadeInUp 0.15s ease" : undefined }}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <div
                style={{
                  maxWidth: "80%",
                  padding: "7px 11px",
                  background: colors.accent,
                  borderRadius: `${radii.md} ${radii.md} ${radii.xs} ${radii.md}`,
                  ...typography.caption,
                  color: "#fff",
                  wordBreak: "break-word",
                }}
                dir="auto"
              >
                {turn.userPrompt}
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-start", gap: "4px", alignItems: "flex-start" }}>
              <div
                style={{
                  maxWidth: "calc(80% - 56px)",
                  padding: "7px 11px",
                  background: colors.backgroundSecondary,
                  border: `1px solid ${colors.border}`,
                  borderRadius: `${radii.md} ${radii.md} ${radii.md} ${radii.xs}`,
                  ...typography.caption,
                  color: colors.textSecondary,
                  wordBreak: "break-word",
                }}
                dir="auto"
              >
                {turn.assistantResponse}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "2px", flexShrink: 0, marginTop: "4px", opacity: hoveredIndex === i || ratings[turnRatingKey(turn, i)] !== undefined ? 1 : 0, transition: "opacity 0.15s" }}>
                <button
                  title="Good response"
                  aria-label="Good response"
                  onClick={() => rateTurn(turn, i, 1)}
                  style={{
                    width: "22px",
                    height: "22px",
                    borderRadius: radii.xs,
                    border: "none",
                    background: "transparent",
                    color: ratings[turnRatingKey(turn, i)] === 1 ? colors.success : colors.textTertiary,
                    cursor: "pointer",
                    fontSize: "11px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "color 0.2s",
                  }}
                >
                  ▲
                </button>
                <button
                  title="Bad response"
                  aria-label="Bad response"
                  onClick={() => rateTurn(turn, i, -1)}
                  style={{
                    width: "22px",
                    height: "22px",
                    borderRadius: radii.xs,
                    border: "none",
                    background: "transparent",
                    color: ratings[turnRatingKey(turn, i)] === -1 ? colors.error : colors.textTertiary,
                    cursor: "pointer",
                    fontSize: "11px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "color 0.2s",
                  }}
                >
                  ▼
                </button>
              </div>
              <button
                title="Copy response"
                aria-label="Copy response"
                onClick={() => copyResponse(turn.assistantResponse, i)}
                style={{
                  flexShrink: 0,
                  marginTop: "4px",
                  width: "22px",
                  height: "22px",
                  borderRadius: radii.xs,
                  border: "none",
                  background: "transparent",
                  color: copiedIndex === i ? colors.success : colors.textTertiary,
                  cursor: "pointer",
                  fontSize: "12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "color 0.2s",
                }}
              >
                {copiedIndex === i ? "✓" : "⎘"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}