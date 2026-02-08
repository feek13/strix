import { useState, useCallback, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { X, Download, Loader2, FileText, FileType, FileDown } from "lucide-react";
import clsx from "clsx";
import * as chatApi from "../lib/chatApi";

type TabId = "markdown" | "pdf" | "docx";

interface ExportPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  sessionTitle: string;
  markdownContent: string;
}

export default function ExportPreviewModal({
  isOpen,
  onClose,
  sessionId,
  sessionTitle,
  markdownContent,
}: ExportPreviewModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>("markdown");
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [docxBlob, setDocxBlob] = useState<Blob | null>(null);
  const [docxLoading, setDocxLoading] = useState(false);
  const [docxError, setDocxError] = useState<string | null>(null);
  const pdfUrlRef = useRef<string | null>(null);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
    };
  }, []);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      if (pdfUrlRef.current) {
        URL.revokeObjectURL(pdfUrlRef.current);
        pdfUrlRef.current = null;
      }
      setPdfBlobUrl(null);
      setPdfLoading(false);
      setPdfError(null);
      setDocxBlob(null);
      setDocxLoading(false);
      setDocxError(null);
      setActiveTab("markdown");
    }
  }, [isOpen]);

  const fetchPdf = useCallback(async () => {
    if (pdfBlobUrl || pdfLoading) return;
    setPdfLoading(true);
    setPdfError(null);
    try {
      const blob = await chatApi.exportSessionPDF(sessionId);
      const url = URL.createObjectURL(blob);
      pdfUrlRef.current = url;
      setPdfBlobUrl(url);
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : "Failed to load PDF");
    } finally {
      setPdfLoading(false);
    }
  }, [sessionId, pdfBlobUrl, pdfLoading]);

  const fetchDocx = useCallback(async () => {
    if (docxBlob || docxLoading) return;
    setDocxLoading(true);
    setDocxError(null);
    try {
      const blob = await chatApi.exportSessionDOCX(sessionId);
      setDocxBlob(blob);
    } catch (e) {
      setDocxError(e instanceof Error ? e.message : "Failed to load DOCX");
    } finally {
      setDocxLoading(false);
    }
  }, [sessionId, docxBlob, docxLoading]);

  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab);
    if (tab === "pdf" && !pdfBlobUrl && !pdfLoading) fetchPdf();
    if (tab === "docx" && !docxBlob && !docxLoading) fetchDocx();
  };

  const handleDownload = () => {
    const slug = sessionTitle.replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 40).toLowerCase();
    if (activeTab === "markdown") {
      const blob = new Blob([markdownContent], { type: "text/markdown" });
      downloadBlob(blob, `chat-${slug}.md`);
    } else if (activeTab === "pdf" && pdfBlobUrl) {
      const a = document.createElement("a");
      a.href = pdfBlobUrl;
      a.download = `chat-${slug}.pdf`;
      a.click();
    } else if (activeTab === "docx" && docxBlob) {
      downloadBlob(docxBlob, `chat-${slug}.docx`);
    }
  };

  if (!isOpen) return null;

  const tabs: { id: TabId; label: string; icon: typeof FileText }[] = [
    { id: "markdown", label: "Markdown", icon: FileText },
    { id: "pdf", label: "PDF", icon: FileType },
    { id: "docx", label: "DOCX", icon: FileDown },
  ];

  const canDownload =
    (activeTab === "markdown") ||
    (activeTab === "pdf" && !!pdfBlobUrl) ||
    (activeTab === "docx" && !!docxBlob);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-strix-card border border-strix-border-subtle rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-strix-border-subtle shrink-0">
          <h2 className="text-sm font-semibold text-white">Export Chat</h2>
          <button
            onClick={onClose}
            className="text-strix-text-muted hover:text-white transition-colors p-1 rounded hover:bg-strix-elevated"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-5 pt-3 shrink-0">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => handleTabChange(id)}
              className={clsx(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                activeTab === id
                  ? "bg-strix-accent/15 text-strix-accent"
                  : "text-strix-text-muted hover:text-white hover:bg-strix-elevated"
              )}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden px-5 py-3 min-h-0">
          {activeTab === "markdown" && (
            <div className="h-full overflow-y-auto bg-strix-bg border border-strix-border-subtle rounded-lg p-5">
              <div className="prose prose-invert prose-sm max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdownContent}</ReactMarkdown>
              </div>
            </div>
          )}

          {activeTab === "pdf" && (
            <div className="h-full flex items-center justify-center bg-strix-bg border border-strix-border-subtle rounded-lg overflow-hidden">
              {pdfLoading && (
                <div className="flex items-center gap-2 text-sm text-strix-text-muted">
                  <Loader2 size={16} className="animate-spin" />
                  Generating PDF...
                </div>
              )}
              {pdfError && (
                <div className="text-sm text-severity-high">{pdfError}</div>
              )}
              {pdfBlobUrl && (
                <iframe
                  src={pdfBlobUrl}
                  className="w-full h-full"
                  title="PDF Preview"
                />
              )}
            </div>
          )}

          {activeTab === "docx" && (
            <div className="h-full overflow-y-auto bg-strix-bg border border-strix-border-subtle rounded-lg p-5">
              {docxLoading && (
                <div className="flex items-center justify-center h-full gap-2 text-sm text-strix-text-muted">
                  <Loader2 size={16} className="animate-spin" />
                  Generating DOCX...
                </div>
              )}
              {docxError && (
                <div className="flex items-center justify-center h-full text-sm text-severity-high">{docxError}</div>
              )}
              {!docxLoading && !docxError && (
                <>
                  <div className="text-xs text-strix-text-muted bg-strix-elevated border border-strix-border-subtle rounded-md px-3 py-2 mb-4">
                    Preview shows Markdown approximation. Download for full Word formatting.
                  </div>
                  <div className="prose prose-invert prose-sm max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdownContent}</ReactMarkdown>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-strix-border-subtle shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-strix-text-muted hover:text-white transition-colors rounded-lg hover:bg-strix-elevated"
          >
            Close
          </button>
          <button
            onClick={handleDownload}
            disabled={!canDownload}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-strix-accent text-black text-xs font-medium rounded-lg hover:bg-strix-accent-hover transition-colors disabled:opacity-40"
          >
            <Download size={13} />
            Download {activeTab === "markdown" ? ".md" : activeTab === "pdf" ? ".pdf" : ".docx"}
          </button>
        </div>
      </div>
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
