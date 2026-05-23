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
  contains_cursor?: boolean;
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

// Returns the primary/cursor screen first and keeps screen labels aligned with
// the multimodal image order passed to providers.
export function sortScreens(screens: CapturedScreen[]): CapturedScreen[] {
  return [...screens]
    .sort((a, b) => screenRank(b) - screenRank(a))
    .map((screen, index) => ({
      ...screen,
      label: `screen${index + 1}`,
    }));
}

function screenRank(screen: CapturedScreen): number {
  if (screen.contains_cursor) return 2;
  if (screen.is_primary) return 1;
  return 0;
}
