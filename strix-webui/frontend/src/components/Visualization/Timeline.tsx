import { useMemo, useRef, useEffect, useState } from "react";
import { useToolStore } from "../../store/toolStore";
import { useAgentStore } from "../../store/agentStore";
import { useVulnerabilityStore } from "../../store/vulnerabilityStore";
import { useScanStore } from "../../store/scanStore";
import clsx from "clsx";
import { Wrench, ShieldAlert } from "lucide-react";
import { StrixIcon } from "../ui/StrixIcon";

interface TimelineEvent {
  id: string;
  type: "tool" | "finding";
  label: string;
  startTime: number; // ms from scan start
  endTime?: number;
  agentId?: string;
  status?: string;
  severity?: string;
}

interface Lane {
  agentId: string;
  agentName: string;
  agentStatus?: string;
  agentStart: number;
  agentEnd?: number;
  events: TimelineEvent[];
}

const MIN_BAR_WIDTH = 60;
const ROW_HEIGHT = 24;
const LANE_HEADER_HEIGHT = 22;
const LANE_GAP = 8;
const LEFT_GUTTER = 8;

export default function Timeline() {
  const scan = useScanStore((s) => s.activeScan);
  const agents = useAgentStore((s) => s.agents);
  const tools = useToolStore((s) => s.tools);
  const vulns = useVulnerabilityStore((s) => s.vulnerabilities);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);

  // Measure container width for scale calculation
  useEffect(() => {
    if (!scrollRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(scrollRef.current);
    return () => ro.disconnect();
  }, []);

  const { lanes, findings, maxTime, nowTime } = useMemo(() => {
    if (!scan?.startedAt)
      return { lanes: [] as Lane[], findings: [] as TimelineEvent[], maxTime: 1000, nowTime: 0 };

    const scanStart = new Date(scan.startedAt).getTime();
    const now = Date.now() - scanStart;

    // Build lanes grouped by agent
    const laneMap = new Map<string, Lane>();

    // Create a lane per agent
    Array.from(agents.values()).forEach((a) => {
      laneMap.set(a.id, {
        agentId: a.id,
        agentName: a.name,
        agentStatus: a.status,
        agentStart: new Date(a.createdAt).getTime() - scanStart,
        agentEnd: a.finishedAt
          ? new Date(a.finishedAt).getTime() - scanStart
          : undefined,
        events: [],
      });
    });

    // Group tools into their agent's lane
    Array.from(tools.values()).forEach((t) => {
      const agentId = t.agentId || "root";
      if (!laneMap.has(agentId)) {
        // Root agent or unknown — create a lane
        laneMap.set(agentId, {
          agentId,
          agentName: "Root Agent",
          agentStart: 0,
          events: [],
        });
      }
      laneMap.get(agentId)!.events.push({
        id: t.id,
        type: "tool",
        label: t.toolName,
        startTime: new Date(t.startedAt).getTime() - scanStart,
        endTime: t.completedAt
          ? new Date(t.completedAt).getTime() - scanStart
          : undefined,
        agentId: t.agentId,
        status: t.status,
      });
    });

    // Findings as separate events
    const findingEvents: TimelineEvent[] = vulns.map((v) => ({
      id: v.id,
      type: "finding" as const,
      label: v.title,
      startTime: new Date(v.discoveredAt).getTime() - scanStart,
      severity: v.severity,
    }));

    // Sort events within each lane and filter empty lanes
    const sortedLanes = Array.from(laneMap.values())
      .filter((l) => l.events.length > 0)
      .map((l) => ({
        ...l,
        events: l.events.sort((a, b) => a.startTime - b.startTime),
      }))
      .sort((a, b) => a.agentStart - b.agentStart);

    // Compute max time
    let mt = 1000;
    sortedLanes.forEach((l) => {
      l.events.forEach((e) => {
        mt = Math.max(mt, e.endTime || e.startTime);
      });
      mt = Math.max(mt, l.agentEnd || l.agentStart);
    });
    findingEvents.forEach((e) => {
      mt = Math.max(mt, e.startTime);
    });
    if (scan.status === "running") {
      mt = Math.max(mt, now);
    }

    return { lanes: sortedLanes, findings: findingEvents, maxTime: mt, nowTime: now };
  }, [scan, agents, tools, vulns]);

  // Auto-scroll to right edge
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [lanes, findings]);

  if (!scan) {
    return (
      <div className="flex items-center justify-center h-full text-strix-text-muted text-sm">
        Start a scan to see the timeline
      </div>
    );
  }

  if (lanes.length === 0 && findings.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-strix-text-muted text-sm">
        Waiting for events...
      </div>
    );
  }

  // Scale: at least fill container, or wider for long scans (min ~80px per second)
  const pxPerMs = Math.max(0.08, containerWidth / maxTime);
  const totalWidth = Math.max(containerWidth, maxTime * pxPerMs + 80);

  // Ruler tick intervals (adaptive)
  const intervalMs =
    maxTime < 30_000 ? 5_000 : maxTime < 120_000 ? 10_000 : 30_000;
  const rulerTicks: number[] = [];
  for (let t = 0; t <= maxTime; t += intervalMs) {
    rulerTicks.push(t);
  }

  const formatTime = (ms: number) =>
    ms < 60_000 ? `${(ms / 1000).toFixed(0)}s` : `${(ms / 60_000).toFixed(1)}m`;

  return (
    <div className="h-full flex flex-col">
      <div ref={scrollRef} className="flex-1 overflow-auto">
        <div style={{ minWidth: `${totalWidth}px`, position: "relative" }}>
          {/* Time ruler — sticky at top */}
          <div
            className="sticky top-0 z-10 h-6 border-b border-strix-border-subtle bg-strix-bg"
            style={{ minWidth: `${totalWidth}px` }}
          >
            <div className="relative h-full">
              {rulerTicks.map((ms) => (
                <div
                  key={ms}
                  className="absolute top-0 h-full"
                  style={{ left: `${LEFT_GUTTER + ms * pxPerMs}px` }}
                >
                  <div className="w-px h-2.5 bg-strix-border-subtle" />
                  <span className="text-[9px] text-strix-text-muted ml-1 select-none">
                    {formatTime(ms)}
                  </span>
                </div>
              ))}
              {/* "Now" marker for running scans */}
              {scan.status === "running" && (
                <div
                  className="absolute top-0 h-full w-px bg-strix-accent/60"
                  style={{ left: `${LEFT_GUTTER + nowTime * pxPerMs}px` }}
                />
              )}
            </div>
          </div>

          {/* Vertical grid lines behind content */}
          <div className="absolute inset-0 top-6 pointer-events-none">
            {rulerTicks.map((ms) => (
              <div
                key={ms}
                className="absolute top-0 bottom-0 w-px bg-strix-border-subtle/20"
                style={{ left: `${LEFT_GUTTER + ms * pxPerMs}px` }}
              />
            ))}
          </div>

          {/* Swim lanes */}
          <div className="relative py-1">
            {lanes.map((lane) => (
              <div key={lane.agentId} style={{ marginBottom: `${LANE_GAP}px` }}>
                {/* Agent lane header bar */}
                <div
                  className="relative flex items-center"
                  style={{ height: `${LANE_HEADER_HEIGHT}px` }}
                >
                  {/* Agent span bar */}
                  <div
                    className={clsx(
                      "absolute h-4 rounded-sm flex items-center gap-1 px-1.5",
                      "bg-strix-accent/10 border border-strix-accent/20"
                    )}
                    style={{
                      left: `${LEFT_GUTTER + lane.agentStart * pxPerMs}px`,
                      width: `${Math.max(
                        ((lane.agentEnd || (scan.status === "running" ? nowTime : maxTime)) - lane.agentStart) * pxPerMs,
                        120
                      )}px`,
                    }}
                  >
                    <StrixIcon size={10} className="shrink-0 text-strix-accent" />
                    <span className="text-[10px] text-strix-accent font-medium truncate">
                      {lane.agentName}
                    </span>
                    <span className="text-[9px] text-strix-text-muted ml-auto shrink-0">
                      {lane.events.length} tools
                    </span>
                  </div>
                </div>

                {/* Tool event bars */}
                {lane.events.map((event) => {
                  const left = LEFT_GUTTER + event.startTime * pxPerMs;
                  const rawWidth = event.endTime
                    ? (event.endTime - event.startTime) * pxPerMs
                    : MIN_BAR_WIDTH;
                  const width = Math.max(rawWidth, MIN_BAR_WIDTH);

                  return (
                    <div
                      key={event.id}
                      className="relative flex items-center"
                      style={{ height: `${ROW_HEIGHT}px` }}
                    >
                      <div
                        className={clsx(
                          "absolute h-5 rounded text-[9px] flex items-center gap-1 px-1.5 truncate",
                          event.status === "running"
                            ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                            : event.status === "error"
                              ? "bg-red-500/15 text-red-400 border border-red-500/25"
                              : "bg-strix-elevated text-strix-text-secondary border border-strix-border-subtle"
                        )}
                        style={{ left: `${left}px`, width: `${width}px` }}
                        title={`${event.label} (${formatTime(event.startTime)}${event.endTime ? ` → ${formatTime(event.endTime)}` : " running..."})`}
                      >
                        <Wrench size={10} className="shrink-0" />
                        <span className="truncate">{event.label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}

            {/* Findings lane */}
            {findings.length > 0 && (
              <div style={{ marginBottom: `${LANE_GAP}px` }}>
                <div
                  className="flex items-center gap-1.5 px-2"
                  style={{ height: `${LANE_HEADER_HEIGHT}px` }}
                >
                  <ShieldAlert size={10} className="text-severity-critical" />
                  <span className="text-[10px] text-severity-critical font-medium">
                    Findings
                  </span>
                  <span className="text-[9px] text-strix-text-muted">
                    ({findings.length})
                  </span>
                </div>
                {findings.map((f) => (
                  <div
                    key={f.id}
                    className="relative flex items-center"
                    style={{ height: `${ROW_HEIGHT}px` }}
                  >
                    <div
                      className="absolute h-5 rounded text-[9px] flex items-center gap-1 px-1.5 truncate bg-severity-critical/20 text-severity-critical border border-severity-critical/30"
                      style={{
                        left: `${LEFT_GUTTER + f.startTime * pxPerMs}px`,
                        width: `${MIN_BAR_WIDTH * 3}px`,
                      }}
                      title={`${f.label} (${formatTime(f.startTime)})`}
                    >
                      <ShieldAlert size={10} className="shrink-0" />
                      <span className="truncate">{f.label}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
