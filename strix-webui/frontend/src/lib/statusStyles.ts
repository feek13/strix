/** Centralized status styling for scan/agent status indicators */

export const STATUS_DOT: Record<string, string> = {
  running: "bg-strix-accent animate-pulse",
  completed: "bg-strix-text-muted",
  failed: "bg-severity-critical",
  stopped: "bg-severity-medium",
  pending: "bg-severity-low",
};

export const STATUS_TEXT: Record<string, string> = {
  running: "text-strix-accent",
  completed: "text-strix-text-muted",
  failed: "text-severity-critical",
  stopped: "text-severity-medium",
  pending: "text-severity-low",
};
