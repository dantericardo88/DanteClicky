// Screenpipe integration — gracefully degrades when Screenpipe is not running.
// Screenpipe exposes a local REST API on http://localhost:3030

const SCREENPIPE_BASE = "http://localhost:3030";
const FETCH_TIMEOUT_MS = 2000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScreenpipeFrame {
  timestamp: string;
  text: string;        // OCR'd text from screen
  app_name?: string;   // active app at time of frame
  window_name?: string;
}

export interface ScreenpipeAudioChunk {
  timestamp: string;
  transcription: string;
  speaker?: string;
}

export interface ScreenpipeSearchResult {
  frames: ScreenpipeFrame[];
  audio: ScreenpipeAudioChunk[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true if the local Screenpipe daemon is reachable.
 * Never throws.
 */
export async function isScreenpipeRunning(): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(
      `${SCREENPIPE_BASE}/health`,
      FETCH_TIMEOUT_MS
    );
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Searches Screenpipe's local memory for content matching `query`.
 * Returns null if Screenpipe is not running or any network/parse error occurs.
 */
export async function queryScreenMemory(
  query: string,
  limit = 3
): Promise<ScreenpipeSearchResult | null> {
  try {
    const url = new URL(`${SCREENPIPE_BASE}/search`);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(limit));

    const res = await fetchWithTimeout(url.toString(), FETCH_TIMEOUT_MS);

    if (!res.ok) return null;

    const json = await res.json();

    // Normalise Screenpipe response shape — it may vary across versions.
    // Expect { frames: [...], audio: [...] } or { data: { frames, audio } }
    const payload = json?.data ?? json;
    const frames: ScreenpipeFrame[] = Array.isArray(payload?.frames)
      ? payload.frames
      : [];
    const audio: ScreenpipeAudioChunk[] = Array.isArray(payload?.audio)
      ? payload.audio
      : [];

    return { frames, audio };
  } catch {
    return null;
  }
}

/**
 * Builds a rich context string that can be prepended to the AI system prompt.
 *
 * Combines:
 *  1. The last `limit` Screenpipe frames relevant to `userQuery`
 *  2. The count of current monitor screenshots provided by the caller
 *
 * Never throws — returns an empty string if Screenpipe is unavailable.
 */
export async function assembleRichContext(
  userQuery: string,
  currentScreenBase64s: string[]
): Promise<string> {
  try {
    const result = await queryScreenMemory(userQuery, 3);

    const lines: string[] = [];

    if (result && result.frames.length > 0) {
      for (const frame of result.frames) {
        const app = frame.app_name ? ` (in ${frame.app_name})` : "";
        lines.push(`Previously seen: ${frame.text.trim()}${app}`);
      }
    }

    const monitorCount = currentScreenBase64s.length;
    if (monitorCount > 0) {
      lines.push(`Currently seeing ${monitorCount} monitor(s)`);
    }

    return lines.join("\n");
  } catch {
    return "";
  }
}
