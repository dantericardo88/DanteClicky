import { colors } from "../../../lib/designSystem";
import type { KeyStatus } from "../../../lib/apiValidation";
export function KeyStatusIndicator({ status }: { status: KeyStatus }) {
  if (status === "unchecked") return null;
  if (status === "checking") {
    return (
      <span style={{ fontSize: "11px", color: colors.textTertiary, flexShrink: 0 }}>
        ...
      </span>
    );
  }
  if (status === "valid") {
    return (
      <span style={{ fontSize: "13px", color: "#32D74B", flexShrink: 0, lineHeight: 1 }}>
        âœ“
      </span>
    );
  }
  // invalid
  return (
    <span style={{ fontSize: "13px", color: "#FF453A", flexShrink: 0, lineHeight: 1 }}>
      âœ—
    </span>
  );
}
