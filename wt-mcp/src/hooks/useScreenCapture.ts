import { invoke } from "@tauri-apps/api/core";

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

export async function captureAllScreens(): Promise<CapturedScreen[]> {
  try {
    const result = await invoke<CapturedScreen[]>("capture_screens");
    return result ?? [];
  } catch (err) {
    console.error("[useScreenCapture] capture_screens failed:", err);
    return [];
  }
}

// Returns the cursor-screen first (primary monitor first, matching macOS behaviour)
export function sortScreens(screens: CapturedScreen[]): CapturedScreen[] {
  return [...screens].sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0));
}
