/** Centralized severity styling — import from here instead of defining inline */

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export const SEVERITY_TEXT: Record<string, string> = {
  critical: "text-severity-critical",
  high: "text-severity-high",
  medium: "text-severity-medium",
  low: "text-severity-low",
  info: "text-strix-text-muted",
};

export const SEVERITY_BADGE: Record<string, string> = {
  critical: "bg-severity-critical/20 text-severity-critical",
  high: "bg-severity-high/20 text-severity-high",
  medium: "bg-severity-medium/20 text-severity-medium",
  low: "bg-severity-low/20 text-severity-low",
  info: "bg-strix-elevated text-strix-text-muted",
};

export const SEVERITY_CARD_BG: Record<string, string> = {
  critical: "bg-severity-critical/10 border-severity-critical/30",
  high: "bg-severity-high/10 border-severity-high/30",
  medium: "bg-severity-medium/10 border-severity-medium/30",
  low: "bg-severity-low/10 border-severity-low/30",
  info: "bg-strix-elevated border-strix-border-subtle",
};

/** Hex values for SVG strokes (CSS classes don't work in SVG attributes) */
export const SEVERITY_STROKE: Record<string, string> = {
  critical: "#FF0000",
  high: "#FF6B00",
  medium: "#FFB800",
  low: "#00A8FF",
  info: "#6B6B6B",
};

export const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};
