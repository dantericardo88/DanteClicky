export interface AmbientSnapshotRow {
  id: number;
  active_window: string;
  captured_at: string;
  ocr_snippet: string;
  vision_desc: string;
  pixel_hash: string;
}
export interface CapabilityStatus {
  supported: boolean;
  degraded: boolean;
  backend: string;
  reason?: string | null;
}
export interface PlatformCapabilities {
  os: string;
  family: string;
  nativeScreenCapture: CapabilityStatus;
  nativeInputControl: CapabilityStatus;
  accessibilityTree: CapabilityStatus;
  ocr: CapabilityStatus;
  globalShortcut: CapabilityStatus;
  tray: CapabilityStatus;
  overlayStealth: CapabilityStatus;
  autostart: CapabilityStatus;
  notes: string[];
}
export interface UpdateCheckResult {
  reachedManifest: boolean;
  available: boolean;
  currentVersion: string;
  version?: string | null;
  target?: string | null;
  date?: string | null;
  body?: string | null;
  downloadUrl?: string | null;
  manifestUrl?: string | null;
  signaturePresent: boolean;
}