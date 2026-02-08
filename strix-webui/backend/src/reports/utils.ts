/** Shared utilities for report generators (PDF, DOCX, etc.) */

export interface ParsedBlock {
  type: "text" | "tool";
  text?: string;
  tool?: { name: string; status: string; input: Record<string, unknown>; result?: string };
}

export const REPORT_COLORS = {
  text: "#FFFFFF",
  muted: "#A0A0A0",
  border: "#2A2A2A",
  accent: "#22C55E",
};

export const TOOL_INPUT_TRUNCATE = 200;
export const TOOL_RESULT_TRUNCATE = 300;

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/**
 * Normalize content that may have lost its newlines.
 * Inserts line breaks before markdown block markers that appear mid-line.
 */
export function normalizeContent(text: string): string {
  const lines = text.split("\n");
  if (lines.length > 3) return text;
  return text
    .replace(/([.!?:})\]]) (#{1,3} )/g, "$1\n\n$2")
    .replace(/([.!?]) (- )/g, "$1\n$2")
    .replace(/(```)/g, "\n$1\n")
    .replace(/\n{3,}/g, "\n\n");
}

/** Strip inline markdown markers */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1");
}

export function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
}
