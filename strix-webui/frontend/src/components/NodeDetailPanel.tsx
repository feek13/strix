import { useState, useEffect, useCallback, memo, type ComponentPropsWithoutRef } from "react";
import { X, Globe, Bot, Wrench, ShieldAlert, Maximize2 } from "lucide-react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import clsx from "clsx";
import type { SelectedNode } from "../types/nodeSelection";
import type { Scan, Agent, ToolExecution, Vulnerability } from "../types";
import { useAgentStore } from "../store/agentStore";
import { formatRelativeTime, formatDuration } from "../lib/dateUtils";

interface NodeDetailPanelProps {
  selection: SelectedNode;
  scanId: string;
  onClose: () => void;
}

/** Markdown renderer matching the ReportPreview vulnerability card style */
const VulnMarkdown = memo(function VulnMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h3 className="text-base font-bold text-white mt-3 mb-1.5 first:mt-0">{children}</h3>,
        h2: ({ children }) => <h3 className="text-sm font-bold text-white mt-3 mb-1.5 first:mt-0">{children}</h3>,
        h3: ({ children }) => <h4 className="text-sm font-semibold text-white mt-2.5 mb-1 first:mt-0">{children}</h4>,
        h4: ({ children }) => <h4 className="text-sm font-medium text-strix-text-secondary mt-2 mb-1 first:mt-0">{children}</h4>,
        p: ({ children }) => <p className="text-sm text-strix-text-secondary mb-2 last:mb-0 leading-relaxed">{children}</p>,
        strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
        em: ({ children }) => <em className="text-strix-text-secondary italic">{children}</em>,
        ul: ({ children }) => <ul className="text-sm text-strix-text-secondary mb-2 ml-4 space-y-1 list-disc">{children}</ul>,
        ol: ({ children }) => <ol className="text-sm text-strix-text-secondary mb-2 ml-4 space-y-1 list-decimal">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        code: ({ className, children, ...props }: ComponentPropsWithoutRef<"code"> & { inline?: boolean }) => {
          const isBlock = className?.includes("language-");
          if (isBlock) {
            return (
              <pre className="bg-strix-bg border border-strix-border-subtle rounded-md p-3 my-2 overflow-x-auto">
                <code className="text-xs font-mono text-strix-accent leading-relaxed break-all">{children}</code>
              </pre>
            );
          }
          return <code className="text-xs font-mono bg-strix-bg text-strix-accent px-1.5 py-0.5 rounded break-all" {...props}>{children}</code>;
        },
        pre: ({ children }) => <>{children}</>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-strix-accent/40 pl-3 my-2 text-sm text-strix-text-muted italic">{children}</blockquote>
        ),
        hr: () => <hr className="border-strix-border-subtle my-3" />,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-strix-accent hover:underline break-all">{children}</a>
        ),
        table: ({ children }) => (
          <div className="overflow-x-auto my-2 rounded border border-strix-border-subtle">
            <table className="text-xs w-full border-collapse">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-strix-bg">{children}</thead>,
        th: ({ children }) => <th className="text-left px-3 py-1.5 text-strix-text-secondary font-semibold border-b border-strix-border-subtle">{children}</th>,
        td: ({ children }) => <td className="px-3 py-1.5 text-strix-text-muted border-t border-strix-border-subtle/50 break-all">{children}</td>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
});

// ==================== Shared helpers ====================

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="text-[10px] uppercase tracking-wider text-strix-text-muted mb-0.5">{label}</div>
      <div className="text-xs text-strix-text-secondary">{children}</div>
    </div>
  );
}

function FullField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="text-[10px] uppercase tracking-[0.1em] text-strix-text-muted mb-1">{label}</div>
      <div className="text-sm text-strix-text-secondary leading-relaxed">{children}</div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={clsx(
          "w-1.5 h-1.5 rounded-full",
          status === "running" && "bg-strix-accent animate-pulse",
          status === "completed" && "bg-strix-text-muted",
          status === "failed" && "bg-severity-critical",
          status === "waiting" && "bg-severity-medium",
          status === "pending" && "bg-strix-border",
          status === "stopped" && "bg-severity-high",
          status === "error" && "bg-severity-critical",
        )}
      />
      <span className="capitalize">{status}</span>
    </span>
  );
}

function SeverityBadge({ severity, size = "sm" }: { severity: string; size?: "sm" | "lg" }) {
  const colors: Record<string, string> = {
    critical: "bg-severity-critical/20 text-severity-critical",
    high: "bg-severity-high/20 text-severity-high",
    medium: "bg-severity-medium/20 text-severity-medium",
    low: "bg-severity-low/20 text-severity-low",
    info: "bg-strix-elevated text-strix-text-muted",
  };
  return (
    <span
      className={clsx(
        "uppercase font-semibold rounded",
        colors[severity] || colors.info,
        size === "lg" ? "text-xs px-2 py-1" : "text-[10px] px-1.5 py-0.5"
      )}
    >
      {severity}
    </span>
  );
}

const SEV_BG: Record<string, string> = {
  critical: "bg-severity-critical/10 border-severity-critical/30",
  high: "bg-severity-high/10 border-severity-high/30",
  medium: "bg-severity-medium/10 border-severity-medium/30",
  low: "bg-severity-low/10 border-severity-low/30",
  info: "bg-strix-elevated border-strix-border-subtle",
};

const SEV_COLORS: Record<string, string> = {
  critical: "text-severity-critical",
  high: "text-severity-high",
  medium: "text-severity-medium",
  low: "text-severity-low",
  info: "text-strix-text-muted",
};

function computeDuration(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  return formatDuration(e - s);
}

function formatJson(obj: unknown): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

function truncateJson(obj: unknown, maxLen = 300): string {
  const s = formatJson(obj);
  return s.length > maxLen ? s.slice(0, maxLen) + "\n..." : s;
}

function truncateText(text: string | undefined, lines: number): string | null {
  if (!text) return null;
  const arr = text.split("\n");
  if (arr.length <= lines) return text;
  return arr.slice(0, lines).join("\n") + "...";
}

// ==================== Side panel per-type content (truncated) ====================

function TargetContent({ scan }: { scan: Scan }) {
  return (
    <>
      <Field label="Status"><StatusDot status={scan.status} /></Field>
      <Field label="Mode"><span className="capitalize">{scan.mode}</span></Field>
      <Field label="Target Type"><span className="capitalize">{scan.targetType}</span></Field>
      {scan.startedAt && <Field label="Started">{formatRelativeTime(scan.startedAt)}</Field>}
      {scan.completedAt && <Field label="Completed">{formatRelativeTime(scan.completedAt)}</Field>}
      {scan.startedAt && (
        <Field label="Duration">{computeDuration(scan.startedAt, scan.completedAt)}</Field>
      )}
      <Field label="Findings">
        <span className={clsx(scan.findings > 0 ? "text-severity-high" : "text-strix-text-muted")}>
          {scan.findings}
        </span>
      </Field>
    </>
  );
}

function AgentContent({ agent }: { agent: Agent }) {
  return (
    <>
      <Field label="Status"><StatusDot status={agent.status} /></Field>
      {agent.task && <Field label="Task">{agent.task}</Field>}
      {agent.parentId && (
        <Field label="Parent">
          <ParentName parentId={agent.parentId} />
        </Field>
      )}
      <Field label="Created">{formatRelativeTime(agent.createdAt)}</Field>
      {agent.finishedAt && <Field label="Finished">{formatRelativeTime(agent.finishedAt)}</Field>}
      <Field label="Duration">{computeDuration(agent.createdAt, agent.finishedAt)}</Field>
    </>
  );
}

function ParentName({ parentId }: { parentId: string }) {
  const parent = useAgentStore((s) => s.agents.get(parentId));
  return <span>{parent ? parent.name : parentId}</span>;
}

function ToolContent({ tool }: { tool: ToolExecution }) {
  const agent = useAgentStore((s) => s.agents.get(tool.agentId));
  return (
    <>
      <Field label="Status"><StatusDot status={tool.status} /></Field>
      <Field label="Agent">{agent ? agent.name : tool.agentId}</Field>
      {tool.duration !== undefined && <Field label="Duration">{formatDuration(tool.duration)}</Field>}
      <Field label="Input">
        <pre className="text-[10px] font-mono bg-strix-bg border border-strix-border-subtle rounded p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
          {truncateJson(tool.toolInput)}
        </pre>
      </Field>
      {tool.toolOutput !== undefined && (
        <Field label="Output">
          <pre className="text-[10px] font-mono bg-strix-bg border border-strix-border-subtle rounded p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
            {truncateJson(tool.toolOutput)}
          </pre>
        </Field>
      )}
    </>
  );
}

function FindingContent({ vuln }: { vuln: Vulnerability }) {
  return (
    <>
      <Field label="Severity"><SeverityBadge severity={vuln.severity} /></Field>
      {vuln.cvss !== undefined && <Field label="CVSS">{vuln.cvss}</Field>}
      {vuln.affectedUrl && (
        <Field label="Affected URL">
          <span className="font-mono text-[10px] break-all">{vuln.affectedUrl}</span>
        </Field>
      )}
      {vuln.description && (
        <Field label="Description">{truncateText(vuln.description, 3)}</Field>
      )}
      {vuln.impact && (
        <Field label="Impact">{truncateText(vuln.impact, 2)}</Field>
      )}
    </>
  );
}

// ==================== Modal full-detail content ====================

function TargetFull({ scan }: { scan: Scan }) {
  const durationMs = scan.startedAt
    ? (scan.completedAt ? new Date(scan.completedAt).getTime() : Date.now()) - new Date(scan.startedAt).getTime()
    : null;

  return (
    <div className="border border-strix-border-subtle rounded-card p-6 bg-strix-card">
      <div className="flex items-center gap-3 mb-5">
        <Globe size={24} className="text-strix-accent shrink-0" />
        <div>
          <h2 className="text-lg font-semibold text-white">{scan.target}</h2>
          <div className="text-xs text-strix-text-muted mt-0.5">Scan ID: {scan.id}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-5">
        <div className="bg-strix-elevated border border-strix-border-subtle rounded-card p-3 text-center">
          <StatusDot status={scan.status} />
        </div>
        <div className="bg-strix-elevated border border-strix-border-subtle rounded-card p-3 text-center">
          <div className="text-sm font-medium text-white capitalize">{scan.mode}</div>
          <div className="text-[10px] text-strix-text-muted">Mode</div>
        </div>
        <div className="bg-strix-elevated border border-strix-border-subtle rounded-card p-3 text-center">
          <div className="text-sm font-medium text-white capitalize">{scan.targetType}</div>
          <div className="text-[10px] text-strix-text-muted">Target Type</div>
        </div>
        <div className="bg-strix-elevated border border-strix-border-subtle rounded-card p-3 text-center">
          <div className={clsx("text-sm font-medium", scan.findings > 0 ? "text-severity-high" : "text-white")}>{scan.findings}</div>
          <div className="text-[10px] text-strix-text-muted">Findings</div>
        </div>
      </div>

      {scan.startedAt && (
        <FullField label="Started">
          {new Date(scan.startedAt).toLocaleString()}
        </FullField>
      )}
      {scan.completedAt && (
        <FullField label="Completed">
          {new Date(scan.completedAt).toLocaleString()}
        </FullField>
      )}
      {durationMs !== null && (
        <FullField label="Duration">{formatDuration(durationMs)}</FullField>
      )}
    </div>
  );
}

function AgentFull({ agent }: { agent: Agent }) {
  return (
    <div className="border border-strix-border-subtle rounded-card p-6 bg-strix-card">
      <div className="flex items-center gap-3 mb-5">
        <Bot size={24} className={agent.status === "running" ? "text-strix-accent" : "text-strix-text-muted"} />
        <div>
          <h2 className="text-lg font-semibold text-white">{agent.name}</h2>
          <div className="text-xs text-strix-text-muted mt-0.5">Agent ID: {agent.id}</div>
        </div>
      </div>

      <FullField label="Status"><StatusDot status={agent.status} /></FullField>

      {agent.task && (
        <FullField label="Task">
          <div className="bg-strix-elevated border border-strix-border-subtle rounded p-3 text-sm text-strix-text-secondary whitespace-pre-wrap">
            {agent.task}
          </div>
        </FullField>
      )}

      {agent.parentId && (
        <FullField label="Parent Agent"><ParentName parentId={agent.parentId} /></FullField>
      )}

      <div className="grid grid-cols-2 gap-4">
        <FullField label="Created">{new Date(agent.createdAt).toLocaleString()}</FullField>
        {agent.finishedAt && (
          <FullField label="Finished">{new Date(agent.finishedAt).toLocaleString()}</FullField>
        )}
      </div>

      <FullField label="Duration">{computeDuration(agent.createdAt, agent.finishedAt)}</FullField>
    </div>
  );
}

function ToolFull({ tool }: { tool: ToolExecution }) {
  const agent = useAgentStore((s) => s.agents.get(tool.agentId));
  return (
    <div className="border border-strix-border-subtle rounded-card p-6 bg-strix-card">
      <div className="flex items-center gap-3 mb-5">
        <Wrench size={24} className={tool.status === "running" ? "text-strix-accent" : "text-strix-text-muted"} />
        <div>
          <h2 className="text-lg font-semibold text-white">{tool.toolName}</h2>
          <div className="text-xs text-strix-text-muted mt-0.5">Tool ID: {tool.id}</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-5">
        <div className="bg-strix-elevated border border-strix-border-subtle rounded-card p-3 text-center">
          <StatusDot status={tool.status} />
        </div>
        <div className="bg-strix-elevated border border-strix-border-subtle rounded-card p-3 text-center">
          <div className="text-sm font-medium text-white">{agent ? agent.name : tool.agentId.slice(0, 8)}</div>
          <div className="text-[10px] text-strix-text-muted">Agent</div>
        </div>
        {tool.duration !== undefined && (
          <div className="bg-strix-elevated border border-strix-border-subtle rounded-card p-3 text-center">
            <div className="text-sm font-medium text-white">{formatDuration(tool.duration)}</div>
            <div className="text-[10px] text-strix-text-muted">Duration</div>
          </div>
        )}
      </div>

      <FullField label="Input">
        <pre className="text-xs font-mono bg-strix-bg border border-strix-border-subtle rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-all max-h-[400px] overflow-y-auto">
          {formatJson(tool.toolInput)}
        </pre>
      </FullField>

      {tool.toolOutput !== undefined && (
        <FullField label="Output">
          <pre className="text-xs font-mono bg-strix-bg border border-strix-border-subtle rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-all max-h-[400px] overflow-y-auto">
            {formatJson(tool.toolOutput)}
          </pre>
        </FullField>
      )}

      <FullField label="Started">{new Date(tool.startedAt).toLocaleString()}</FullField>
      {tool.completedAt && (
        <FullField label="Completed">{new Date(tool.completedAt).toLocaleString()}</FullField>
      )}
    </div>
  );
}

function FindingFull({ vuln }: { vuln: Vulnerability }) {
  return (
    <div className={clsx("border rounded-card p-6 overflow-hidden", SEV_BG[vuln.severity])}>
      <div className="flex items-start gap-3 mb-4">
        <ShieldAlert size={22} className={clsx(SEV_COLORS[vuln.severity], "shrink-0 mt-0.5")} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-semibold text-white">{vuln.title}</h2>
            <SeverityBadge severity={vuln.severity} size="lg" />
            {vuln.cvss !== undefined && (
              <span className="text-xs text-strix-text-muted">CVSS {vuln.cvss}</span>
            )}
          </div>
        </div>
      </div>

      {vuln.affectedUrl && (
        <FullField label="Affected URL">
          <span className="text-sm text-strix-accent font-mono break-all">{vuln.affectedUrl}</span>
        </FullField>
      )}

      {vuln.description && (
        <FullField label="Description">
          <VulnMarkdown content={vuln.description} />
        </FullField>
      )}

      {vuln.proofOfConcept && (
        <FullField label="Proof of Concept">
          <VulnMarkdown content={vuln.proofOfConcept} />
        </FullField>
      )}

      {vuln.impact && (
        <FullField label="Impact">
          <VulnMarkdown content={vuln.impact} />
        </FullField>
      )}

      {vuln.remediation && (
        <FullField label="Remediation">
          <VulnMarkdown content={vuln.remediation} />
        </FullField>
      )}

      {vuln.references && vuln.references.length > 0 && (
        <FullField label="References">
          <ul className="list-disc ml-4 space-y-1">
            {vuln.references.map((ref, i) => (
              <li key={i}>
                <a href={ref} target="_blank" rel="noopener noreferrer" className="text-strix-accent hover:underline break-all text-sm">
                  {ref}
                </a>
              </li>
            ))}
          </ul>
        </FullField>
      )}

      <FullField label="Discovered">{new Date(vuln.discoveredAt).toLocaleString()}</FullField>
    </div>
  );
}

// ==================== Detail Modal ====================

function DetailModal({ selection, onClose }: { selection: SelectedNode; onClose: () => void }) {
  const { icon: Icon, label } = META[selection.type];

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-2xl max-h-[85vh] mx-4 flex flex-col bg-strix-bg border border-strix-border-subtle rounded-card shadow-2xl">
        {/* Header */}
        <div className="h-12 border-b border-strix-border-subtle flex items-center justify-between px-5 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <Icon size={18} className="text-strix-accent shrink-0" />
            <span className="text-sm font-semibold text-white truncate">{label(selection)}</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-strix-elevated text-strix-text-muted hover:text-white transition-colors shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {selection.type === "target" && <TargetFull scan={selection.data} />}
          {selection.type === "agent" && <AgentFull agent={selection.data} />}
          {selection.type === "tool" && <ToolFull tool={selection.data} />}
          {selection.type === "finding" && <FindingFull vuln={selection.data} />}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ==================== Icon + title per type ====================

const META: Record<SelectedNode["type"], { icon: typeof Globe; label: (n: SelectedNode) => string }> = {
  target: {
    icon: Globe,
    label: (n) => (n as { data: Scan }).data.target,
  },
  agent: {
    icon: Bot,
    label: (n) => (n as { data: Agent }).data.name,
  },
  tool: {
    icon: Wrench,
    label: (n) => (n as { data: ToolExecution }).data.toolName,
  },
  finding: {
    icon: ShieldAlert,
    label: (n) => (n as { data: Vulnerability }).data.title,
  },
};

// ==================== Main panel ====================

export default function NodeDetailPanel({ selection, scanId, onClose }: NodeDetailPanelProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const { icon: Icon, label } = META[selection.type];

  const closeModal = useCallback(() => setModalOpen(false), []);

  return (
    <>
      <div className="min-w-[320px] h-full border-l border-strix-border-subtle bg-strix-card flex flex-col">
        {/* Header */}
        <div className="h-10 border-b border-strix-border-subtle flex items-center justify-between px-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Icon size={14} className="text-strix-accent shrink-0" />
            <span className="text-xs font-medium text-white truncate">{label(selection)}</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-strix-elevated text-strix-text-muted hover:text-white transition-colors shrink-0"
          >
            <X size={14} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-4">
          {selection.type === "target" && <TargetContent scan={selection.data} />}
          {selection.type === "agent" && <AgentContent agent={selection.data} />}
          {selection.type === "tool" && <ToolContent tool={selection.data} />}
          {selection.type === "finding" && <FindingContent vuln={selection.data} />}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-strix-border-subtle shrink-0">
          <button
            onClick={() => setModalOpen(true)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-btn text-xs font-medium bg-strix-elevated hover:bg-strix-border text-strix-text-secondary hover:text-white transition-colors"
          >
            <Maximize2 size={12} />
            More
          </button>
        </div>
      </div>

      {modalOpen && <DetailModal selection={selection} onClose={closeModal} />}
    </>
  );
}
