import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { colors, typography } from "../../../lib/designSystem";
import { useCompanionStore } from "../../../state/companionStore";
import { ToggleButton } from "./ButtonControls";
export function VadToggle() {
  const { vadEnabled, setVadEnabled } = useCompanionStore();

  async function toggle() {
    const next = !vadEnabled;
    setVadEnabled(next);
    try {
      await invoke("set_vad_enabled", { enabled: next });
    } catch (e) {
      console.warn("[VAD]", e);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        paddingTop: "6px",
        borderTop: `1px solid ${colors.border}`,
      }}
    >
      <div>
        <div style={{ ...typography.caption, color: colors.textSecondary }}>
          Auto-stop on silence
        </div>
        <div style={{ ...typography.small, color: colors.textTertiary, marginTop: "1px" }}>
          Release hotkey automatically when you stop speaking
        </div>
      </div>
      <ToggleButton on={vadEnabled} onToggle={toggle} />
    </div>
  );
}

export function AudioLevelMeter() {
  const [levels, setLevels] = useState<number[]>([0.2, 0.2, 0.2, 0.2, 0.2]);
  const historyRef = useRef<number[]>([0, 0, 0, 0, 0]);

  useEffect(() => {
    const unlisten = listen<number>("audio-level", (e) => {
      const level = e.payload;
      historyRef.current = [...historyRef.current.slice(1), level];
      setLevels([...historyRef.current]);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <div
      style={{
        display: "flex",
        gap: "3px",
        alignItems: "flex-end",
        height: "24px",
        padding: "0 4px",
      }}
    >
      {levels.map((l, i) => (
        <div
          key={i}
          style={{
            width: "4px",
            height: `${Math.max(4, l * 24)}px`,
            background: colors.success,
            borderRadius: "2px",
            transition: "height 0.08s ease-out",
            opacity: 0.85,
          }}
        />
      ))}
    </div>
  );
}
