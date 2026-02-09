import clsx from "clsx";
import { Check, XCircle, Terminal, Loader2 } from "lucide-react";
import { Collapsible } from "./ui/Collapsible";
import { ExpandIcon } from "./ui/ExpandIcon";
import type { ToolBlock } from "../types/chat";

interface ToolBlockRendererProps {
  tool: ToolBlock;
  toolKey: string;
  isExpanded: boolean;
  onToggle: () => void;
  /** "compact" for ReportPreview side panel, "normal" for AskAI main view */
  variant?: "compact" | "normal";
}

export function ToolBlockRenderer({ tool, toolKey, isExpanded, onToggle, variant = "normal" }: ToolBlockRendererProps) {
  const isCompact = variant === "compact";
  const px = isCompact ? "px-2.5" : "px-3";
  const py = isCompact ? "py-1.5" : "py-2";
  const maxInputH = isCompact ? "max-h-32" : "max-h-40";
  const maxOutputH = isCompact ? "max-h-48" : "max-h-60";
  const fontSize = isCompact ? "text-[11px]" : "text-xs";

  return (
    <div className={clsx(
      "border overflow-hidden",
      isCompact ? "rounded-card" : "rounded-xl",
      tool.status === "running" ? "border-severity-high/40" : "border-strix-border-subtle"
    )}>
      <button
        onClick={onToggle}
        className={clsx("w-full flex items-center gap-2 bg-strix-elevated hover:bg-strix-bg transition-colors text-left", px, py)}
      >
        <ExpandIcon isExpanded={isExpanded} size={12} className="text-strix-text-muted shrink-0" />
        {tool.status === "running" ? (
          <Loader2 size={12} className="text-severity-high animate-spin shrink-0" />
        ) : (
          <Terminal size={12} className="text-strix-accent shrink-0" />
        )}
        <span className={clsx(
          "text-xs font-mono truncate flex-1",
          tool.status === "running" ? "text-severity-high" : "text-strix-text-secondary"
        )}>
          {tool.name}
        </span>
        {tool.status === "running" && (
          <span className="text-[10px] text-severity-high/70">running</span>
        )}
        {tool.status === "done" && <Check size={12} className="text-strix-accent shrink-0" />}
        {tool.status === "error" && <XCircle size={12} className="text-severity-high shrink-0" />}
      </button>
      <Collapsible isExpanded={isExpanded}>
          <div className="border-t border-strix-border-subtle">
            <div className={clsx("bg-strix-bg", px, py)}>
              <div className="text-[10px] uppercase text-strix-text-muted tracking-wider mb-1">Input</div>
              <pre className={clsx(fontSize, "font-mono text-strix-text-muted overflow-x-auto whitespace-pre-wrap break-all overflow-y-auto", maxInputH)}>
                {JSON.stringify(tool.input, null, 2)}
              </pre>
            </div>
            {tool.result && (
              <div className={clsx("bg-strix-bg border-t border-strix-border-subtle", px, py)}>
                <div className="text-[10px] uppercase text-strix-text-muted tracking-wider mb-1">Output</div>
                <pre className={clsx(fontSize, "font-mono text-strix-text-muted overflow-x-auto whitespace-pre-wrap break-all overflow-y-auto", maxOutputH)}>
                  {tool.result}
                </pre>
              </div>
            )}
          </div>
      </Collapsible>
    </div>
  );
}
