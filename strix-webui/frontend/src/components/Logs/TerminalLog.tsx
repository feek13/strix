import { useRef, useEffect, useState } from "react";
import { useLogStore } from "../../store/logStore";
import { useToolStore } from "../../store/toolStore";
import clsx from "clsx";
import { ArrowDown, ChevronRight } from "lucide-react";

export default function TerminalLog() {
  const logs = useLogStore((s) => s.logs);
  const tools = useToolStore((s) => s.tools);
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
  };

  const toolArr = Array.from(tools.values());

  return (
    <div className="h-full flex flex-col bg-strix-bg font-mono text-xs">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-strix-card border-b border-strix-border-subtle">
        <span className="text-strix-text-muted text-[10px] uppercase tracking-wider">Terminal</span>
        <span className="text-strix-text-muted text-[10px]">{logs.length} entries</span>
      </div>

      {/* Log stream */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-2 space-y-0.5"
      >
        {logs.map((log) => {
          const tool = log.toolName ? toolArr.find(
            (t) => t.toolName === log.toolName && Math.abs(new Date(t.startedAt).getTime() - new Date(log.timestamp).getTime()) < 5000
          ) : null;
          const isExpanded = tool && expandedTool === tool.id;

          return (
            <div key={log.id}>
              <div
                className={clsx(
                  "flex items-start gap-2 px-2 py-0.5 rounded hover:bg-strix-elevated/50 cursor-default",
                  tool && "cursor-pointer"
                )}
                onClick={() => tool && setExpandedTool(isExpanded ? null : tool.id)}
              >
                {/* Timestamp */}
                <span className="text-strix-text-muted shrink-0 w-16">
                  {new Date(log.timestamp).toLocaleTimeString("en-US", { hour12: false })}
                </span>

                {/* Level indicator */}
                <span
                  className={clsx(
                    "shrink-0 w-1 h-3 rounded-full mt-0.5",
                    log.level === "success" && "bg-strix-accent",
                    log.level === "warning" && "bg-severity-medium",
                    log.level === "error" && "bg-severity-critical",
                    log.level === "info" && "bg-severity-low",
                    log.level === "debug" && "bg-strix-text-muted"
                  )}
                />

                {/* Expand icon for tools */}
                {tool && (
                  <span className="shrink-0 text-strix-text-muted">
                    <ChevronRight
                      size={10}
                      className={clsx(
                        "transition-transform duration-300 ease-spring will-change-transform",
                        isExpanded && "rotate-90"
                      )}
                    />
                  </span>
                )}

                {/* Message */}
                <span
                  className={clsx(
                    log.level === "success" && "text-strix-accent",
                    log.level === "warning" && "text-severity-medium",
                    log.level === "error" && "text-severity-critical",
                    log.level === "info" && "text-strix-text-secondary",
                    log.level === "debug" && "text-strix-text-muted"
                  )}
                >
                  {log.message}
                </span>
              </div>

              {/* Expanded tool detail */}
              {tool && (
                <div
                  className={clsx(
                    "grid transition-[grid-template-rows] duration-300 ease-spring will-change-[grid-template-rows]",
                    isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                  )}
                >
                  <div
                    className={clsx(
                      "overflow-hidden transition-opacity duration-300 ease-spring",
                      isExpanded ? "opacity-100" : "opacity-0"
                    )}
                  >
                    <div className="ml-20 mr-2 my-1 p-2 bg-strix-elevated rounded border border-strix-border-subtle">
                      <div className="text-strix-text-muted mb-1">Input:</div>
                      <pre className="text-strix-text-secondary text-[10px] overflow-x-auto max-h-32 overflow-y-auto">
                        {JSON.stringify(tool.toolInput, null, 2)}
                      </pre>
                      {tool.toolOutput !== undefined && tool.toolOutput !== null && (
                        <>
                          <div className="text-strix-text-muted mt-2 mb-1">Output:</div>
                          <pre className="text-strix-text-secondary text-[10px] overflow-x-auto max-h-32 overflow-y-auto">
                            {typeof tool.toolOutput === "string"
                              ? (tool.toolOutput as string).slice(0, 2000)
                              : JSON.stringify(tool.toolOutput, null, 2).slice(0, 2000)}
                          </pre>
                        </>
                      )}
                      {tool.duration !== undefined && (
                        <div className="text-strix-text-muted mt-1 text-[10px]">
                          Duration: {(tool.duration / 1000).toFixed(2)}s
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {logs.length === 0 && (
          <div className="text-strix-text-muted text-center py-8">
            Waiting for events...
          </div>
        )}
      </div>

      {/* Scroll to bottom button */}
      {!autoScroll && (
        <button
          onClick={() => {
            setAutoScroll(true);
            if (containerRef.current) {
              containerRef.current.scrollTop = containerRef.current.scrollHeight;
            }
          }}
          className="absolute bottom-14 right-4 p-1.5 rounded-full bg-strix-card border border-strix-border shadow-lg hover:bg-strix-elevated transition-colors"
        >
          <ArrowDown size={14} className="text-strix-text-secondary" />
        </button>
      )}
    </div>
  );
}
