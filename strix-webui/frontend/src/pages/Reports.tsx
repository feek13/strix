import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useScanStore } from "../store/scanStore";
import { FileText, Download, Eye, Loader2, ShieldAlert, ArrowLeft } from "lucide-react";
import clsx from "clsx";
import { formatDistanceToNow } from "date-fns";
import { useIsMobile } from "../hooks/useIsMobile";
import type { Vulnerability, Scan } from "../types";
import { SEVERITY_TEXT, SEVERITY_CARD_BG } from "../lib/severityStyles";
import { ChatMarkdown } from "../components/Chat/ChatMarkdown";
import { API_BASE_URL, IS_TAURI } from "../lib/config";

interface ReportPreview {
  scan: Scan;
  summary: {
    totalFindings: number;
    severityCounts: Record<string, number>;
    totalAgents: number;
    totalTools: number;
    duration: number | null;
  };
  vulnerabilities: Vulnerability[];
}

export default function Reports() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const scans = useScanStore((s) => s.scans);
  const [selectedScanId, setSelectedScanId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ReportPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Load scans from API
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/scans`).then((r) => r.json()).then((data) => {
      useScanStore.getState().setScans(data);
    }).catch(() => {});
  }, []);

  const loadPreview = async (scanId: string) => {
    setSelectedScanId(scanId);
    setLoading(true);
    if (isMobile) setShowPreview(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/scans/${scanId}/report/preview`);
      if (res.ok) {
        setPreview(await res.json());
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const downloadPDF = async () => {
    if (!selectedScanId) return;
    setGenerating(true);
    try {
      if (IS_TAURI && window.__TAURI_INTERNALS__) {
        await window.__TAURI_INTERNALS__.invoke("save_scan_report", {
          scanId: selectedScanId,
        });
        return;
      }
      const res = await fetch(`${API_BASE_URL}/api/scans/${selectedScanId}/report`);
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `strix-report-${selectedScanId.slice(0, 8)}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      // ignore
    } finally {
      setGenerating(false);
    }
  };

  const completedScans = scans.filter((s) => s.status === "completed" || s.status === "stopped");

  const scanListContent = (
    <div className="space-y-2">
      <h3 className="text-xs text-strix-text-muted uppercase tracking-wider mb-2">Select Scan</h3>
      {completedScans.length === 0 && (
        <div className="text-sm text-strix-text-muted py-8 text-center">No completed scans</div>
      )}
      {completedScans.map((scan) => (
        <button
          key={scan.id}
          onClick={() => loadPreview(scan.id)}
          className={clsx(
            "w-full text-left p-3 rounded-card border transition-colors",
            selectedScanId === scan.id
              ? "border-strix-accent bg-strix-accent/5"
              : "border-strix-border-subtle bg-strix-card hover:border-strix-border"
          )}
        >
          <div className="text-sm font-medium truncate">{scan.target}</div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-xs text-strix-text-muted">
              {formatDistanceToNow(new Date(scan.createdAt), { addSuffix: true })}
            </span>
            {scan.findings > 0 && (
              <span className="text-xs text-severity-high">{scan.findings} findings</span>
            )}
          </div>
        </button>
      ))}
    </div>
  );

  const previewContent = (
    <div className="flex-1 min-w-0">
      {!selectedScanId && !isMobile && (
        <div className="flex flex-col items-center justify-center h-64 text-strix-text-muted">
          <FileText size={40} className="mb-3 opacity-50" />
          <span className="text-sm">Select a scan to preview the report</span>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="animate-spin text-strix-text-muted" size={24} />
        </div>
      )}

      {preview && !loading && (
        <div className="space-y-4">
          {/* Actions */}
          <div className="flex items-center gap-3">
            {isMobile && (
              <button
                onClick={() => setShowPreview(false)}
                className="text-strix-text-muted hover:text-strix-text transition-colors shrink-0"
              >
                <ArrowLeft size={18} />
              </button>
            )}
            <button
              onClick={() => navigate(`/scan/${selectedScanId}/report`)}
              className="flex items-center gap-2 px-4 py-2 rounded-btn bg-strix-accent text-strix-text-on-accent text-sm font-medium hover:bg-strix-accent-hover transition-colors"
            >
              <Eye size={16} />
              Preview Report
            </button>
            <button
              onClick={downloadPDF}
              disabled={generating}
              className="flex items-center gap-2 px-4 py-2 rounded-btn bg-strix-elevated text-strix-text-secondary text-sm hover:text-strix-text transition-colors disabled:opacity-50"
            >
              {generating ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
              Download PDF
            </button>
          </div>

          {/* Summary card */}
          <div className="bg-strix-card border border-strix-border-subtle rounded-card p-4">
            <h3 className="text-sm font-medium mb-3">Executive Summary</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-semibold">{preview.summary.totalFindings}</div>
                    <div className="text-xs text-strix-text-muted">Findings</div>
                  </div>
                  <div>
                    <div className="text-2xl font-semibold">{preview.summary.totalAgents}</div>
                    <div className="text-xs text-strix-text-muted">Agents</div>
                  </div>
                  <div>
                    <div className="text-2xl font-semibold">{preview.summary.totalTools}</div>
                    <div className="text-xs text-strix-text-muted">Tool Executions</div>
                  </div>
                  <div>
                    <div className="text-2xl font-semibold">
                      {preview.summary.duration ? `${Math.floor(preview.summary.duration / 60000)}m` : "-"}
                    </div>
                    <div className="text-xs text-strix-text-muted">Duration</div>
                  </div>
                </div>

                {/* Severity bars */}
                <div className="mt-4 space-y-1">
                  {(["critical", "high", "medium", "low", "info"] as const).map((sev) => {
                    const count = preview.summary.severityCounts[sev] || 0;
                    if (count === 0) return null;
                    const colors: Record<string, string> = {
                      critical: "bg-severity-critical",
                      high: "bg-severity-high",
                      medium: "bg-severity-medium",
                      low: "bg-severity-low",
                      info: "bg-strix-text-muted",
                    };
                    return (
                      <div key={sev} className="flex items-center gap-2">
                        <span className="w-16 text-xs text-strix-text-muted capitalize">{sev}</span>
                        <div className="flex-1 h-2 bg-strix-elevated rounded-full overflow-hidden">
                          <div
                            className={clsx("h-full rounded-full", colors[sev])}
                            style={{ width: `${(count / preview.summary.totalFindings) * 100}%` }}
                          />
                        </div>
                        <span className="text-xs text-strix-text-secondary w-6 text-right">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Vulnerability list */}
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Vulnerability Details</h3>
                {preview.vulnerabilities.map((v) => {
                  return (
                    <div key={v.id} className={clsx("border rounded-card p-4", SEVERITY_CARD_BG[v.severity])}>
                      <div className="flex items-center gap-2 mb-2">
                        <ShieldAlert size={16} className={SEVERITY_TEXT[v.severity]} />
                        <span className="font-medium text-sm">{v.title}</span>
                        <span className={clsx("text-[10px] px-1.5 py-0.5 rounded uppercase font-bold", SEVERITY_TEXT[v.severity])}>
                          {v.severity}
                        </span>
                        {v.cvss && <span className="text-xs text-strix-text-muted">CVSS {v.cvss}</span>}
                      </div>
                      {v.description && (
                        <div className="text-strix-text-secondary mb-2">
                          <ChatMarkdown content={v.description} variant="compact" />
                        </div>
                      )}
                      {v.affectedUrl && (
                        <div className="text-xs text-strix-accent mb-1">{v.affectedUrl}</div>
                      )}
                      {v.remediation && (
                        <div className="text-xs text-strix-text-muted mt-2">
                          <span className="font-medium">Remediation:</span>
                          <ChatMarkdown content={v.remediation} variant="compact" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
    </div>
  );

  if (isMobile) {
    return (
      <div className="p-4 max-w-6xl mx-auto animate-fade-in">
        <h1 className="text-xl font-semibold mb-4">Reports</h1>
        {showPreview ? previewContent : scanListContent}
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto animate-fade-in">
      <h1 className="text-xl font-semibold mb-4">Reports</h1>
      <div className="flex gap-6">
        <div className="w-72 shrink-0">{scanListContent}</div>
        {previewContent}
      </div>
    </div>
  );
}
