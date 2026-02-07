import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useScanStore } from "../../store/scanStore";
import { useLogStore } from "../../store/logStore";
import { Send, StopCircle, Loader2 } from "lucide-react";
import clsx from "clsx";

export default function ChatInterface() {
  const navigate = useNavigate();
  const activeScan = useScanStore((s) => s.activeScan);
  const logs = useLogStore((s) => s.logs);
  const [input, setInput] = useState("");
  const [isStarting, setIsStarting] = useState(false);

  const handleSubmit = async () => {
    if (!input.trim()) return;

    if (!activeScan) {
      // Start a new scan
      setIsStarting(true);
      try {
        const res = await fetch("/api/scans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target: input.trim(), mode: "auto" }),
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
    }

    setInput("");
  };

  const handleStop = async () => {
    if (!activeScan) return;
    try {
      await fetch(`/api/scans/${activeScan.id}`, { method: "DELETE" });
    } catch (err) {
      console.error("Failed to stop scan:", err);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {!activeScan && logs.length === 0 && (
          <div className="flex items-center justify-center h-full text-strix-text-muted text-sm">
            Enter a target URL to begin scanning
          </div>
        )}

        {logs.map((log) => (
          <div
            key={log.id}
            className={clsx(
              "text-xs px-3 py-1.5 rounded",
              log.level === "success" && "text-strix-accent bg-strix-accent/5",
              log.level === "warning" && "text-severity-medium bg-severity-medium/5",
              log.level === "error" && "text-severity-critical bg-severity-critical/5",
              log.level === "info" && "text-strix-text-secondary",
              log.level === "debug" && "text-strix-text-muted"
            )}
          >
            <span className="text-strix-text-muted mr-2">
              {new Date(log.timestamp).toLocaleTimeString()}
            </span>
            {log.message}
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-strix-border-subtle">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder={activeScan ? "Scan in progress..." : "Enter target URL..."}
            disabled={!!activeScan}
            className="flex-1 bg-strix-elevated border border-strix-border rounded-btn px-3 py-2 text-sm text-white placeholder:text-strix-text-muted focus:outline-none focus:border-strix-accent disabled:opacity-50"
          />
          {activeScan?.status === "running" ? (
            <button
              onClick={handleStop}
              className="p-2 rounded-btn bg-severity-critical/20 text-severity-critical hover:bg-severity-critical/30 transition-colors"
            >
              <StopCircle size={18} />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!input.trim() || isStarting}
              className={clsx(
                "p-2 rounded-btn transition-colors",
                input.trim() && !isStarting
                  ? "bg-strix-accent text-black hover:bg-strix-accent-hover"
                  : "bg-strix-elevated text-strix-text-muted"
              )}
            >
              {isStarting ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
