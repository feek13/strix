import type { ResolvedTheme } from "../hooks/useTheme";

export interface ThemeColorMap {
  bg: string;
  card: string;
  elevated: string;
  borderSubtle: string;
  border: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentHover: string;
  textOnAccent: string;
  severityCritical: string;
  severityHigh: string;
  severityMedium: string;
  severityLow: string;
  severityInfo: string;
}

const darkColors: ThemeColorMap = {
  bg: "#0A0A0A",
  card: "#141414",
  elevated: "#1F1F1F",
  borderSubtle: "#2A2A2A",
  border: "#3A3A3A",
  text: "#FFFFFF",
  textSecondary: "#A0A0A0",
  textMuted: "#6B6B6B",
  accent: "#22C55E",
  accentHover: "#16A34A",
  textOnAccent: "#000000",
  severityCritical: "#FF0000",
  severityHigh: "#FF6B00",
  severityMedium: "#FFB800",
  severityLow: "#00A8FF",
  severityInfo: "#6B6B6B",
};

const lightColors: ThemeColorMap = {
  bg: "#F5F5F5",
  card: "#FFFFFF",
  elevated: "#EEEEEE",
  borderSubtle: "#E0E0E0",
  border: "#D0D0D0",
  text: "#111111",
  textSecondary: "#555555",
  textMuted: "#999999",
  accent: "#16A34A",
  accentHover: "#15803D",
  textOnAccent: "#FFFFFF",
  severityCritical: "#DC2626",
  severityHigh: "#EA580C",
  severityMedium: "#CA8A04",
  severityLow: "#0284C7",
  severityInfo: "#999999",
};

export function getThemeColors(resolved: ResolvedTheme): ThemeColorMap {
  return resolved === "dark" ? darkColors : lightColors;
}
