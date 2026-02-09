import { useState, useEffect, useRef, useCallback, useMemo, memo, type ComponentPropsWithoutRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import clsx from "clsx";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft, Download, MessageSquare, Send, X, Loader2,
  ShieldAlert, Bot, AlertTriangle, Zap, Plus, Trash2, Copy, Check,
} from "lucide-react";
import type { Scan, Vulnerability, Agent, ToolExecution, ChatSession } from "../types";
import type { ToolBlock, StreamBlock, ChatMessage } from "../types/chat";
import * as chatApi from "../lib/chatApi";
import { formatRelativeTime, formatDuration } from "../lib/dateUtils";
import { useTypewriter } from "../hooks/useTypewriter";
import { ToolBlockRenderer } from "../components/ToolBlockRenderer";

interface ScanDetail {
  scan: Scan;
  agents: Agent[];
  tools: ToolExecution[];
  vulnerabilities: Vulnerability[];
}

/** Code block with a GitHub-style copy button */
const CodeBlockWithCopy = memo(function CodeBlockWithCopy({
  children, preClassName, codeClassName,
}: { children: React.ReactNode; preClassName: string; codeClassName: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    const text = String(children).replace(/\n$/, "");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [children]);
  return (
    <div className="relative group/code">
      <pre className={preClassName}>
        <code className={codeClassName}>{children}</code>
      </pre>
      <button
        onClick={handleCopy}
        className="absolute top-1.5 right-1.5 p-1 rounded bg-strix-elevated/80 border border-strix-border-subtle text-strix-text-muted hover:text-white opacity-0 group-hover/code:opacity-100 transition-all"
        title="Copy code"
      >
        {copied ? <Check size={12} className="text-strix-accent" /> : <Copy size={12} />}
      </button>
    </div>
  );
});

/** Markdown renderer styled for the chat panel */
const ChatMarkdown = memo(function ChatMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h3 className="text-sm font-bold text-white mt-3 mb-1.5 first:mt-0">{children}</h3>,
        h2: ({ children }) => <h3 className="text-sm font-bold text-white mt-3 mb-1.5 first:mt-0">{children}</h3>,
        h3: ({ children }) => <h4 className="text-xs font-bold text-white mt-2.5 mb-1 first:mt-0">{children}</h4>,
        h4: ({ children }) => <h4 className="text-xs font-semibold text-strix-text-secondary mt-2 mb-1 first:mt-0">{children}</h4>,
        p: ({ children }) => <p className="text-xs text-strix-text-secondary mb-2 last:mb-0 leading-relaxed">{children}</p>,
        strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
        em: ({ children }) => <em className="text-strix-text-secondary italic">{children}</em>,
        ul: ({ children }) => <ul className="text-xs text-strix-text-secondary mb-2 ml-3 space-y-0.5 list-disc">{children}</ul>,
        ol: ({ children }) => <ol className="text-xs text-strix-text-secondary mb-2 ml-3 space-y-0.5 list-decimal">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        code: ({ className, children, ...props }: ComponentPropsWithoutRef<"code"> & { inline?: boolean }) => {
          const isBlock = className?.includes("language-");
          if (isBlock) {
            return (
              <CodeBlockWithCopy
                preClassName="bg-strix-bg border border-strix-border-subtle rounded p-2 my-1.5 overflow-x-auto"
                codeClassName="text-[11px] font-mono text-strix-accent leading-relaxed"
              >{children}</CodeBlockWithCopy>
            );
          }
          return <code className="text-[11px] font-mono bg-strix-bg text-strix-accent px-1 py-0.5 rounded" {...props}>{children}</code>;
        },
        pre: ({ children }) => <>{children}</>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-strix-accent/40 pl-2.5 my-1.5 text-xs text-strix-text-muted italic">{children}</blockquote>
        ),
        hr: () => <hr className="border-strix-border-subtle my-2" />,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-strix-accent hover:underline">{children}</a>
        ),
        table: ({ children }) => (
          <div className="overflow-x-auto my-2">
            <table className="text-[11px] w-full border-collapse">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="border-b border-strix-border-subtle">{children}</thead>,
        th: ({ children }) => <th className="text-left px-2 py-1 text-strix-text-secondary font-semibold">{children}</th>,
        td: ({ children }) => <td className="px-2 py-1 text-strix-text-muted border-t border-strix-border-subtle/50">{children}</td>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
});

/** Parse user message to extract optional report context */
function parseReportContext(content: string): { context: string | null; question: string } {
  const match = content.match(/^<!--report-context-->\n([\s\S]*?)\n<!--\/report-context-->\n([\s\S]*)$/);
  if (match) return { context: match[1], question: match[2] };
  return { context: null, question: content };
}

/** Renders user message content, with collapsible report context if present */
const UserMessageContent = memo(function UserMessageContent({ content }: { content: string }) {
  const { context, question } = parseReportContext(content);
  if (!context) return <span className="whitespace-pre-wrap">{content}</span>;
  return (
    <>
      <details className="mb-2 group">
        <summary className="text-[10px] text-strix-text-muted cursor-pointer select-none flex items-center gap-1 hover:text-strix-text-secondary transition-colors">
          <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
          Selected from report
        </summary>
        <div className="mt-1.5 pl-2 border-l-2 border-strix-accent/30 max-h-[200px] overflow-y-auto">
          <ChatMarkdown content={context} />
        </div>
      </details>
      <span className="whitespace-pre-wrap">{question}</span>
    </>
  );
});

/** Markdown renderer styled for the report vulnerability cards */
const ReportMarkdown = memo(function ReportMarkdown({ content }: { content: string }) {
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
              <CodeBlockWithCopy
                preClassName="bg-strix-bg border border-strix-border-subtle rounded-md p-3 my-2 overflow-x-auto"
                codeClassName="text-xs font-mono text-strix-accent leading-relaxed break-all"
              >{children}</CodeBlockWithCopy>
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

const SEV_COLORS: Record<string, string> = {
  critical: "text-severity-critical",
  high: "text-severity-high",
  medium: "text-severity-medium",
  low: "text-severity-low",
  info: "text-strix-text-muted",
};

const SEV_BG: Record<string, string> = {
  critical: "bg-severity-critical/10 border-severity-critical/30",
  high: "bg-severity-high/10 border-severity-high/30",
  medium: "bg-severity-medium/10 border-severity-medium/30",
  low: "bg-severity-low/10 border-severity-low/30",
  info: "bg-strix-elevated border-strix-border-subtle",
};

export default function ReportPreview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const reportRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [data, setData] = useState<ScanDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  // AI Chat
  const [chatOpen, setChatOpen] = useState(false);
  const [selectedText, setSelectedText] = useState("");
  const selectedTextRef = useRef("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [executeMode, setExecuteMode] = useState(false);
  const [streamBlocks, setStreamBlocks] = useState<StreamBlock[]>([]);
  const [streamPhase, setStreamPhase] = useState<"init" | "working" | "done" | null>(null);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const [compacting, setCompacting] = useState(false);

  const typewriter = useTypewriter();
  const streamingText = typewriter.text;

  // Chat sessions
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showSessionList, setShowSessionList] = useState(true);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  // Selection popup — use ref to avoid re-rendering report on every selection
  const [popup, setPopup] = useState<{ x: number; y: number } | null>(null);

  // Fetch scan data
  useEffect(() => {
    if (!id) return;
    fetch(`/api/scans/${id}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [id]);

  // Text selection handler — store text in ref (no re-render), only update popup position
  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (text && text.length > 3 && reportRef.current?.contains(sel?.anchorNode || null)) {
      selectedTextRef.current = text;
      // Use mouse position so the popup always appears where the user released,
      // even for large multi-line selections where getBoundingClientRect().top
      // would be off-screen.
      setPopup({ x: e.clientX, y: e.clientY - 12 });
    } else {
      setPopup(null);
    }
  }, []);

  // Load sessions when chat panel opens
  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const s = await chatApi.listSessions();
      setSessions(s);
    } catch { /* ignore */ } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (chatOpen) loadSessions();
  }, [chatOpen, loadSessions]);

  // Load messages when session is selected
  const loadSession = useCallback(async (sessionId: string) => {
    try {
      const msgs = await chatApi.getMessages(sessionId);
      const chatMsgs: ChatMessage[] = msgs.map((m) => ({
        role: m.role,
        content: m.content,
        isExecute: m.isExecute,
        blocks: m.blocks ? JSON.parse(m.blocks) : undefined,
      }));
      setMessages(chatMsgs);
      setActiveSessionId(sessionId);
      setShowSessionList(false);
    } catch { /* ignore */ }
  }, []);

  const createNewSession = useCallback(async () => {
    try {
      const session = await chatApi.createSession(id);
      setSessions((prev) => [session, ...prev]);
      setMessages([]);
      setActiveSessionId(session.id);
      setShowSessionList(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    } catch { /* ignore */ }
  }, [id]);

  const handleDeleteSession = useCallback(async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await chatApi.deleteSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (activeSessionId === sessionId) {
        setActiveSessionId(null);
        setMessages([]);
        setShowSessionList(true);
      }
    } catch { /* ignore */ }
  }, [activeSessionId]);

  const backToSessionList = useCallback(() => {
    setShowSessionList(true);
    loadSessions();
  }, [loadSessions]);

  // Clear popup on click outside
  useEffect(() => {
    const handleDown = () => setPopup(null);
    document.addEventListener("mousedown", handleDown);
    return () => document.removeEventListener("mousedown", handleDown);
  }, []);

  // Auto scroll chat (debounced to once per frame)
  const scrollRaf = useRef(0);
  useEffect(() => {
    if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current);
    scrollRaf.current = requestAnimationFrame(() => {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
      scrollRaf.current = 0;
    });
  }, [messages, streamingText, streamBlocks]);

  const openChatWithSelection = async () => {
    setSelectedText(selectedTextRef.current);
    setChatOpen(true);
    setPopup(null);
    if (!activeSessionId) {
      await createNewSession();
    }
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  // Toggle tool block expand/collapse
  const toggleTool = (toolId: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(toolId)) next.delete(toolId);
      else next.add(toolId);
      return next;
    });
  };

  // Ask AI with SSE streaming
  const handleAsk = async () => {
    const q = question.trim();
    if (!q || asking) return;

    // Capture and clear selectedText so it's included only in this message
    const capturedSelectedText = selectedText;
    if (capturedSelectedText) setSelectedText("");

    const isExec = executeMode;
    const displayContent = capturedSelectedText
      ? `<!--report-context-->\n${capturedSelectedText}\n<!--/report-context-->\n${q}`
      : q;
    const userMsg: ChatMessage = { role: "user", content: displayContent, isExecute: isExec };
    setMessages((prev) => [...prev, userMsg]);
    setQuestion("");
    setAsking(true);
    typewriter.reset();
    setStreamBlocks([]);
    setStreamPhase(isExec ? "init" : null);
    setCompacting(false);

    // Auto-create session if none active
    let sessionId = activeSessionId;
    if (!sessionId) {
      try {
        const session = await chatApi.createSession(id, q.slice(0, 50));
        sessionId = session.id;
        setActiveSessionId(session.id);
        setSessions((prev) => [session, ...prev]);
        setShowSessionList(false);
      } catch { /* ignore */ }
    }

    // Save user message and auto-title if first message
    if (sessionId) {
      try {
        await chatApi.saveMessage(sessionId, { role: "user", content: displayContent, isExecute: isExec });
        // Auto-title: update session title from first user message
        const currentSession = sessions.find((s) => s.id === sessionId);
        if (currentSession && currentSession.title === "New Chat") {
          const title = q.slice(0, 50) + (q.length > 50 ? "..." : "");
          await chatApi.updateSessionTitle(sessionId, title);
          setSessions((prev) => prev.map((s) => s.id === sessionId ? { ...s, title } : s));
        }
      } catch { /* ignore */ }
    }

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scanId: id,
          selectedText: capturedSelectedText,
          question: q,
          sessionId,
          mode: isExec ? "execute" : "ask",
          // Always send history — backend decides whether to use it
          // Strip report-context delimiters from user messages to avoid bloating the prompt
          history: messages.map((m) => ({
            role: m.role,
            content: m.role === "user" ? parseReportContext(m.content).question : m.content,
          })),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Request failed");
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";
      const blocks: StreamBlock[] = [];
      let pendingFlush = 0;
      const flushBlocks = () => {
        if (!pendingFlush) {
          pendingFlush = requestAnimationFrame(() => {
            setStreamBlocks([...blocks]);
            pendingFlush = 0;
          });
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") continue;

          try {
            const evt = JSON.parse(raw);
            if (evt.error) throw new Error(evt.error);

            if (evt.type) {
              switch (evt.type) {
                case "init":
                  setStreamPhase("working");
                  break;

                case "compacting":
                  setCompacting(true);
                  break;

                case "text": {
                  const text = evt.text || "";
                  fullText += text;
                  if (compacting) setCompacting(false);
                  if (isExec) {
                    const last = blocks[blocks.length - 1];
                    if (last && last.type === "text") {
                      last.text = (last.text || "") + text;
                    } else {
                      blocks.push({ type: "text", text });
                    }
                    flushBlocks();
                  } else {
                    typewriter.start(fullText);
                  }
                  break;
                }

                case "tool_use": {
                  const toolBlock: ToolBlock = {
                    id: evt.toolUseId || `tool-${Date.now()}`,
                    name: evt.name || "unknown",
                    input: evt.input || {},
                    status: "running",
                  };
                  blocks.push({ type: "tool", tool: toolBlock });
                  flushBlocks();
                  break;
                }

                case "tool_result": {
                  for (const block of blocks) {
                    const t = block.tool;
                    if (block.type === "tool" && t && t.id === evt.toolUseId) {
                      t.status = evt.isError ? "error" : "done";
                      t.result = evt.content || "";
                      break;
                    }
                  }
                  flushBlocks();
                  break;
                }

                case "result":
                  // Use result text as fallback if no text events were received
                  if (!fullText && evt.result) {
                    fullText = evt.result;
                    if (!isExec) {
                      typewriter.start(fullText);
                    } else {
                      blocks.push({ type: "text", text: fullText });
                      flushBlocks();
                    }
                  }
                  setStreamPhase("done");
                  break;
              }
            }
          } catch (e) {
            if (e instanceof Error && e.message !== "[DONE]") throw e;
          }
        }
      }

      // Cancel pending rAF and ensure final state is rendered
      if (pendingFlush) { cancelAnimationFrame(pendingFlush); pendingFlush = 0; }

      // Stop typewriter and show full text
      typewriter.stop();

      // Don't add empty assistant messages
      if (fullText || blocks.length > 0) {
        const assistantMsg: ChatMessage = isExec
          ? { role: "assistant", content: fullText, blocks: blocks.length > 0 ? [...blocks] : undefined }
          : { role: "assistant", content: fullText };
        setMessages((prev) => [...prev, assistantMsg]);

        if (sessionId) {
          try {
            await chatApi.saveMessage(sessionId, {
              role: "assistant",
              content: fullText,
              blocks: assistantMsg.blocks ? JSON.stringify(assistantMsg.blocks) : undefined,
            });
          } catch { /* ignore */ }
        }
      }

      typewriter.reset();
      setStreamBlocks([]);
      setStreamPhase(null);

      // Refresh sessions to pick up claudeSessionId set by backend
      if (sessionId) {
        try {
          const updated = await chatApi.listSessions();
          setSessions(updated);
        } catch { /* ignore */ }
      }
    } catch (err) {
      typewriter.stop();
      const msg = err instanceof Error ? err.message : "Unknown error";
      setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${msg}` }]);
    } finally {
      setAsking(false);
      typewriter.reset();
      setStreamBlocks([]);
      setStreamPhase(null);
      setCompacting(false);
    }
  };

  const { sorted, sevCounts, durationMs, risk } = useMemo(() => {
    if (!data) return { sorted: [] as Vulnerability[], sevCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 }, durationMs: null as number | null, risk: "Low" };

    const { scan, vulnerabilities } = data;
    const sorted = [...vulnerabilities].sort((a, b) => {
      const scores: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
      return (scores[b.severity] || 0) - (scores[a.severity] || 0);
    });

    const sevCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const v of sorted) sevCounts[v.severity as keyof typeof sevCounts]++;

    const durationMs = scan.startedAt && scan.completedAt
      ? new Date(scan.completedAt).getTime() - new Date(scan.startedAt).getTime()
      : null;

    let risk = "Low";
    if (sevCounts.critical > 0) risk = "Critical";
    else if (sevCounts.high > 0) risk = "High";
    else if (sevCounts.medium > 0) risk = "Medium";

    return { sorted, sevCounts, durationMs, risk };
  }, [data]);

  const downloadPDF = async () => {
    if (!id) return;
    setGenerating(true);
    try {
      const res = await fetch(`/api/scans/${id}/report`);
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `strix-report-${id.slice(0, 8)}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch { /* ignore */ } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin text-strix-text-muted" size={32} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-strix-text-muted">
        <AlertTriangle size={32} className="mb-2" />
        <span>Report not found</span>
      </div>
    );
  }

  const { scan, agents, tools, vulnerabilities } = data;

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* Header */}
      <div className="h-12 bg-strix-card border-b border-strix-border-subtle flex items-center px-4 gap-3 shrink-0">
        <button onClick={() => navigate(-1)} className="text-strix-text-muted hover:text-white transition-colors">
          <ArrowLeft size={18} />
        </button>
        <span className="text-sm font-medium truncate flex-1">{scan.target}</span>
        <span className="text-xs text-strix-text-muted capitalize">{scan.status}</span>
        {durationMs && <span className="text-xs text-strix-text-muted">{formatDuration(durationMs)}</span>}
        <button
          onClick={() => { setChatOpen(!chatOpen); }}
          className={clsx(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-btn text-xs transition-colors",
            chatOpen ? "bg-strix-accent text-black" : "bg-strix-elevated text-strix-text-secondary hover:text-white"
          )}
        >
          <MessageSquare size={14} />
          Ask AI
        </button>
        <button
          onClick={downloadPDF}
          disabled={generating}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-btn bg-strix-elevated text-strix-text-secondary hover:text-white text-xs transition-colors disabled:opacity-50"
        >
          {generating ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          PDF
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 flex min-h-0">
        {/* Report Content */}
        <div
          ref={reportRef}
          onMouseUp={handleMouseUp}
          className="flex-1 overflow-y-auto p-8 max-w-4xl mx-auto select-text overflow-x-hidden"
        >
          {/* Title */}
          <div className="text-center mb-12">
            <div className="text-[10px] uppercase tracking-[0.3em] text-strix-text-muted mb-8">Confidential</div>
            <h1 className="text-3xl font-bold mb-3">Security Assessment Report</h1>
            <div className="text-strix-accent text-lg mb-6">{scan.target}</div>
            <div className="text-xs text-strix-text-muted space-y-1">
              <div>{new Date(scan.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</div>
              <div>Mode: {scan.mode} | Type: {scan.targetType}</div>
              {durationMs && <div>Duration: {formatDuration(durationMs)}</div>}
              <div className="text-[10px] mt-4">Scan ID: {scan.id}</div>
            </div>
          </div>

          <hr className="border-strix-border-subtle mb-8" />

          {/* Executive Summary */}
          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">Executive Summary</h2>

            <div className="grid grid-cols-4 gap-4 mb-6">
              <div className="bg-strix-card border border-strix-border-subtle rounded-card p-4 text-center">
                <div className="text-2xl font-bold">{sorted.length}</div>
                <div className="text-xs text-strix-text-muted">Findings</div>
              </div>
              <div className="bg-strix-card border border-strix-border-subtle rounded-card p-4 text-center">
                <div className="text-2xl font-bold">{agents.length}</div>
                <div className="text-xs text-strix-text-muted">Agents</div>
              </div>
              <div className="bg-strix-card border border-strix-border-subtle rounded-card p-4 text-center">
                <div className="text-2xl font-bold">{tools.length}</div>
                <div className="text-xs text-strix-text-muted">Tools</div>
              </div>
              <div className="bg-strix-card border border-strix-border-subtle rounded-card p-4 text-center">
                <div className={clsx("text-2xl font-bold", SEV_COLORS[risk.toLowerCase()] || "text-strix-accent")}>
                  {risk}
                </div>
                <div className="text-xs text-strix-text-muted">Risk Level</div>
              </div>
            </div>

            {/* Severity breakdown */}
            <div className="space-y-2">
              {(["critical", "high", "medium", "low", "info"] as const).map((sev) => {
                const count = sevCounts[sev];
                return (
                  <div key={sev} className="flex items-center gap-3">
                    <span className={clsx("w-16 text-xs uppercase font-medium", SEV_COLORS[sev])}>{sev}</span>
                    <div className="flex-1 h-2 bg-strix-elevated rounded-full overflow-hidden">
                      <div
                        className={clsx("h-full rounded-full transition-all", {
                          "bg-severity-critical": sev === "critical",
                          "bg-severity-high": sev === "high",
                          "bg-severity-medium": sev === "medium",
                          "bg-severity-low": sev === "low",
                          "bg-strix-text-muted": sev === "info",
                        })}
                        style={{ width: sorted.length > 0 ? `${(count / sorted.length) * 100}%` : "0%" }}
                      />
                    </div>
                    <span className="w-8 text-xs text-strix-text-secondary text-right">{count}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <hr className="border-strix-border-subtle mb-8" />

          {/* Vulnerability Details */}
          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">Vulnerability Details</h2>

            {sorted.length === 0 && (
              <div className="text-sm text-strix-text-muted py-4">
                No vulnerabilities were found during this assessment.
              </div>
            )}

            {sorted.map((v, i) => (
              <div key={v.id} className={clsx("border rounded-card p-5 mb-4 overflow-hidden", SEV_BG[v.severity])}>
                <div className="flex items-start gap-2 mb-3">
                  <ShieldAlert size={18} className={clsx(SEV_COLORS[v.severity], "shrink-0 mt-0.5")} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{i + 1}. {v.title}</span>
                      <span className={clsx("text-[10px] px-2 py-0.5 rounded-full uppercase font-bold border shrink-0", SEV_BG[v.severity], SEV_COLORS[v.severity])}>
                        {v.severity}
                      </span>
                      {v.cvss && <span className="text-xs text-strix-text-muted shrink-0">CVSS {v.cvss}</span>}
                    </div>
                  </div>
                </div>

                {v.affectedUrl && (
                  <div className="mb-3">
                    <span className="text-[10px] uppercase text-strix-text-muted tracking-wider">Affected URL</span>
                    <div className="text-xs text-strix-accent font-mono mt-0.5 break-all">{v.affectedUrl}</div>
                  </div>
                )}

                {v.description && (
                  <div className="mb-3">
                    <span className="text-[10px] uppercase text-strix-text-muted tracking-wider">Description</span>
                    <div className="mt-1 report-markdown">
                      <ReportMarkdown content={v.description} />
                    </div>
                  </div>
                )}

                {v.proofOfConcept && (
                  <div className="mb-3">
                    <span className="text-[10px] uppercase text-strix-text-muted tracking-wider">Proof of Concept</span>
                    <pre className="mt-1 text-xs bg-strix-bg border border-strix-border-subtle rounded p-3 font-mono text-strix-text-secondary whitespace-pre-wrap break-all overflow-hidden">
                      {v.proofOfConcept}
                    </pre>
                  </div>
                )}

                {v.impact && (
                  <div className="mb-3">
                    <span className="text-[10px] uppercase text-strix-text-muted tracking-wider">Impact</span>
                    <div className="mt-1 report-markdown">
                      <ReportMarkdown content={v.impact} />
                    </div>
                  </div>
                )}

                {v.remediation && (
                  <div className="mb-3">
                    <span className="text-[10px] uppercase text-strix-text-muted tracking-wider">Remediation</span>
                    <div className="mt-1 report-markdown report-markdown-accent">
                      <ReportMarkdown content={v.remediation} />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </section>

          <hr className="border-strix-border-subtle mb-8" />

          {/* Appendix */}
          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">Appendix — Tool Execution Log</h2>
            <div className="bg-strix-card border border-strix-border-subtle rounded-card p-4 font-mono text-xs space-y-0.5 max-h-96 overflow-y-auto">
              {tools.slice(0, 150).map((t) => {
                const dur = t.duration ? `${(t.duration / 1000).toFixed(1)}s` : "...";
                const status = t.status === "completed" ? "OK" : t.status.toUpperCase();
                return (
                  <div key={t.id} className="flex gap-2 text-strix-text-muted">
                    <span className="text-strix-text-muted shrink-0">
                      [{new Date(t.startedAt).toLocaleTimeString()}]
                    </span>
                    <span className="truncate">{t.toolName}</span>
                    <span className={clsx("shrink-0", t.status === "completed" ? "text-strix-accent" : "text-severity-medium")}>
                      ({status}, {dur})
                    </span>
                  </div>
                );
              })}
              {tools.length > 150 && (
                <div className="text-strix-text-muted pt-2">... and {tools.length - 150} more</div>
              )}
            </div>
          </section>

          <div className="text-center text-xs text-strix-text-muted py-8">
            Generated by Strix — AI-Powered Security Testing Framework
          </div>
        </div>

        {/* AI Chat Panel */}
        {chatOpen && (
          <div className="w-96 border-l border-strix-border-subtle bg-strix-card flex flex-col shrink-0">
            {/* Chat header */}
            <div className="h-10 border-b border-strix-border-subtle flex items-center px-3 gap-2 shrink-0">
              {!showSessionList && activeSessionId ? (
                <button onClick={backToSessionList} className="text-strix-text-muted hover:text-white">
                  <ArrowLeft size={16} />
                </button>
              ) : (
                <Bot size={16} className="text-strix-accent" />
              )}
              <span className="text-sm font-medium flex-1 truncate">
                {showSessionList
                  ? "Chat History"
                  : sessions.find((s) => s.id === activeSessionId)?.title || "New Chat"}
              </span>
              {showSessionList && (
                <button
                  onClick={createNewSession}
                  className="text-strix-text-muted hover:text-strix-accent transition-colors"
                  title="New Chat"
                >
                  <Plus size={16} />
                </button>
              )}
              <button onClick={() => setChatOpen(false)} className="text-strix-text-muted hover:text-white">
                <X size={16} />
              </button>
            </div>

            {/* Session list view */}
            {showSessionList ? (
              <div className="flex-1 overflow-y-auto">
                {sessionsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 size={16} className="animate-spin text-strix-text-muted" />
                  </div>
                ) : sessions.length === 0 ? (
                  <div className="text-xs text-strix-text-muted text-center py-8 px-4">
                    <Bot size={24} className="mx-auto mb-2 opacity-40" />
                    No chat sessions yet.
                    <br />Click + to start a new conversation.
                  </div>
                ) : (
                  <div className="divide-y divide-strix-border-subtle">
                    {sessions.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => loadSession(s.id)}
                        className="w-full text-left px-3 py-2.5 hover:bg-strix-elevated transition-colors group"
                      >
                        <div className="flex items-center gap-2">
                          <MessageSquare size={12} className="text-strix-text-muted shrink-0" />
                          <span className="text-xs text-white truncate flex-1">{s.title}</span>
                          <button
                            onClick={(e) => handleDeleteSession(s.id, e)}
                            className="opacity-0 group-hover:opacity-100 text-strix-text-muted hover:text-severity-high transition-all shrink-0"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                        <div className="text-[10px] text-strix-text-muted mt-0.5 ml-5">
                          {formatRelativeTime(s.updatedAt)}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
            {/* Selected text context */}
            {selectedText && (
              <div className="px-3 py-2 border-b border-strix-border-subtle bg-strix-elevated">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] uppercase text-strix-text-muted tracking-wider">Selected Context</span>
                  <button onClick={() => setSelectedText("")} className="text-strix-text-muted hover:text-white">
                    <X size={12} />
                  </button>
                </div>
                <div className="text-xs text-strix-text-secondary line-clamp-3 italic">"{selectedText}"</div>
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {messages.length === 0 && !streamingText && (
                <div className="text-xs text-strix-text-muted text-center py-8">
                  Select text from the report and ask questions about vulnerabilities, impact, or remediation.
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} className={clsx("text-sm", msg.role === "user" ? "text-right" : "")}>
                  {msg.role === "user" ? (
                    <div className={clsx(
                      "inline-block rounded-card px-3 py-2 text-left max-w-[90%]",
                      msg.isExecute
                        ? "bg-severity-high/20 text-severity-high"
                        : "bg-strix-accent/20 text-strix-accent"
                    )}>
                      {msg.isExecute && <Zap size={10} className="inline mr-1 -mt-0.5" />}
                      <UserMessageContent content={msg.content} />
                    </div>
                  ) : msg.blocks ? (
                    <div className="space-y-1.5">
                      {msg.blocks.map((block, bi) =>
                        block.type === "text" && block.text ? (
                          <div key={bi} className="bg-strix-elevated border border-strix-border-subtle rounded-card px-3 py-2">
                            <ChatMarkdown content={block.text} />
                          </div>
                        ) : block.type === "tool" && block.tool ? (
                          <ToolBlockRenderer
                            key={bi}
                            tool={block.tool}
                            toolKey={`${i}-${bi}`}
                            isExpanded={expandedTools.has(`${i}-${bi}`)}
                            onToggle={() => toggleTool(`${i}-${bi}`)}
                            variant="compact"
                          />
                        ) : null
                      )}
                    </div>
                  ) : (
                    <div className="bg-strix-elevated border border-strix-border-subtle rounded-card px-3 py-2">
                      <ChatMarkdown content={msg.content} />
                    </div>
                  )}
                </div>
              ))}

              {/* Execute mode: streaming blocks */}
              {streamBlocks.length > 0 && (
                <div className="space-y-1.5">
                  {streamBlocks.map((block, bi) =>
                    block.type === "text" && block.text ? (
                      <div key={bi} className="bg-strix-elevated border border-strix-border-subtle rounded-card px-3 py-2">
                        <ChatMarkdown content={block.text} />
                        {bi === streamBlocks.length - 1 && (
                          <span className="inline-block w-1.5 h-3 bg-strix-accent animate-pulse ml-0.5" />
                        )}
                      </div>
                    ) : block.type === "tool" && block.tool ? (
                      <ToolBlockRenderer
                        key={bi}
                        tool={block.tool}
                        toolKey={`stream-${bi}`}
                        isExpanded={expandedTools.has(`stream-${bi}`)}
                        onToggle={() => toggleTool(`stream-${bi}`)}
                        variant="compact"
                      />
                    ) : null
                  )}
                </div>
              )}

              {/* Ask mode: streaming text */}
              {streamingText && streamBlocks.length === 0 && (
                <div className="bg-strix-elevated border border-strix-border-subtle rounded-card px-3 py-2">
                  <ChatMarkdown content={streamingText} />
                  <span className="inline-block w-1.5 h-3 bg-strix-accent animate-pulse ml-0.5" />
                </div>
              )}

              {/* Context compaction animation */}
              {compacting && (
                <div className="flex items-center gap-2.5 px-3 py-2.5 bg-strix-elevated border border-strix-accent/20 rounded-lg animate-fade-in">
                  <div className="relative w-6 h-6 shrink-0">
                    <div className="absolute inset-0 rounded-full border-2 border-strix-accent/30 border-t-strix-accent animate-spin" />
                    <div className="absolute inset-2 rounded-full bg-strix-accent/20 animate-pulse" />
                  </div>
                  <div>
                    <div className="text-xs text-white font-medium">Compressing context</div>
                    <div className="text-[10px] text-strix-text-muted">Optimizing conversation memory...</div>
                  </div>
                </div>
              )}

              {/* Loading indicator */}
              {asking && !streamingText && streamBlocks.length === 0 && !compacting && (
                <div className={clsx("flex items-center gap-2 text-xs", streamPhase && executeMode ? "text-severity-high" : streamPhase ? "text-strix-accent" : "text-strix-text-muted")}>
                  <Loader2 size={14} className="animate-spin" />
                  {streamPhase === "init"
                    ? (executeMode ? "Initializing AI agent..." : "Connecting...")
                    : streamPhase === "working"
                      ? (executeMode ? "Executing..." : "Thinking...")
                      : "Thinking..."}
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* Input */}
            <div className="p-3 border-t border-strix-border-subtle">
              <div className="flex gap-2">
                <button
                  onClick={() => setExecuteMode(!executeMode)}
                  disabled={asking}
                  title={executeMode ? "Execute mode: AI will use tools to test" : "Ask mode: AI answers questions only"}
                  className={clsx(
                    "px-2.5 py-2 rounded-btn transition-colors shrink-0 disabled:opacity-50",
                    executeMode
                      ? "bg-severity-high/20 text-severity-high border border-severity-high/30"
                      : "bg-strix-elevated text-strix-text-muted hover:text-strix-accent"
                  )}
                >
                  {executeMode ? <Zap size={14} /> : <MessageSquare size={14} />}
                </button>
                <input
                  ref={inputRef}
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAsk()}
                  placeholder={executeMode ? "Tell AI what to execute..." : "Ask about this report..."}
                  disabled={asking}
                  className={clsx(
                    "flex-1 bg-strix-elevated border rounded-btn px-3 py-2 text-xs text-white placeholder:text-strix-text-muted focus:outline-none transition-colors disabled:opacity-50",
                    executeMode ? "border-severity-high/30 focus:border-severity-high" : "border-strix-border focus:border-strix-accent"
                  )}
                />
                <button
                  onClick={handleAsk}
                  disabled={!question.trim() || asking}
                  className={clsx(
                    "px-3 py-2 rounded-btn disabled:opacity-30 transition-opacity",
                    executeMode ? "bg-severity-high text-white" : "bg-strix-accent text-black"
                  )}
                >
                  {executeMode ? <Zap size={14} /> : <Send size={14} />}
                </button>
              </div>
              {executeMode && (
                <div className="mt-1.5 text-[10px] text-severity-high/70 flex items-center gap-1">
                  <Zap size={10} />
                  Execute mode — AI will use security tools to test
                </div>
              )}
            </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Selection popup */}
      {popup && (
        <div
          className="fixed z-50 animate-fade-in"
          style={{ left: popup.x, top: popup.y, transform: "translate(-50%, -100%)" }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={openChatWithSelection}
            className="flex items-center gap-1.5 bg-strix-accent text-black px-3 py-1.5 rounded-btn text-xs font-medium shadow-lg hover:bg-strix-accent-hover transition-colors"
          >
            <MessageSquare size={12} />
            Ask AI
          </button>
        </div>
      )}
    </div>
  );
}
