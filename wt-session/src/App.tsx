import CompanionPanel from "./windows/CompanionPanel";
import OverlayPanel from "./windows/OverlayPanel";

// Route to the correct window component based on URL param.
// Companion panel:  index.html          (label: companion-panel)
// Overlay window:   index.html?window=overlay  (label: overlay)
export default function App() {
  const params = new URLSearchParams(window.location.search);
  const windowType = params.get("window");

  if (windowType === "overlay") {
    return <OverlayPanel />;
  }

  return <CompanionPanel />;
}
