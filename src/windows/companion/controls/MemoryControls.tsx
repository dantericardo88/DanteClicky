import { useState, useEffect, useRef } from "react";
import type React from "react";
import { invoke } from "@tauri-apps/api/core";
import { colors, radii, typography } from "../../../lib/designSystem";
import { useCompanionStore } from "../../../state/companionStore";
export function ImportMemoryButton() {
  const [importState, setImportState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [importCount, setImportCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportState("working");
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const json = reader.result as string;
        const count = await invoke<number>("import_memory_json", { json });
        setImportCount(count);
        setImportState("done");
      } catch {
        setImportState("error");
      }
    };
    reader.onerror = () => setImportState("error");
    reader.readAsText(file);
    // reset so the same file can be re-selected
    e.target.value = "";
  }

  if (importState === "done") {
    return (
      <div style={{
        padding: "7px 10px", background: "rgba(52,199,89,0.08)",
        border: "1px solid rgba(52,199,89,0.25)", borderRadius: radii.sm,
        ...typography.caption, color: "#34C759",
      }}>
        Imported {importCount} conversation{importCount !== 1 ? "s" : ""}
      </div>
    );
  }
  if (importState === "error") {
    return (
      <div style={{
        padding: "7px 10px", background: "rgba(255,69,58,0.08)",
        border: "1px solid rgba(255,69,58,0.25)", borderRadius: radii.sm,
        ...typography.caption, color: "#FF453A",
      }}>
        Import failed - file must be a dante-memory JSON export
      </div>
    );
  }

  return (
    <>
      <input ref={fileRef} type="file" accept=".json,application/json" onChange={handleFileChange}
        style={{ display: "none" }} />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={importState === "working"}
        style={{
          padding: "7px 10px", background: "transparent",
          border: `1px solid ${colors.border}`, borderRadius: radii.sm,
          color: importState === "working" ? colors.textTertiary : colors.textSecondary,
          cursor: importState === "working" ? "default" : "pointer",
          ...typography.caption, textAlign: "left" as const, fontFamily: "inherit",
        }}
      >
        {importState === "working" ? "Importing..." : "Import memory from JSON"}
      </button>
    </>
  );
}

interface DbKeyStatus { encrypted: boolean; dpapi_protected: boolean; sqlcipher_active: boolean; platform: string; }

export function EncryptionStatusBadge() {
  const [status, setStatus] = useState<DbKeyStatus | null>(null);
  useEffect(() => {
    invoke<DbKeyStatus>("db_key_status").then(setStatus).catch(() => {});
  }, []);

  const dpapiLabel = status?.dpapi_protected
    ? "DPAPI-bound"
    : status?.platform === "windows"
    ? "not DPAPI-protected"
    : null;
  const isWarn = status !== null && status.platform === "windows" && !status.dpapi_protected;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "6px",
      padding: "5px 8px", marginBottom: "4px",
      background: isWarn ? "rgba(255,159,10,0.08)" : "rgba(52,199,89,0.08)",
      border: `1px solid ${isWarn ? "rgba(255,159,10,0.25)" : "rgba(52,199,89,0.25)"}`,
      borderRadius: radii.sm,
    }}>
      <span style={{ ...typography.small, color: isWarn ? "#FF9F0A" : "#34C759", flex: 1 }}>
        {status?.sqlcipher_active ? "SQLCipher AES-256 + " : ""}ChaCha20-Poly1305 (fields){dpapiLabel ? ` - ${dpapiLabel}` : ""}
      </span>
    </div>
  );
}

export function DataInventoryRow() {
  const [turnCount, setTurnCount] = useState<number | null>(null);
  const [oldest, setOldest] = useState<string | null>(null);
  const retentionDays = useCompanionStore(s => s.memoryRetentionDays);

  useEffect(() => {
    invoke<number>("db_turn_count").then(setTurnCount).catch(() => {});
    invoke<string | null>("get_oldest_turn_date").then(setOldest).catch(() => {});
  }, []);

  const nextClear = retentionDays > 0 && oldest
    ? new Date(new Date(oldest).getTime() + retentionDays * 86_400_000).toLocaleDateString()
    : retentionDays > 0 ? "soon" : "never";

  return (
    <div style={{ ...typography.small, color: colors.textTertiary, padding: "3px 2px 5px" }}>
      {turnCount !== null ? `${turnCount} conversation${turnCount === 1 ? "" : "s"} stored` : "-"}
      {oldest ? ` - oldest ${new Date(oldest).toLocaleDateString()}` : ""}
      {` - auto-clear: ${nextClear}`}
    </div>
  );
}

export function RekeyButton() {
  const [rekeyState, setRekeyState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [rekeyed, setRekeyed] = useState(0);

  async function handleRekey() {
    if (!window.confirm(
      "Re-encrypt all conversations with a fresh key?\n\nNew saves will immediately use the new key - no restart required."
    )) return;
    setRekeyState("working");
    try {
      const count = await invoke<number>("rekey_database");
      setRekeyed(count);
      setRekeyState("done");
    } catch {
      setRekeyState("error");
    }
  }

  if (rekeyState === "done") {
    return (
      <div style={{
        padding: "7px 10px",
        background: "rgba(52,199,89,0.08)",
        border: "1px solid rgba(52,199,89,0.25)",
        borderRadius: radii.sm,
        ...typography.caption, color: "#34C759",
      }}>
        Re-keyed {rekeyed} conversation{rekeyed !== 1 ? "s" : ""} - active immediately
      </div>
    );
  }
  if (rekeyState === "error") {
    return (
      <div style={{
        padding: "7px 10px",
        background: "rgba(255,69,58,0.08)",
        border: "1px solid rgba(255,69,58,0.25)",
        borderRadius: radii.sm,
        ...typography.caption, color: "#FF453A",
      }}>
        Re-key failed - app data directory may not be writable
      </div>
    );
  }

  return (
    <button
      onClick={handleRekey}
      disabled={rekeyState === "working"}
      style={{
        padding: "7px 10px",
        background: "transparent",
        border: `1px solid ${colors.border}`,
        borderRadius: radii.sm,
        color: rekeyState === "working" ? colors.textTertiary : colors.textSecondary,
        cursor: rekeyState === "working" ? "default" : "pointer",
        ...typography.caption,
        textAlign: "left" as const,
        fontFamily: "inherit",
      }}
    >
      {rekeyState === "working" ? "Re-keying..." : "Rotate encryption key"}
    </button>
  );
}
