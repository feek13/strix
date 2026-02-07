import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useScanStore } from "../store/scanStore";
import { Play, Globe, Github, FolderOpen, Zap, Search, Shield, Target, Lock, Workflow, Server } from "lucide-react";
import clsx from "clsx";
import { formatDistanceToNow } from "date-fns";

const modeOptions = [
  { id: "auto", label: "Auto", icon: Zap, desc: "Comprehensive assessment" },
  { id: "recon", label: "Recon", icon: Search, desc: "Reconnaissance only" },
  { id: "injection", label: "Injection", icon: Shield, desc: "Injection testing" },
  { id: "auth", label: "Auth", icon: Lock, desc: "Auth & access control" },
  { id: "logic", label: "Logic", icon: Workflow, desc: "Business logic" },
  { id: "platform", label: "Platform", icon: Server, desc: "Platform-specific" },
  { id: "redteam", label: "Red Team", icon: Target, desc: "Full exploitation" },
];

export default function Dashboard() {
  const navigate = useNavigate();
  const { scans, activeScan } = useScanStore();
  const [target, setTarget] = useState("");
  const [mode, setMode] = useState("auto");
  const [isStarting, setIsStarting] = useState(false);

  const handleStart = async () => {
    if (!target.trim()) return;
    setIsStarting(true);
    try {
      const res = await fetch("/api/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: target.trim(), mode }),
      });
      if (res.ok) {
        const scan = await res.json();
        navigate(`/scan/${scan.id}`);
      }
    } catch (err) {
      console.error("Failed to start scan:", err);
    } finally {
      setIsStarting(false);
    }
  };

  const detectType = (val: string) => {
    if (val.includes("github.com")) return "github";
    if (val.startsWith("/") || val.startsWith("./") || val.startsWith("~")) return "local";
    return "url";
  };

  const targetType = detectType(target);

  return (
    <div className="p-6 max-w-5xl mx-auto animate-fade-in">
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

        <div className="flex gap-3">
          <input
            type="text"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleStart()}
            placeholder="https://example.com, github.com/org/repo, or /path/to/app"
            className="flex-1 bg-strix-elevated border border-strix-border rounded-btn px-4 py-3 text-sm text-white placeholder:text-strix-text-muted focus:outline-none focus:border-strix-accent transition-colors"
          />
          <button
            onClick={handleStart}
            disabled={!target.trim() || isStarting || !!activeScan}
            className={clsx(
              "flex items-center gap-2 px-6 py-3 rounded-btn text-sm font-medium transition-all",
              target.trim() && !isStarting && !activeScan
                ? "bg-strix-accent hover:bg-strix-accent-hover text-black"
                : "bg-strix-elevated text-strix-text-muted cursor-not-allowed"
            )}
          >
            <Play size={16} />
            {isStarting ? "Starting..." : "Start Scan"}
          </button>
        </div>

        {activeScan && (
          <p className="mt-2 text-xs text-severity-medium">
            A scan is already running. Stop it first to start a new one.
          </p>
        )}
      </div>

      {/* Mode Selection */}
      <div className="mb-8">
        <h3 className="text-sm font-medium text-strix-text-secondary mb-3">Testing Mode</h3>
        <div className="grid grid-cols-4 gap-2">
          {modeOptions.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setMode(opt.id)}
              className={clsx(
                "flex flex-col items-center gap-1.5 p-3 rounded-card border text-xs transition-all",
                mode === opt.id
                  ? "border-strix-accent bg-strix-accent/10 text-white"
                  : "border-strix-border-subtle bg-strix-card text-strix-text-secondary hover:border-strix-border"
              )}
            >
              <opt.icon size={18} />
              <span className="font-medium">{opt.label}</span>
              <span className="text-[10px] text-strix-text-muted">{opt.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Recent Scans */}
      {scans.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-strix-text-secondary mb-3">Recent Scans</h3>
          <div className="grid grid-cols-3 gap-3">
            {scans.slice(0, 6).map((scan) => (
              <button
                key={scan.id}
                onClick={() => navigate(`/scan/${scan.id}`)}
                className="bg-strix-card border border-strix-border-subtle rounded-card p-4 text-left hover:border-strix-border transition-colors"
              >
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className={clsx(
                      "w-2 h-2 rounded-full",
                      scan.status === "running" && "bg-strix-accent animate-pulse",
                      scan.status === "completed" && "bg-strix-text-muted",
                      scan.status === "failed" && "bg-severity-critical"
                    )}
                  />
                  <span className="text-xs text-strix-text-muted capitalize">{scan.status}</span>
                </div>
                <div className="text-sm font-medium truncate mb-1">{scan.target}</div>
                <div className="flex items-center justify-between text-xs text-strix-text-muted">
                  <span>{formatDistanceToNow(new Date(scan.createdAt), { addSuffix: true })}</span>
                  {scan.findings > 0 && (
                    <span className="text-severity-high">{scan.findings} findings</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
