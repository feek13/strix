import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useScanStore } from "../store/scanStore";
import {
  Play, Globe, Github, FolderOpen, Zap, Search, Shield, Target,
  Lock, Workflow, Server, Layers, History, ExternalLink, ChevronRight,
} from "lucide-react";
import clsx from "clsx";
import { format } from "date-fns";
import ScanLaunchProgress, { type PreflightStep } from "../components/ScanLaunchProgress";
import { STATUS_DOT, STATUS_TEXT } from "../lib/statusStyles";
import { API_BASE_URL } from "../lib/config";

const modeOptions = [
  { id: "auto", label: "Auto", icon: Zap, desc: "Comprehensive assessment" },
  { id: "deep", label: "Deep", icon: Layers, desc: "Multi-agent deep scan" },
  { id: "recon", label: "Recon", icon: Search, desc: "Reconnaissance only" },
  { id: "injection", label: "Injection", icon: Shield, desc: "Injection testing" },
  { id: "auth", label: "Auth", icon: Lock, desc: "Auth & access control" },
  { id: "logic", label: "Logic", icon: Workflow, desc: "Business logic" },
  { id: "platform", label: "Platform", icon: Server, desc: "Platform-specific" },
  { id: "redteam", label: "Red Team", icon: Target, desc: "Full exploitation" },
];

const INITIAL_STEPS: PreflightStep[] = [
  { step: 1, totalSteps: 3, id: "docker", label: "Docker Engine", status: "pending" },
  { step: 2, totalSteps: 3, id: "image", label: "Sandbox Image", status: "pending" },
  { step: 3, totalSteps: 3, id: "launch", label: "Launching Scan", status: "pending" },
];

function formatDuration(startedAt: string | null, completedAt: string | null, status: string): string {
  if (!startedAt) return "-";
  const end = completedAt ? new Date(completedAt).getTime() : (status === "running" ? Date.now() : 0);
  if (!end) return "-";
  const sec = Math.floor((end - new Date(startedAt).getTime()) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return `${min}m ${rem}s`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { scans, setScans } = useScanStore();
  const [target, setTarget] = useState("");
  const [mode, setMode] = useState("auto");
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const [preflightSteps, setPreflightSteps] = useState<PreflightStep[]>([]);

  // Fetch scan history on mount
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/scans`)
      .then((r) => r.json())
      .then(setScans)
      .catch(() => {});
  }, [setScans]);

  const handleStart = useCallback(async () => {
    if (!target.trim() || isStarting) return;
    setIsStarting(true);
    setStartError("");
    setPreflightSteps(INITIAL_STEPS.map((s) => ({ ...s })));

    try {
      const res = await fetch(`${API_BASE_URL}/api/scans/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: target.trim(), mode }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Unknown error" }));
        setStartError(data.error || `Failed to start scan (${res.status})`);
        setIsStarting(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setStartError("Failed to read response stream");
        setIsStarting(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let lastTransitionAt = 0;
      const stepStatuses: Record<string, string> = {};

      // Ensure minimum visual delay between step transitions so animation is visible
      const ensureStepDelay = async (minMs: number) => {
        if (lastTransitionAt > 0) {
          const elapsed = Date.now() - lastTransitionAt;
          if (elapsed < minMs) {
            await new Promise((r) => setTimeout(r, minMs - elapsed));
          }
        }
        lastTransitionAt = Date.now();
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") continue;
          if (!payload) continue;

          try {
            const event = JSON.parse(payload);

            if (event.type === "step") {
              const prev = stepStatuses[event.id];
              if (prev !== event.status) {
                // New state transition — enforce minimum visual duration
                // "running": 100ms gap after previous done (brief pause)
                // "done"/"skipped": 350ms so spinner is visible to the user
                await ensureStepDelay(event.status === "running" ? 100 : 350);
                stepStatuses[event.id] = event.status;
              }
              setPreflightSteps((prev) =>
                prev.map((s) =>
                  s.id === event.id
                    ? { ...s, status: event.status, detail: event.detail }
                    : s
                )
              );
            } else if (event.type === "complete" && event.scan) {
              // Let last step animation be visible before navigating
              await ensureStepDelay(300);
              navigate(`/scan/${event.scan.id}`);
              return;
            } else if (event.type === "error") {
              setStartError(event.error || "An unknown error occurred");
              setPreflightSteps((prev) =>
                prev.map((s) =>
                  s.status === "running"
                    ? { ...s, status: "error", detail: event.error }
                    : s
                )
              );
            }
          } catch {
            // Incomplete JSON, skip
          }
        }
      }
    } catch (err) {
      console.error("Failed to start scan:", err);
      setStartError("Failed to connect to backend. Is the server running?");
    } finally {
      setIsStarting(false);
    }
  }, [target, mode, isStarting, navigate]);

  const detectType = (val: string) => {
    if (val.includes("github.com")) return "github";
    if (val.startsWith("/") || val.startsWith("./") || val.startsWith("~")) return "local";
    return "url";
  };

  const targetType = detectType(target);

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto animate-fade-in">
      {/* Hero */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold mb-1">Security Assessment</h1>
        <p className="text-strix-text-secondary text-sm">
          Enter a target to begin autonomous penetration testing
        </p>
      </div>

      {/* Target Input Card */}
      <div className="bg-strix-card border border-strix-border-subtle rounded-card p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center gap-2 text-xs text-strix-text-muted">
            {targetType === "url" && <Globe size={14} className="text-strix-accent" />}
            {targetType === "github" && <Github size={14} className="text-strix-accent" />}
            {targetType === "local" && <FolderOpen size={14} className="text-strix-accent" />}
            <span className="capitalize">{targetType}</span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleStart()}
            placeholder="https://example.com, github.com/org/repo, or /path/to/app"
            className="flex-1 bg-strix-elevated border border-strix-border rounded-btn px-4 py-3 text-sm text-strix-text placeholder:text-strix-text-muted focus:outline-none focus:border-strix-accent transition-colors"
            disabled={isStarting}
          />
          <button
            onClick={handleStart}
            disabled={!target.trim() || isStarting}
            className={clsx(
              "flex items-center justify-center gap-2 px-6 py-3 rounded-btn text-sm font-medium transition-all",
              target.trim() && !isStarting
                ? "bg-strix-accent hover:bg-strix-accent-hover text-strix-text-on-accent"
                : "bg-strix-elevated text-strix-text-muted cursor-not-allowed"
            )}
          >
            <Play size={16} />
            {isStarting ? "Starting..." : "Start Scan"}
          </button>
        </div>

        {/* Error without progress bar (pre-SSE errors like network failure) */}
        {startError && preflightSteps.length === 0 && (
          <div className="mt-3 flex items-start gap-2 p-3 rounded-btn bg-severity-critical/10 border border-severity-critical/20 text-sm text-severity-critical">
            <Shield size={16} className="shrink-0 mt-0.5" />
            <span>{startError}</span>
          </div>
        )}
      </div>

      {/* Scan Launch Progress Bar */}
      {preflightSteps.length > 0 && isStarting && (
        <div className="mb-6">
          <ScanLaunchProgress steps={preflightSteps} error={startError || undefined} />
        </div>
      )}

      {/* Error state: show progress bar with error even after isStarting is false */}
      {preflightSteps.length > 0 && !isStarting && startError && (
        <div className="mb-6">
          <ScanLaunchProgress steps={preflightSteps} error={startError} />
        </div>
      )}

      {/* Mode Selection */}
      <div className="mb-8">
        <h3 className="text-sm font-medium text-strix-text-secondary mb-3">Testing Mode</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {modeOptions.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setMode(opt.id)}
              disabled={isStarting}
              className={clsx(
                "flex flex-col items-center gap-1.5 p-3 rounded-card border text-xs transition-all",
                mode === opt.id
                  ? "border-strix-accent bg-strix-accent/10 text-strix-text"
                  : "border-strix-border-subtle bg-strix-card text-strix-text-secondary hover:border-strix-border",
                isStarting && "opacity-50 cursor-not-allowed"
              )}
            >
              <opt.icon size={18} />
              <span className="font-medium">{opt.label}</span>
              <span className="text-[10px] text-strix-text-muted">{opt.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Scan History */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <History size={14} className="text-strix-text-muted" />
            <h3 className="text-sm font-medium text-strix-text-secondary">Scan History</h3>
            {scans.length > 0 && (
              <span className="text-[10px] text-strix-text-muted bg-strix-elevated px-1.5 py-0.5 rounded">
                {scans.length}
              </span>
            )}
          </div>
          {scans.length > 0 && (
            <button
              onClick={() => navigate("/history")}
              className="text-xs text-strix-text-muted hover:text-strix-text-secondary transition-colors flex items-center gap-1"
            >
              View all
              <ExternalLink size={10} />
            </button>
          )}
        </div>

        {scans.length === 0 ? (
          <div className="bg-strix-card border border-strix-border-subtle rounded-card py-12 text-center">
            <History size={28} className="mx-auto mb-2 text-strix-text-muted opacity-40" />
            <p className="text-xs text-strix-text-muted">No scans yet</p>
          </div>
        ) : (
          <>
          {/* Desktop: table */}
          <div className="hidden md:block bg-strix-card border border-strix-border-subtle rounded-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-strix-border-subtle text-strix-text-muted text-xs">
                  <th className="text-left px-4 py-2.5 font-medium">Status</th>
                  <th className="text-left px-4 py-2.5 font-medium">Target</th>
                  <th className="text-left px-4 py-2.5 font-medium">Mode</th>
                  <th className="text-left px-4 py-2.5 font-medium">Findings</th>
                  <th className="text-left px-4 py-2.5 font-medium">Started</th>
                  <th className="text-left px-4 py-2.5 font-medium">Duration</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {scans.slice(0, 10).map((scan) => (
                  <tr
                    key={scan.id}
                    onClick={() => navigate(`/scan/${scan.id}`)}
                    className="border-b border-strix-border-subtle last:border-0 hover:bg-strix-elevated/50 cursor-pointer transition-colors group"
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className={clsx("w-1.5 h-1.5 rounded-full", STATUS_DOT[scan.status])} />
                        <span className={clsx("text-xs capitalize", STATUS_TEXT[scan.status])}>
                          {scan.status}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="font-medium truncate block max-w-[260px]" title={scan.target}>
                        {scan.target}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-strix-text-muted capitalize text-xs">
                      {scan.mode}
                    </td>
                    <td className="px-4 py-2.5">
                      {scan.findings > 0 ? (
                        <span className="text-severity-high font-medium text-xs">{scan.findings}</span>
                      ) : (
                        <span className="text-strix-text-muted text-xs">0</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-strix-text-muted text-xs">
                      {format(new Date(scan.createdAt), "MMM d, HH:mm")}
                    </td>
                    <td className="px-4 py-2.5 text-strix-text-muted text-xs">
                      {formatDuration(scan.startedAt, scan.completedAt, scan.status)}
                    </td>
                    <td className="px-2 py-2.5">
                      <ChevronRight
                        size={14}
                        className="text-strix-text-muted opacity-0 group-hover:opacity-100 transition-opacity"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: cards */}
          <div className="md:hidden space-y-2">
            {scans.slice(0, 10).map((scan) => (
              <button
                key={scan.id}
                onClick={() => navigate(`/scan/${scan.id}`)}
                className="w-full text-left bg-strix-card border border-strix-border-subtle rounded-card p-3 transition-colors active:bg-strix-elevated"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <div className={clsx("w-1.5 h-1.5 rounded-full", STATUS_DOT[scan.status])} />
                    <span className={clsx("text-xs capitalize", STATUS_TEXT[scan.status])}>
                      {scan.status}
                    </span>
                    <span className="text-xs text-strix-text-muted capitalize">{scan.mode}</span>
                  </div>
                  <ChevronRight size={14} className="text-strix-text-muted" />
                </div>
                <div className="text-sm font-medium truncate mb-1">{scan.target}</div>
                <div className="flex items-center gap-3 text-xs text-strix-text-muted">
                  <span>{format(new Date(scan.createdAt), "MMM d, HH:mm")}</span>
                  <span>{formatDuration(scan.startedAt, scan.completedAt, scan.status)}</span>
                  {scan.findings > 0 && (
                    <span className="text-severity-high font-medium">{scan.findings} findings</span>
                  )}
                </div>
              </button>
            ))}
          </div>
          </>
        )}
      </div>
    </div>
  );
}
