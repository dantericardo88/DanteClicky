import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");

function readProjectFile(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function extractSetupSource(libSource: string): string {
  const setupMatch = /\.setup\((?:move\s*)?\|app\|\s*\{/.exec(libSource);
  const setupStart = setupMatch?.index ?? -1;
  expect(setupStart).toBeGreaterThan(-1);

  const openBrace = libSource.indexOf("{", setupStart);
  expect(openBrace).toBeGreaterThan(setupStart);

  let depth = 0;
  for (let index = openBrace; index < libSource.length; index += 1) {
    const char = libSource[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return libSource.slice(setupStart, index + 1);
      }
    }
  }

  throw new Error("Unable to find the end of the Tauri setup closure");
}

describe("startup architecture", () => {
  it("code-splits window entrypoints instead of importing every window at boot", () => {
    const appSource = readProjectFile("src/App.tsx");

    expect(appSource).toContain("lazy(() => import(\"./windows/CompanionPanel\"))");
    expect(appSource).toContain("lazy(() => import(\"./windows/OverlayPanel\"))");
    expect(appSource).toContain("lazy(() => import(\"./windows/OnboardingWindow\"))");
    expect(appSource).toContain("<Suspense");
    expect(appSource).not.toContain("import CompanionPanel from \"./windows/CompanionPanel\"");
    expect(appSource).not.toContain("import OverlayPanel from \"./windows/OverlayPanel\"");
    expect(appSource).not.toContain("import OnboardingWindow from \"./windows/OnboardingWindow\"");
  });

  it("does not load the offline embedding model as a CompanionPanel mount side effect", () => {
    const embeddingHookSource = readProjectFile("src/hooks/useEmbedding.ts");

    expect(embeddingHookSource).toContain("function ensureWorker");
    expect(embeddingHookSource).not.toContain("useEffect(() => {\n    const worker = new Worker");
    expect(embeddingHookSource).not.toContain("worker.postMessage({ type: \"load\" });\n    setStatus(\"loading\");");
  });

  it("keeps heavy companion tabs out of the initial panel bundle", () => {
    const companionSource = readProjectFile("src/windows/CompanionPanel.tsx");

    expect(companionSource).toContain("lazy(() => import(\"./AgentPanel\")");
    expect(companionSource).toContain("lazy(() => import(\"./MemoryPanel\")");
    expect(companionSource).toContain("<Suspense");
    expect(companionSource).not.toContain("import { AgentPanel } from \"./AgentPanel\"");
    expect(companionSource).not.toContain("import { MemoryPanel } from \"./MemoryPanel\"");
  });

  it("creates the overlay webview lazily on first show instead of during app setup", () => {
    const libSource = readProjectFile("src-tauri/src/lib.rs");
    const setupSource = extractSetupSource(libSource);

    expect(libSource).toContain("fn ensure_overlay_window");
    expect(libSource).toContain("ensure_overlay_window(&app)");
    expect(setupSource).not.toContain("\"overlay\"");
    expect(setupSource).not.toContain("index.html?window=overlay");
  });

  it("does not create app webviews during native startup", () => {
    const libSource = readProjectFile("src-tauri/src/lib.rs");
    const setupSource = extractSetupSource(libSource);

    expect(libSource).toContain("pub(crate) fn ensure_companion_panel");
    expect(libSource).toContain("\"first_panel_created\"");
    expect(libSource).toContain("WebviewUrl::App(\"index.html\".into())");
    expect(setupSource).not.toContain("WebviewWindowBuilder::new");
    expect(setupSource).not.toContain("\"companion-panel\"");
    expect(setupSource).not.toContain("index.html?window=onboarding");
  });

  it("routes explicit companion open paths through the lazy panel helper", () => {
    const libSource = readProjectFile("src-tauri/src/lib.rs");
    const traySource = readProjectFile("src-tauri/src/tray.rs");
    const completeStart = libSource.indexOf("fn complete_onboarding");
    const showStart = libSource.indexOf("fn show_companion_panel");
    const opacityStart = libSource.indexOf("fn set_companion_opacity");
    const positionStart = libSource.indexOf("fn set_companion_panel_position");
    const memoryStart = libSource.indexOf("// ── Memory Digest commands", positionStart);

    expect(completeStart).toBeGreaterThan(-1);
    expect(showStart).toBeGreaterThan(completeStart);
    expect(positionStart).toBeGreaterThan(showStart);
    expect(memoryStart).toBeGreaterThan(positionStart);
    expect(libSource).toContain("pub(crate) fn toggle_primary_window");
    expect(libSource.slice(completeStart, showStart)).toContain("ensure_companion_panel(&app)");
    expect(libSource.slice(showStart, opacityStart)).toContain("ensure_companion_panel(&app)");
    expect(libSource.slice(positionStart, memoryStart)).toContain("ensure_companion_panel(&app)");
    expect(traySource).toContain("crate::toggle_primary_window(app)");
  });

  it("buffers the first tray-only hotkey until the companion listener is ready", () => {
    const libSource = readProjectFile("src-tauri/src/lib.rs");
    const hotkeySource = readProjectFile("src-tauri/src/hotkey.rs");
    const voiceSource = readProjectFile("src/hooks/useVoice.ts");

    expect(libSource).toContain("hotkey::drain_pending_hotkey_events");
    expect(hotkeySource).toContain("PendingHotkeyEvent");
    expect(hotkeySource).toContain("record_pending_hotkey_event");
    expect(hotkeySource).toContain("has_pending_hotkey_events");
    expect(hotkeySource).toContain("crate::ensure_companion_panel(app)");
    expect(hotkeySource).toContain("pub fn drain_pending_hotkey_events");
    expect(voiceSource).toContain("drain_pending_hotkey_events");
    expect(voiceSource).toContain("for (const pendingEvent of pendingHotkeyEvents)");
  });

  it("enumerates monitors without requiring the companion webview", () => {
    const monitorsSource = readProjectFile("src-tauri/src/monitors.rs");

    expect(monitorsSource).not.toContain("get_webview_window(\"companion-panel\")");
    expect(monitorsSource).toContain("screenshots::Screen");
    expect(monitorsSource).toContain("Screen::all()");
  });

  it("defers session database warmup until after native readiness", () => {
    const libSource = readProjectFile("src-tauri/src/lib.rs");
    const setupSource = extractSetupSource(libSource);
    const readyProbe = setupSource.indexOf("write_startup_probe(&handle, ready_elapsed)");
    const dbOpen = setupSource.indexOf("session::SessionDb::open");

    expect(readyProbe).toBeGreaterThan(-1);
    expect(dbOpen).toBeGreaterThan(readyProbe);
    expect(setupSource).toContain("tauri::async_runtime::spawn_blocking");
  });

  it("keeps AudioState construction cheap by deferring WASAPI device probing", () => {
    const audioSource = readProjectFile("src-tauri/src/audio.rs");
    const constructorStart = audioSource.indexOf("impl AudioState {\n    pub fn new() -> Self");
    const prewarmStart = audioSource.indexOf("pub fn prewarm_input_device", constructorStart);
    const constructorSource = audioSource.slice(constructorStart, prewarmStart);

    expect(constructorSource).not.toContain("default_input_device()");
    expect(audioSource).toContain("pub fn prewarm_input_device");
  });

  it("defers ambient capture and retention cleanup past cold start", () => {
    const ambientSource = readProjectFile("src/hooks/useAmbient.ts");
    const intervalStart = ambientSource.indexOf("// Start/stop/restart the interval");
    const intervalEnd = ambientSource.indexOf("  }, [ambientMode, ambientIntervalSeconds, tick]);", intervalStart);
    const intervalSource = ambientSource.slice(intervalStart, intervalEnd);

    expect(ambientSource).toContain("const AMBIENT_STARTUP_GRACE_MS = 10_000");
    expect(ambientSource).toContain("const AMBIENT_RETENTION_PRUNE_DELAY_MS = 15_000");
    expect(intervalSource).toContain("setTimeout(tick");
    expect(intervalSource).not.toMatch(/^\s*tick\(\);/m);
  });

  it("defers cloud STT warmup and semantic backfill until after the UI is ready", () => {
    const voiceSource = readProjectFile("src/hooks/useVoice.ts");
    const prewarmStart = voiceSource.indexOf("// Pre-warm AssemblyAI WebSocket");
    const prewarmEnd = voiceSource.indexOf("// Forward audio chunks", prewarmStart);
    const prewarmSource = voiceSource.slice(prewarmStart, prewarmEnd);
    const backfillStart = voiceSource.indexOf("// On startup (or when OpenAI key is first set)");
    const backfillEnd = voiceSource.indexOf("// WASM path", backfillStart);
    const backfillSource = voiceSource.slice(backfillStart, backfillEnd);

    expect(prewarmSource).toContain("timer = setTimeout");
    expect(prewarmSource).toContain("assemblyAI.preWarm");
    expect(prewarmSource).toContain("}, 5_000);");
    expect(backfillSource).toContain("const runDeferredIndex = async () =>");
    expect(backfillSource).toContain("timer = setTimeout");
    expect(backfillSource).toContain("get_unembedded_turns");
    expect(backfillSource).toContain("}, 10_000);");
  });

  it("starts local bridge servers after a cold-start grace period", () => {
    const libSource = readProjectFile("src-tauri/src/lib.rs");

    expect(libSource).toMatch(/sleep\(std::time::Duration::from_secs\(5\)\)\.await;[\s\S]*ws_server::start/);
    expect(libSource).toMatch(/sleep\(std::time::Duration::from_secs\(5\)\)\.await;[\s\S]*mcp_server::start/);
  });

  it("has an opt-in startup probe for release timing evidence", () => {
    const libSource = readProjectFile("src-tauri/src/lib.rs");

    expect(libSource).toContain("fn write_startup_probe");
    expect(libSource).toContain("fn write_startup_probe_marker");
    expect(libSource).toContain("DANTE_STARTUP_PROBE");
    expect(libSource).toContain("startup.ready elapsed_ms=");
    expect(libSource).toContain("write_startup_probe(&handle, ready_elapsed)");
    expect(libSource).toContain("write_startup_probe_marker(&handle, \"tray_ready\")");
    expect(libSource).toContain("write_startup_probe_marker(&handle, \"hotkey_registered\")");
    expect(libSource).toContain("write_startup_probe_marker(&handle, \"native_ready\")");
    expect(libSource).toContain("startup-probe.jsonl");
    expect(libSource).toContain(".setup(move |app| {");
  });
});
