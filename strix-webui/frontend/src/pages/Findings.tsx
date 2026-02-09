import { useVulnerabilityStore } from "../store/vulnerabilityStore";
import { useScanStore } from "../store/scanStore";
import { ShieldAlert, ExternalLink } from "lucide-react";
import clsx from "clsx";
import { SEVERITY_CARD_BG, SEVERITY_BADGE, SEVERITY_ORDER } from "../lib/severityStyles";

export default function Findings() {
  const vulns = useVulnerabilityStore((s) => s.vulnerabilities);
  const scan = useScanStore((s) => s.activeScan);

  const sorted = [...vulns].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 5) - (SEVERITY_ORDER[b.severity] ?? 5)
  );

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Findings</h1>
        {scan && (
          <span className="text-xs text-strix-text-muted">
            Target: {scan.target}
          </span>
        )}
      </div>

      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-strix-text-muted">
          <ShieldAlert size={40} className="mb-3 opacity-50" />
          <span className="text-sm">No vulnerabilities found yet</span>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((v) => (
            <div key={v.id} className={clsx("border rounded-card p-5", SEVERITY_CARD_BG[v.severity])}>
              <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className={clsx("text-[10px] px-2 py-1 rounded-btn font-bold uppercase", SEVERITY_BADGE[v.severity])}>
                    {v.severity}
                  </span>
                  <h3 className="font-medium">{v.title}</h3>
                  {v.cvss && (
                    <span className="text-xs text-strix-text-muted border border-strix-border-subtle rounded px-1.5 py-0.5">
                      CVSS {v.cvss}
                    </span>
                  )}
                </div>
                <span className="text-xs text-strix-text-muted">
                  {new Date(v.discoveredAt).toLocaleTimeString()}
                </span>
              </div>

              {v.affectedUrl && (
                <div className="flex items-center gap-1 text-xs text-strix-accent mb-2">
                  <ExternalLink size={12} />
                  {v.affectedUrl}
                </div>
              )}

              {v.description && (
                <p className="text-sm text-strix-text-secondary mb-3 leading-relaxed">{v.description}</p>
              )}

              {v.proofOfConcept && (
                <div className="mb-3">
                  <div className="text-xs text-strix-text-muted mb-1 font-medium">Proof of Concept</div>
                  <pre className="bg-strix-bg border border-strix-border-subtle rounded-btn p-3 text-xs text-strix-text-secondary overflow-x-auto font-mono">
                    {v.proofOfConcept}
                  </pre>
                </div>
              )}

              {v.impact && (
                <div className="mb-3">
                  <div className="text-xs text-strix-text-muted mb-1 font-medium">Impact</div>
                  <p className="text-sm text-strix-text-secondary">{v.impact}</p>
                </div>
              )}

              {v.remediation && (
                <div className="bg-strix-accent/5 border border-strix-accent/20 rounded-btn p-3">
                  <div className="text-xs text-strix-accent mb-1 font-medium">Remediation</div>
                  <p className="text-sm text-strix-text-secondary">{v.remediation}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
