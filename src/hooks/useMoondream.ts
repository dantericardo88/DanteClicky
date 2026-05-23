import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCompanionStore } from "../state/companionStore";

export interface MoondreamStatus {
  available: boolean;
  model_path: string | null;
  session_loaded: boolean;
  last_description: string | null;
  last_inference_ms: number | null;
  /// "f16" or "f32" depending on which precision the loaded weights use; null when unloaded
  dtype: string | null;
  /// Last error from load/inference, surfaced for the UI to display + offer retry
  last_error: string | null;
}

export interface DownloadProgress {
  file: string;
  bytes_done: number;
  bytes_total: number;
}

export function useMoondream() {
  const [status, setStatus] = useState<MoondreamStatus | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);

  // Poll status every 30s — guarded against missing IPC (dev-mode timing race)
  useEffect(() => {
    if (!(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__) return;
    let isMounted = true;

    const pollStatus = async () => {
      try {
        const s = await invoke<MoondreamStatus>("get_moondream_status");
        if (isMounted) setStatus(s);
      } catch {
        // Swallow — moondream may not be loaded yet
      }
    };

    pollStatus();
    const interval = setInterval(pollStatus, 30000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // Listen to download progress events — guarded against missing IPC
  useEffect(() => {
    if (!(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__) return;

    const unsubscribe = listen<DownloadProgress>("moondream-download-progress", (event) => {
      setDownloadProgress(event.payload);
    }).catch(() => {});

    return () => {
      unsubscribe.then((unsub) => unsub?.());
    };
  }, []);

  const download = async () => {
    setDownloading(true);
    setDownloadProgress(null);
    try {
      await invoke("download_moondream_model");
      // Poll status after download completes
      const s = await invoke<MoondreamStatus>("get_moondream_status");
      setStatus(s);
    } catch (err) {
      console.error("Failed to download model:", err);
    } finally {
      setDownloading(false);
      setDownloadProgress(null);
    }
  };

  const loadModel = async () => {
    try {
      await invoke("load_moondream_model");
      // Poll status after load
      const s = await invoke<MoondreamStatus>("get_moondream_status");
      setStatus(s);
    } catch (err) {
      console.error("Failed to load model:", err);
      throw err;
    }
  };

  // Measure end-to-end inference latency from the renderer side and push into
  // the rolling telemetry window so the settings card can display p50/p95.
  const recordLatency = (ms: number) => {
    useCompanionStore.getState().pushMoondreamInferenceDuration(Math.round(ms));
  };

  const caption = async (jpegB64: string): Promise<string> => {
    const t0 = performance.now();
    try {
      const result = await invoke<string>("moondream_caption", { jpeg_b64: jpegB64 });
      recordLatency(performance.now() - t0);
      return result;
    } catch (e) {
      recordLatency(performance.now() - t0);
      throw e;
    }
  };

  const vqa = async (jpegB64: string, question: string): Promise<string> => {
    const t0 = performance.now();
    try {
      const result = await invoke<string>("moondream_vqa", { jpeg_b64: jpegB64, question });
      recordLatency(performance.now() - t0);
      return result;
    } catch (e) {
      recordLatency(performance.now() - t0);
      throw e;
    }
  };

  const pointQuery = async (jpegB64: string, query: string): Promise<[number, number]> => {
    const t0 = performance.now();
    try {
      const result = await invoke<[number, number]>("moondream_point_query", { jpeg_b64: jpegB64, query });
      recordLatency(performance.now() - t0);
      return result;
    } catch (e) {
      recordLatency(performance.now() - t0);
      throw e;
    }
  };

  return {
    status,
    downloading,
    downloadProgress,
    download,
    loadModel,
    caption,
    vqa,
    pointQuery,
  };
}
