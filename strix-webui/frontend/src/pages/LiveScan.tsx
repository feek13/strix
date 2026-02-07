import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useScanStore } from "../store/scanStore";
import ChatInterface from "../components/Chat/ChatInterface";
import NetworkTopology from "../components/Visualization/NetworkTopology";
import Timeline from "../components/Visualization/Timeline";
import TerminalLog from "../components/Logs/TerminalLog";
import { useVulnerabilityStore } from "../store/vulnerabilityStore";
import { useWebSocket } from "../hooks/useWebSocket";
import clsx from "clsx";
import { Network, Clock, ShieldAlert } from "lucide-react";

type ViewTab = "topology" | "timeline";

export default function LiveScan() {
  const { id } = useParams();
  const { send } = useWebSocket();
  const activeScan = useScanStore((s) => s.activeScan);
  const vulns = useVulnerabilityStore((s) => s.vulnerabilities);
  const [viewTab, setViewTab] = useState<ViewTab>("topology");

  // Subscribe to specific scan if navigated directly
  useEffect(() => {
    if (id && id !== activeScan?.id) {
      send({ type: "SUBSCRIBE_SCAN", payload: { scanId: id } });
    }
  }, [id, activeScan?.id, send]);

  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const v of vulns) severityCounts[v.severity]++;

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* Scan header bar */}
      {activeScan && (
        <div className="h-10 bg-strix-card border-b border-strix-border-subtle flex items-center px-4 gap-4 shrink-0">
          <div className="flex items-center gap-2">
            <div
              className={clsx(
                "w-2 h-2 rounded-full",
                activeScan.status === "running" && "bg-strix-accent animate-pulse",
                activeScan.status === "completed" && "bg-strix-text-muted",
                activeScan.status === "failed" && "bg-severity-critical"
              )}
            />
            <span className="text-sm font-medium">{activeScan.target}</span>
          </div>
          <span className="text-xs text-strix-text-muted capitalize">{activeScan.mode} mode</span>
        </div>
      )}

      {/* Main 3-pane layout */}
      <div className="flex-1 flex min-h-0">
        {/* Left: Chat */}
        <div className="w-72 border-r border-strix-border-subtle flex flex-col shrink-0">
          <ChatInterface />
        </div>

        {/* Right: Visualization + Terminal */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Tab bar */}
          <div className="h-9 bg-strix-card border-b border-strix-border-subtle flex items-center px-2 gap-1 shrink-0">
            <button
              onClick={() => setViewTab("topology")}
              className={clsx(
                "flex items-center gap-1.5 px-3 py-1 rounded-btn text-xs transition-colors",
                viewTab === "topology"
                  ? "bg-strix-elevated text-white"
                  : "text-strix-text-muted hover:text-strix-text-secondary"
              )}
            >
              <Network size={12} />
              Attack Flow
            </button>
            <button
              onClick={() => setViewTab("timeline")}
              className={clsx(
                "flex items-center gap-1.5 px-3 py-1 rounded-btn text-xs transition-colors",
                viewTab === "timeline"
                  ? "bg-strix-elevated text-white"
                  : "text-strix-text-muted hover:text-strix-text-secondary"
              )}
            >
              <Clock size={12} />
              Timeline
            </button>
          </div>

          {/* Visualization area */}
          <div className="flex-1 min-h-0">
            {viewTab === "topology" ? <NetworkTopology /> : <Timeline />}
          </div>

          {/* Terminal log */}
          <div className="h-64 border-t border-strix-border-subtle relative shrink-0">
            <TerminalLog />
          </div>
        </div>
      </div>

      {/* Findings bar */}
      {vulns.length > 0 && (
        <div className="h-8 bg-strix-card border-t border-strix-border-subtle flex items-center px-4 gap-3 shrink-0">
          <ShieldAlert size={14} className="text-strix-text-muted" />
          <span className="text-xs text-strix-text-muted">{vulns.length} findings</span>
          <div className="flex gap-2">
            {severityCounts.critical > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-severity-critical/20 text-severity-critical">
                {severityCounts.critical} CRIT
              </span>
            )}
            {severityCounts.high > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-severity-high/20 text-severity-high">
                {severityCounts.high} HIGH
              </span>
            )}
            {severityCounts.medium > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-severity-medium/20 text-severity-medium">
                {severityCounts.medium} MED
              </span>
            )}
            {(severityCounts.low + severityCounts.info) > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-strix-elevated text-strix-text-muted">
                {severityCounts.low + severityCounts.info} LOW
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
