import { useState, useCallback, useEffect, useRef, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { X, Download, Loader2, FileText, FileType, FileDown } from "lucide-react";
import clsx from "clsx";
import * as chatApi from "../lib/chatApi";
import { IS_TAURI } from "../lib/config";
import { getUserId } from "../lib/userId";

type TabId = "markdown" | "pdf" | "docx";

interface ExportPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  sessionTitle: string;
  markdownContent: string;
}

/** Styled markdown renderer for document preview (larger text, better spacing than chat) */
function PreviewMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h1 className="text-xl font-bold text-strix-text mt-6 mb-3 first:mt-0 border-b border-strix-border-subtle pb-2">{children}</h1>,
        h2: ({ children }) => <h2 className="text-lg font-bold text-strix-text mt-5 mb-2">{children}</h2>,
        h3: ({ children }) => <h3 className="text-base font-bold text-strix-text mt-4 mb-2">{children}</h3>,
        h4: ({ children }) => <h4 className="text-sm font-semibold text-strix-text-secondary mt-3 mb-1.5">{children}</h4>,
        p: ({ children }) => <p className="text-sm text-strix-text-secondary mb-3 leading-relaxed">{children}</p>,
        strong: ({ children }) => <strong className="font-semibold text-strix-text">{children}</strong>,
        em: ({ children }) => <em className="text-strix-text-secondary italic">{children}</em>,
        ul: ({ children }) => <ul className="text-sm text-strix-text-secondary mb-3 ml-5 space-y-1 list-disc">{children}</ul>,
        ol: ({ children }) => <ol className="text-sm text-strix-text-secondary mb-3 ml-5 space-y-1 list-decimal">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        code: ({ className, children, ...props }: ComponentPropsWithoutRef<"code">) => {
          const isBlock = className?.includes("language-");
          if (isBlock) {
            return (
              <pre className="bg-strix-bg border border-strix-border-subtle rounded-md p-3 my-3 overflow-x-auto">
                <code className="text-xs font-mono text-strix-accent leading-relaxed whitespace-pre-wrap break-all">{children}</code>
              </pre>
            );
          }
          return <code className="text-xs font-mono bg-strix-bg text-strix-accent px-1.5 py-0.5 rounded border border-strix-border-subtle" {...props}>{children}</code>;
        },
        pre: ({ children }) => <>{children}</>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-3 border-strix-accent/50 pl-4 my-3 bg-strix-elevated/50 rounded-r-md py-2 pr-3">{children}</blockquote>
        ),
        hr: () => <hr className="border-strix-border-subtle my-4" />,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-strix-accent hover:underline break-all">{children}</a>
        ),
        table: ({ children }) => (
          <div className="overflow-x-auto my-3 border border-strix-border-subtle rounded-md">
            <table className="text-xs w-full border-collapse">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-strix-elevated">{children}</thead>,
        th: ({ children }) => <th className="text-left px-3 py-2 text-strix-text-secondary font-semibold border-b border-strix-border-subtle">{children}</th>,
        td: ({ children }) => <td className="px-3 py-2 text-strix-text-muted border-t border-strix-border-subtle/50">{children}</td>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
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

  const handleDownload = async () => {
    // Tauri mode: use native save dialog (Rust generates PDF/DOCX server-side)
    if (IS_TAURI && window.__TAURI_INTERNALS__) {
      try {
        await window.__TAURI_INTERNALS__.invoke("save_chat_export", {
          sessionId,
          format: activeTab,
          userId: getUserId(),
          markdownContent: activeTab === "markdown" ? markdownContent : null,
        });
      } catch (e) {
        console.error("Export failed:", e);
      }
      return;
    }

    // Browser mode: download via blob URL
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
    IS_TAURI ||
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
          <h2 className="text-sm font-semibold text-strix-text">Export Chat</h2>
          <button
            onClick={onClose}
            className="text-strix-text-muted hover:text-strix-text transition-colors p-1 rounded hover:bg-strix-elevated"
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
                  : "text-strix-text-muted hover:text-strix-text hover:bg-strix-elevated"
              )}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-3 min-h-0">
          {activeTab === "markdown" && (
            <div className="bg-strix-bg border border-strix-border-subtle rounded-lg p-5">
              <PreviewMarkdown content={markdownContent} />
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
            <div className="bg-strix-bg border border-strix-border-subtle rounded-lg p-5">
              {docxLoading && (
                <div className="flex items-center justify-center py-12 gap-2 text-sm text-strix-text-muted">
                  <Loader2 size={16} className="animate-spin" />
                  Generating DOCX...
                </div>
              )}
              {docxError && (
                <div className="flex items-center justify-center py-12 text-sm text-severity-high">{docxError}</div>
              )}
              {!docxLoading && !docxError && (
                <>
                  <div className="text-xs text-strix-text-muted bg-strix-elevated border border-strix-border-subtle rounded-md px-3 py-2 mb-4">
                    Preview shows Markdown approximation. Download for full Word formatting.
                  </div>
                  <PreviewMarkdown content={markdownContent} />
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-strix-border-subtle shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-strix-text-muted hover:text-strix-text transition-colors rounded-lg hover:bg-strix-elevated"
          >
            Close
          </button>
          <button
            onClick={handleDownload}
            disabled={!canDownload}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-strix-accent text-strix-text-on-accent text-xs font-medium rounded-lg hover:bg-strix-accent-hover transition-colors disabled:opacity-40"
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
