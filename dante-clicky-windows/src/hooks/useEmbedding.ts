import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

export type EmbeddingStatus = "idle" | "loading" | "ready" | "error";

export function useEmbedding() {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<Map<string, (emb: number[]) => void>>(new Map());
  const loadWaitersRef = useRef<Array<{ resolve: () => void; reject: (error: Error) => void }>>([]);
  const loadPromiseRef = useRef<Promise<void> | null>(null);
  const [status, setStatus] = useState<EmbeddingStatus>("idle");
  const [loadProgress, setLoadProgress] = useState(0);
  const statusRef = useRef<EmbeddingStatus>("idle");

  function updateStatus(nextStatus: EmbeddingStatus) {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }

  function ensureWorker(): Worker {
    if (workerRef.current) {
      return workerRef.current;
    }

    const worker = new Worker(
      new URL("../workers/embedding.worker.ts", import.meta.url),
      { type: "module" }
    );
    workerRef.current = worker;

    worker.addEventListener("message", (e: MessageEvent) => {
      const { type, embedding, id, progress } = e.data as {
        type: string;
        embedding?: number[];
        id?: string;
        progress?: number;
      };
      if (type === "ready") {
        updateStatus("ready");
        const waiters = loadWaitersRef.current.splice(0);
        loadPromiseRef.current = null;
        waiters.forEach((waiter) => waiter.resolve());
      } else if (type === "progress" && typeof progress === "number") {
        setLoadProgress(progress);
      } else if (type === "error") {
        updateStatus("error");
        const waiters = loadWaitersRef.current.splice(0);
        loadPromiseRef.current = null;
        waiters.forEach((waiter) => waiter.reject(new Error(String(e.data?.error ?? "Embedding worker failed"))));
      } else if (type === "embedding" && id && embedding) {
        pendingRef.current.get(id)?.(embedding);
        pendingRef.current.delete(id);
      }
    });

    return worker;
  }

  const ensureLoaded = useCallback(async (): Promise<Worker> => {
    const worker = ensureWorker();
    if (statusRef.current === "ready") {
      return worker;
    }
    if (loadPromiseRef.current) {
      await loadPromiseRef.current;
      return worker;
    }

    loadPromiseRef.current = new Promise<void>((resolve, reject) => {
      loadWaitersRef.current.push({ resolve, reject });
    });
    updateStatus("loading");
    worker.postMessage({ type: "load" });
    await loadPromiseRef.current;
    return worker;
  }, []);

  useEffect(() => {
    return () => {
      const worker = workerRef.current;
      worker?.terminate();
      workerRef.current = null;
      pendingRef.current.clear();
      loadWaitersRef.current.splice(0);
      loadPromiseRef.current = null;
    };
  }, []);

  const embed = useCallback((text: string): Promise<number[]> => {
    return ensureLoaded().then((worker) => new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      pendingRef.current.set(id, resolve);
      worker.postMessage({ type: "embed", text, id });
      // 10s timeout — model inference should complete well within this
      const timer = setTimeout(() => {
        if (pendingRef.current.has(id)) {
          pendingRef.current.delete(id);
          reject(new Error("Embedding timeout"));
        }
      }, 10_000);
      // Clear timer if we get a result (swap the resolve)
      const originalResolve = pendingRef.current.get(id)!;
      pendingRef.current.set(id, (emb) => {
        clearTimeout(timer);
        originalResolve(emb);
      });
    }));
  }, [ensureLoaded]);

  /**
   * Generate an embedding for a saved turn and persist it to SQLite.
   * Always resolves — errors are swallowed so callers never need to handle them.
   */
  const embedAndSave = useCallback(
    async (turnId: number, userText: string, assistantText: string): Promise<void> => {
      try {
        const embedding = await embed(`${userText} ${assistantText}`);
        await invoke("save_embedding", { turnId, embedding });
      } catch {
        // Best-effort: embedding failure must never block the voice pipeline
      }
    },
    [embed]
  );

  const retry = useCallback(() => {
    if (statusRef.current === "error") {
      ensureLoaded().catch(() => {});
    }
  }, [ensureLoaded]);

  return { status, loadProgress, embed, embedAndSave, retry, ensureLoaded };
}
