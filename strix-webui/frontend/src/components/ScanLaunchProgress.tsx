import clsx from "clsx";
import { Check, X, Loader2 } from "lucide-react";

export interface PreflightStep {
  step: number;
  totalSteps: number;
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "skipped" | "error";
  detail?: string;
}

interface ScanLaunchProgressProps {
  steps: PreflightStep[];
  error?: string;
}

export default function ScanLaunchProgress({ steps, error }: ScanLaunchProgressProps) {
  // Calculate percentage: done=100%, running=50%, pending/error=0%
  const doneCount = steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  const runningCount = steps.filter((s) => s.status === "running").length;
  const total = steps.length || 3;
  const pct = Math.round(((doneCount * 100 + runningCount * 50) / (total * 100)) * 100);

  // Find the active step's detail text
  const activeStep = steps.find((s) => s.status === "running");
  const errorStep = steps.find((s) => s.status === "error");

  return (
    <div className="bg-strix-card border border-strix-border-subtle rounded-card p-5 animate-slide-up">
      {/* Progress bar */}
      <div className="relative h-2 bg-strix-elevated rounded-full overflow-hidden mb-4">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out"
          style={{
            width: `${pct}%`,
            background: error
              ? "#FF0000"
              : "linear-gradient(90deg, #22C55E, #16A34A)",
          }}
        >
          {!error && pct < 100 && (
            <div className="absolute inset-0 bg-white/20 dark:bg-white/20 animate-pulse" />
          )}
        </div>
      </div>

      {/* Percentage */}
      <div className="flex justify-end mb-4">
        <span className={clsx(
          "text-xs font-mono",
          error ? "text-severity-critical" : "text-strix-text-muted",
        )}>
          {pct}%
        </span>
      </div>

      {/* Step indicators */}
      <div className="flex items-center justify-between mb-2">
        {steps.map((s, i) => (
          <div key={s.id} className="flex items-center flex-1">
            {/* Step circle + label */}
            <div className="flex flex-col items-center gap-1.5 min-w-0">
              <div
                className={clsx(
                  "w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium border-2 transition-all duration-300",
                  s.status === "done" && "bg-strix-accent/20 border-strix-accent text-strix-accent",
                  s.status === "skipped" && "bg-strix-accent/10 border-strix-accent/50 text-strix-accent/60",
                  s.status === "running" && "border-strix-accent text-strix-accent animate-pulse",
                  s.status === "pending" && "border-strix-border text-strix-text-muted",
                  s.status === "error" && "bg-severity-critical/20 border-severity-critical text-severity-critical",
                )}
              >
                {s.status === "done" || s.status === "skipped" ? (
                  <Check size={14} strokeWidth={3} />
                ) : s.status === "error" ? (
                  <X size={14} strokeWidth={3} />
                ) : s.status === "running" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <span>{s.step}</span>
                )}
              </div>
              <span
                className={clsx(
                  "text-xs font-medium whitespace-nowrap",
                  s.status === "done" || s.status === "skipped"
                    ? "text-strix-accent"
                    : s.status === "running"
                    ? "text-strix-text"
                    : s.status === "error"
                    ? "text-severity-critical"
                    : "text-strix-text-muted",
                )}
              >
                {s.label}
              </span>
            </div>

            {/* Connecting line between steps */}
            {i < steps.length - 1 && (
              <div
                className={clsx(
                  "flex-1 h-0.5 mx-3 mt-[-18px] rounded-full transition-all duration-500",
                  steps[i + 1].status === "done" || steps[i + 1].status === "skipped" || steps[i + 1].status === "running"
                    ? "bg-strix-accent/40"
                    : "bg-strix-border-subtle",
                )}
              />
            )}
          </div>
        ))}
      </div>

      {/* Detail text */}
      {(activeStep?.detail || errorStep?.detail) && (
        <div className="text-center mt-3">
          <span className={clsx(
            "text-xs",
            error ? "text-severity-critical" : "text-strix-text-secondary",
          )}>
            {errorStep?.detail || activeStep?.detail}
          </span>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="mt-3 p-3 rounded-btn bg-severity-critical/10 border border-severity-critical/20 text-xs text-severity-critical">
          {error}
        </div>
      )}
    </div>
  );
}
