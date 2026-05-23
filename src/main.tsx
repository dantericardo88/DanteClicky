import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

function mountApp() {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

// In Tauri 2 dev mode, ESM modules (type="module") can execute before Tauri's
// initialization script finishes injecting __TAURI_INTERNALS__ into WebView2.
// Poll briefly (max 2s) so invoke/listen are available from the first render.
function waitForTauriThenMount() {
  const w = window as unknown as Record<string, unknown>;
  if (w.__TAURI_INTERNALS__) {
    console.info("[DanteClicky] __TAURI_INTERNALS__: available");
    mountApp();
    return;
  }
  let attempts = 0;
  const timer = setInterval(() => {
    attempts++;
    if (w.__TAURI_INTERNALS__) {
      clearInterval(timer);
      console.info(`[DanteClicky] __TAURI_INTERNALS__: available after ${attempts * 10}ms`);
      mountApp();
    } else if (attempts >= 200) {
      clearInterval(timer);
      console.warn("[DanteClicky] __TAURI_INTERNALS__: not available after 2s — mounting anyway");
      mountApp();
    }
  }, 10);
}

waitForTauriThenMount();
