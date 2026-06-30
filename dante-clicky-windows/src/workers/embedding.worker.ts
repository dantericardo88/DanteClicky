import { pipeline, env } from "@huggingface/transformers";

// Cache model files in IndexedDB — no re-download after first use.
env.allowLocalModels = false;
env.useBrowserCache = true;

// Fix WebView2 WASM crash: SharedArrayBuffer unavailable without COOP/COEP headers.
// numThreads=1 uses single-thread mode. wasmPaths loads ort-wasm-simd-threaded.wasm
// from the app bundle (copied to public/ort/ by the Vite plugin) — no CDN required
// after install. The model (~23MB) is downloaded once and cached in IndexedDB.
// @ts-expect-error onnx backend not in public type surface
env.backends.onnx.wasm.numThreads = 1;
// @ts-expect-error onnx backend not in public type surface
env.backends.onnx.wasm.wasmPaths = "/ort/";

type ProgressCallback = (progress: { progress?: number; status?: string }) => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let embedder: any = null;

self.addEventListener("message", async (e: MessageEvent) => {
  const { type, text, id } = e.data as {
    type: string;
    text?: string;
    id?: string;
  };

  if (type === "load") {
    try {
      const progressCallback: ProgressCallback = (p) => {
        self.postMessage({ type: "progress", progress: p.progress ?? 0, status: p.status ?? "" });
      };
      embedder = await pipeline(
        "feature-extraction",
        "Xenova/all-MiniLM-L6-v2",
        { dtype: "q8", progress_callback: progressCallback }
      );
      self.postMessage({ type: "ready" });
    } catch (err) {
      self.postMessage({ type: "error", error: String(err) });
    }
    return;
  }

  if (type === "embed" && embedder && text !== undefined) {
    try {
      // pooling: "mean" + normalize: true gives unit-norm 384-dim vectors
      const output = await embedder(text, { pooling: "mean", normalize: true });
      const embedding = Array.from(output.data as Float32Array);
      self.postMessage({ type: "embedding", embedding, id });
    } catch (err) {
      self.postMessage({ type: "error", error: String(err), id });
    }
  }
});
