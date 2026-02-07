import { useMemo, useRef, useEffect } from "react";
import { useToolStore } from "../../store/toolStore";
import { useAgentStore } from "../../store/agentStore";
import { useVulnerabilityStore } from "../../store/vulnerabilityStore";
import { useScanStore } from "../../store/scanStore";
import clsx from "clsx";
import { Bot, Wrench, ShieldAlert } from "lucide-react";

interface TimelineEvent {
  id: string;
  type: "agent" | "tool" | "finding";
  label: string;
  startTime: number;
  endTime?: number;
  agentId?: string;
  status?: string;
  severity?: string;
}

export default function Timeline() {
  const scan = useScanStore((s) => s.activeScan);
  const agents = useAgentStore((s) => s.agents);
  const tools = useToolStore((s) => s.tools);
  const vulns = useVulnerabilityStore((s) => s.vulnerabilities);
  const containerRef = useRef<HTMLDivElement>(null);

  const events = useMemo(() => {
    if (!scan?.startedAt) return [];

    const scanStart = new Date(scan.startedAt).getTime();
    const items: TimelineEvent[] = [];

    // Agent events
    Array.from(agents.values()).forEach((a) => {
      items.push({
        id: a.id,
        type: "agent",
        label: a.name,
        startTime: new Date(a.createdAt).getTime() - scanStart,
        endTime: a.finishedAt ? new Date(a.finishedAt).getTime() - scanStart : undefined,
        status: a.status,
      });
    });

    // Tool events
    Array.from(tools.values()).forEach((t) => {
      items.push({
        id: t.id,
        type: "tool",
        label: t.toolName,
        startTime: new Date(t.startedAt).getTime() - scanStart,
        endTime: t.completedAt ? new Date(t.completedAt).getTime() - scanStart : undefined,
        agentId: t.agentId,
        status: t.status,
      });
    });

    // Vulnerability events
    vulns.forEach((v) => {
      items.push({
        id: v.id,
        type: "finding",
        label: v.title,
        startTime: new Date(v.discoveredAt).getTime() - scanStart,
        severity: v.severity,
      });
    });

    return items.sort((a, b) => a.startTime - b.startTime);
  }, [scan, agents, tools, vulns]);

  // Auto-scroll to end
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollLeft = containerRef.current.scrollWidth;
    }
  }, [events]);

  if (!scan) {
    return (
      <div className="flex items-center justify-center h-full text-strix-text-muted text-sm">
        Start a scan to see the timeline
      </div>
    );
  }

  const maxTime = Math.max(...events.map((e) => e.endTime || e.startTime), 1000);
  const pxPerMs = Math.max(800, maxTime * 0.1) / maxTime;

  return (
    <div className="h-full flex flex-col">
      {/* Time ruler */}
      <div className="h-6 border-b border-strix-border-subtle flex items-end px-2 text-[9px] text-strix-text-muted overflow-hidden">
        {Array.from({ length: Math.ceil(maxTime / 10000) + 1 }, (_, i) => (
          <span
            key={i}
            className="absolute"
            style={{ left: `${i * 10000 * pxPerMs}px` }}
          >
            {i * 10}s
          </span>
        ))}
      </div>

      {/* Events */}
      <div ref={containerRef} className="flex-1 overflow-auto p-2 space-y-1">
        {events.map((event) => {
          const left = event.startTime * pxPerMs;
          const width = event.endTime ? (event.endTime - event.startTime) * pxPerMs : 40;

          return (
            <div key={event.id} className="relative h-6 flex items-center">
              <div
                className={clsx(
                  "absolute h-5 rounded text-[9px] flex items-center gap-1 px-1.5 truncate",
                  event.type === "agent" && "bg-strix-accent/20 text-strix-accent border border-strix-accent/30",
                  event.type === "tool" && event.status === "running" && "bg-blue-500/20 text-blue-400 border border-blue-500/30",
                  event.type === "tool" && event.status !== "running" && "bg-strix-elevated text-strix-text-secondary border border-strix-border-subtle",
                  event.type === "finding" && "bg-severity-critical/20 text-severity-critical border border-severity-critical/30"
                )}
                style={{
                  left: `${left}px`,
                  width: `${Math.max(width, 40)}px`,
                }}
                title={`${event.label} (${(event.startTime / 1000).toFixed(1)}s)`}
              >
                {event.type === "agent" && <Bot size={10} />}
                {event.type === "tool" && <Wrench size={10} />}
                {event.type === "finding" && <ShieldAlert size={10} />}
                <span className="truncate">{event.label}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
