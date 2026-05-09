import { Suspense, lazy } from "react";

const CompanionPanel = lazy(() => import("./windows/CompanionPanel"));
const OverlayPanel = lazy(() => import("./windows/OverlayPanel"));
const OnboardingWindow = lazy(() => import("./windows/OnboardingWindow"));

function WindowLoadingFallback() {
  return null;
}

// Route to the correct window component based on URL param.
// Companion panel:  index.html                       (label: companion-panel)
// Overlay window:   index.html?window=overlay        (label: overlay)
// Onboarding:       index.html?window=onboarding     (label: onboarding)
export default function App() {
  const params = new URLSearchParams(window.location.search);
  const windowType = params.get("window");

  if (windowType === "overlay") {
    return (
      <Suspense fallback={<WindowLoadingFallback />}>
        <OverlayPanel />
      </Suspense>
    );
  }

  if (windowType === "onboarding") {
    return (
      <Suspense fallback={<WindowLoadingFallback />}>
        <OnboardingWindow />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<WindowLoadingFallback />}>
      <CompanionPanel />
    </Suspense>
  );
}
