import { Component, Suspense, lazy } from "react";
import type { ReactNode, ErrorInfo } from "react";

const CompanionPanel = lazy(() => import("./windows/CompanionPanel"));
const OverlayPanel = lazy(() => import("./windows/OverlayPanel"));
const OnboardingWindow = lazy(() => import("./windows/OnboardingWindow"));

class RootErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[DanteClicky] render error:", error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          fontFamily: "system-ui, sans-serif",
          padding: 24,
          color: "#FF453A",
          background: "#1c1c1e",
          minHeight: "100vh",
          boxSizing: "border-box",
        }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>
            DanteClicky failed to load
          </div>
          <div style={{ fontSize: 12, color: "#ebebf5cc", marginBottom: 12 }}>
            {this.state.error.message}
          </div>
          <button
            onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            style={{
              padding: "6px 14px", background: "#FF453A", border: "none",
              borderRadius: 6, color: "#fff", cursor: "pointer", fontSize: 12,
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function WindowLoadingFallback() {
  return null;
}

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const windowType = params.get("window");

  if (windowType === "overlay") {
    return (
      <RootErrorBoundary>
        <Suspense fallback={<WindowLoadingFallback />}>
          <OverlayPanel />
        </Suspense>
      </RootErrorBoundary>
    );
  }

  if (windowType === "onboarding") {
    return (
      <RootErrorBoundary>
        <Suspense fallback={<WindowLoadingFallback />}>
          <OnboardingWindow />
        </Suspense>
      </RootErrorBoundary>
    );
  }

  return (
    <RootErrorBoundary>
      <Suspense fallback={<WindowLoadingFallback />}>
        <CompanionPanel />
      </Suspense>
    </RootErrorBoundary>
  );
}
