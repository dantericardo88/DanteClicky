import { invoke } from "@tauri-apps/api/core";
import { captureTelemetryError, recordTelemetryEvent, startTelemetrySpan, type TelemetryContext } from "../lib/telemetry";

export interface CapturedScreen {
  label: string;
  data: string;   // base64 JPEG
  mime: string;
  width: number;
  height: number;
  x: number;
  y: number;
  scale_factor: number;
  is_primary: boolean;
}

export async function captureAllScreens(telemetryContext?: TelemetryContext): Promise<CapturedScreen[]> {
  const span = startTelemetrySpan("screen.capture_all", {}, telemetryContext);
  try {
    const result = await invoke<CapturedScreen[]>("capture_screens");
    const screens = result ?? [];
    span.end({
      screenCount: screens.length,
      primaryCount: screens.filter((screen) => screen.is_primary).length,
    });
    recordTelemetryEvent("screen.capture.completed", {
      screenCount: screens.length,
      primaryCount: screens.filter((screen) => screen.is_primary).length,
    }, span.context);
    return screens;
  } catch (err) {
    console.error("[useScreenCapture] capture_screens failed:", err);
    captureTelemetryError(err, { route: "captureAllScreens" }, span.context);
    span.fail(err);
    return [];
  }
}

// Returns the cursor-screen first (primary monitor first, matching macOS behaviour)
export function sortScreens(screens: CapturedScreen[]): CapturedScreen[] {
  return [...screens].sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0));
}
