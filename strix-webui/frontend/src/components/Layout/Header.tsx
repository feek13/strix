import { useScanStore } from "../../store/scanStore";
import { useVulnerabilityStore } from "../../store/vulnerabilityStore";
import { Wifi, WifiOff, Loader2, Shield, Clock, Menu } from "lucide-react";
import clsx from "clsx";
import { formatDistanceToNow } from "date-fns";
import type { ConnectionStatus } from "../../hooks/useWebSocket";

interface HeaderProps {
  connectionStatus: ConnectionStatus;
  showMenu?: boolean;
  onMenuClick?: () => void;
}

export default function Header({ connectionStatus, showMenu, onMenuClick }: HeaderProps) {
  const activeScan = useScanStore((s) => s.activeScan);
  const vulns = useVulnerabilityStore((s) => s.vulnerabilities);

  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const v of vulns) severityCounts[v.severity]++;

  return (
    <header className="h-12 bg-strix-card border-b border-strix-border-subtle flex items-center justify-between px-4">
      {/* Left: Menu button + Scan info */}
      <div className="flex items-center gap-3">
        {showMenu && (
          <button
            onClick={onMenuClick}
            className="p-1.5 -ml-1 text-strix-text-secondary hover:text-strix-text transition-colors"
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
        )}
        {activeScan ? (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div
                className={clsx(
                  "w-2 h-2 rounded-full",
                  activeScan.status === "running" && "bg-strix-accent animate-pulse",
                  activeScan.status === "completed" && "bg-strix-text-muted",
                  activeScan.status === "failed" && "bg-severity-critical",
                  activeScan.status === "stopped" && "bg-severity-medium"
                )}
              />
              <span className="text-sm font-medium truncate max-w-[120px] sm:max-w-none">{activeScan.target}</span>
              <span className="text-xs text-strix-text-muted capitalize hidden sm:inline">{activeScan.status}</span>
            </div>
            {activeScan.startedAt && (
              <div className="flex items-center gap-1 text-xs text-strix-text-muted hidden sm:flex">
                <Clock size={12} />
                {formatDistanceToNow(new Date(activeScan.startedAt), { addSuffix: false })}
              </div>
            )}
          </div>
        ) : (
          <span className="text-sm text-strix-text-muted">No active scan</span>
        )}
      </div>

      {/* Center: Severity badges */}
      {vulns.length > 0 && (
        <div className="hidden md:flex items-center gap-2">
          <Shield size={14} className="text-strix-text-muted" />
          {severityCounts.critical > 0 && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-severity-critical/20 text-severity-critical font-medium">
              {severityCounts.critical} Critical
            </span>
          )}
          {severityCounts.high > 0 && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-severity-high/20 text-severity-high font-medium">
              {severityCounts.high} High
            </span>
          )}
          {severityCounts.medium > 0 && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-severity-medium/20 text-severity-medium font-medium">
              {severityCounts.medium} Med
            </span>
          )}
          {(severityCounts.low > 0 || severityCounts.info > 0) && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-strix-elevated text-strix-text-muted font-medium">
              {severityCounts.low + severityCounts.info} Low/Info
            </span>
          )}
        </div>
      )}

      {/* Right: Connection status */}
      <div className="flex items-center gap-2">
        <div
          className={clsx(
            "flex items-center gap-1.5 px-2 py-1 rounded-btn text-xs",
            connectionStatus === "connected" && "text-strix-accent",
            connectionStatus === "disconnected" && "text-severity-critical",
            connectionStatus === "connecting" && "text-severity-medium"
          )}
        >
          {connectionStatus === "connected" && <Wifi size={12} />}
          {connectionStatus === "disconnected" && <WifiOff size={12} />}
          {connectionStatus === "connecting" && <Loader2 size={12} className="animate-spin" />}
          <span className="capitalize hidden sm:inline">{connectionStatus}</span>
        </div>
      </div>
    </header>
  );
}
