// Ported from DesignSystem.swift — mirrors the macOS DanteClicky visual language

export const colors = {
  background: "#1C1C1E",
  backgroundSecondary: "#2C2C2E",
  surface: "#3A3A3C",
  surfaceHover: "#48484A",
  border: "rgba(255, 255, 255, 0.08)",
  accent: "#0A84FF",
  accentHover: "#409CFF",
  accentGlow: "rgba(10, 132, 255, 0.25)",
  text: "#FFFFFF",
  textSecondary: "rgba(235, 235, 245, 0.80)",
  textTertiary: "rgba(235, 235, 245, 0.40)",
  success: "#32D74B",
  warning: "#FF9F0A",
  error: "#FF453A",
  overlayBg: "rgba(0, 0, 0, 0.0)",
} as const;

export const radii = {
  xs: "4px",
  sm: "8px",
  md: "12px",
  lg: "16px",
  xl: "24px",
  full: "9999px",
} as const;

export const spacing = {
  xs: "4px",
  sm: "8px",
  md: "12px",
  lg: "16px",
  xl: "24px",
  "2xl": "32px",
} as const;

export const typography = {
  title: { fontSize: "17px", fontWeight: 600, lineHeight: "22px" },
  headline: { fontSize: "15px", fontWeight: 600, lineHeight: "20px" },
  body: { fontSize: "15px", fontWeight: 400, lineHeight: "20px" },
  caption: { fontSize: "13px", fontWeight: 400, lineHeight: "18px" },
  small: { fontSize: "11px", fontWeight: 500, lineHeight: "14px" },
} as const;

export const shadows = {
  panel: "0 8px 32px rgba(0, 0, 0, 0.6), 0 2px 8px rgba(0, 0, 0, 0.4)",
  card: "0 2px 8px rgba(0, 0, 0, 0.3)",
  glow: `0 0 20px rgba(10, 132, 255, 0.3)`,
} as const;

// Provider brand colors
export const providerColors: Record<string, string> = {
  claude: "#D97706",
  openai: "#10A37F",
  grok: "#1DA1F2",
  openrouter: "#7C3AED",
  ollama: "#C7D2FE",
};
