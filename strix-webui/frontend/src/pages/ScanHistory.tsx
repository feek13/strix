import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useScanStore } from "../store/scanStore";
import { History, Trash2, Loader2, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { formatDistanceToNow, format } from "date-fns";

export default function ScanHistory() {
  const navigate = useNavigate();
  const { scans, setScans } = useScanStore();

  useEffect(() => {
    fetch("/api/scans")
      .then((r) => r.json())
      .then(setScans)
      .catch(() => {});
  }, [setScans]);

  const statusColors: Record<string, string> = {
    running: "text-strix-accent",
    completed: "text-strix-text-muted",
    failed: "text-severity-critical",
    stopped: "text-severity-medium",
    pending: "text-severity-low",
  };

  const statusDots: Record<string, string> = {
    running: "bg-strix-accent animate-pulse",
    completed: "bg-strix-text-muted",
    failed: "bg-severity-critical",
    stopped: "bg-severity-medium",
    pending: "bg-severity-low",
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <History size={20} className="text-strix-text-muted" />
        <h1 className="text-xl font-semibold">Scan History</h1>
        <span className="text-xs text-strix-text-muted bg-strix-elevated px-2 py-0.5 rounded">
          {scans.length} scans
        </span>
      </div>

      {scans.length === 0 ? (
        <div className="text-center py-16 text-strix-text-muted">
          <History size={40} className="mx-auto mb-3 opacity-50" />
          <p className="text-sm">No scans yet. Start one from the Dashboard.</p>
        </div>
      ) : (
        <>
        {/* Desktop: table */}
        <div className="hidden md:block bg-strix-card border border-strix-border-subtle rounded-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-strix-border-subtle text-strix-text-muted text-xs">
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Target</th>
                <th className="text-left px-4 py-3 font-medium">Mode</th>
                <th className="text-left px-4 py-3 font-medium">Findings</th>
                <th className="text-left px-4 py-3 font-medium">Started</th>
                <th className="text-left px-4 py-3 font-medium">Duration</th>
              </tr>
            </thead>
            <tbody>
              {scans.map((scan) => {
                const duration =
                  scan.startedAt && scan.completedAt
                    ? Math.floor(
                        (new Date(scan.completedAt).getTime() - new Date(scan.startedAt).getTime()) / 1000
                      )
                    : null;

                return (
                  <tr
                    key={scan.id}
                    onClick={() => navigate(`/scan/${scan.id}`)}
                    className="border-b border-strix-border-subtle last:border-0 hover:bg-strix-elevated/50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className={clsx("w-2 h-2 rounded-full", statusDots[scan.status])} />
                        <span className={clsx("text-xs capitalize", statusColors[scan.status])}>
                          {scan.status}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-medium truncate max-w-[300px]">{scan.target}</td>
                    <td className="px-4 py-3 text-strix-text-muted capitalize">{scan.mode}</td>
                    <td className="px-4 py-3">
                      {scan.findings > 0 ? (
                        <span className="text-severity-high font-medium">{scan.findings}</span>
                      ) : (
                        <span className="text-strix-text-muted">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-strix-text-muted">
                      {format(new Date(scan.createdAt), "MMM d, HH:mm")}
                    </td>
                    <td className="px-4 py-3 text-strix-text-muted">
                      {duration !== null
                        ? `${Math.floor(duration / 60)}m ${duration % 60}s`
                        : scan.status === "running"
                        ? "..."
                        : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile: cards */}
        <div className="md:hidden space-y-2">
          {scans.map((scan) => {
            const duration =
              scan.startedAt && scan.completedAt
                ? Math.floor(
                    (new Date(scan.completedAt).getTime() - new Date(scan.startedAt).getTime()) / 1000
                  )
                : null;

            return (
              <button
                key={scan.id}
                onClick={() => navigate(`/scan/${scan.id}`)}
                className="w-full text-left bg-strix-card border border-strix-border-subtle rounded-card p-3 transition-colors active:bg-strix-elevated"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <div className={clsx("w-1.5 h-1.5 rounded-full", statusDots[scan.status])} />
                    <span className={clsx("text-xs capitalize", statusColors[scan.status])}>
                      {scan.status}
                    </span>
                    <span className="text-xs text-strix-text-muted capitalize">{scan.mode}</span>
                  </div>
                  <ChevronRight size={14} className="text-strix-text-muted" />
                </div>
                <div className="text-sm font-medium truncate mb-1">{scan.target}</div>
                <div className="flex items-center gap-3 text-xs text-strix-text-muted">
                  <span>{format(new Date(scan.createdAt), "MMM d, HH:mm")}</span>
                  <span>
                    {duration !== null
                      ? `${Math.floor(duration / 60)}m ${duration % 60}s`
                      : scan.status === "running"
                      ? "..."
                      : "-"}
                  </span>
                  {scan.findings > 0 && (
                    <span className="text-severity-high font-medium">{scan.findings} findings</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
        </>
      )}
    </div>
  );
}
