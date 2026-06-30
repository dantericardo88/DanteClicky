import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

function copyOrtWasm() {
  const ortDist = resolve("./node_modules/onnxruntime-web/dist");
  const dest = resolve("./public/ort");
  mkdirSync(dest, { recursive: true });
  for (const f of ["ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.jsep.wasm"]) {
    const src = resolve(ortDist, f);
    if (existsSync(src)) {
      copyFileSync(src, resolve(dest, f));
    }
  }
}

const copyOrtWasmPlugin = {
  name: "copy-ort-wasm",
  buildStart: copyOrtWasm,
  configureServer: copyOrtWasm,
};

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), copyOrtWasmPlugin],

  // Prevent Vite from pre-bundling @huggingface/transformers — it uses dynamic
  // imports for WASM model shards that must remain unbundled to load correctly.
  optimizeDeps: {
    exclude: ["@huggingface/transformers"],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("@huggingface/transformers") || id.includes("onnxruntime")) {
            return "local-models";
          }
          if (id.includes("react-markdown")) {
            return "markdown";
          }
          if (id.includes("node_modules")) {
            return "vendor";
          }
        },
      },
    },
  },
}));
