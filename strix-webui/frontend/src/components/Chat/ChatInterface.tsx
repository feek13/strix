import { useState, useEffect, useRef, useCallback, memo, type ComponentPropsWithoutRef } from "react";
import { useNavigate } from "react-router-dom";
import { useScanStore } from "../../store/scanStore";
import { Send, StopCircle, Loader2, Bot, Zap, MessageSquare, RotateCcw } from "lucide-react";
import clsx from "clsx";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ToolBlock, StreamBlock, ChatMessage } from "../../types/chat";
import * as chatApi from "../../lib/chatApi";
import { useTypewriter } from "../../hooks/useTypewriter";
import { ToolBlockRenderer } from "../ToolBlockRenderer";

/** Compact markdown renderer for narrow panel */
const CompactMarkdown = memo(function CompactMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h3 className="text-xs font-bold text-strix-text mt-2 mb-1 first:mt-0">{children}</h3>,
        h2: ({ children }) => <h3 className="text-xs font-bold text-strix-text mt-2 mb-1 first:mt-0">{children}</h3>,
        h3: ({ children }) => <h4 className="text-[11px] font-bold text-strix-text mt-1.5 mb-0.5 first:mt-0">{children}</h4>,
        h4: ({ children }) => <h4 className="text-[11px] font-semibold text-strix-text-secondary mt-1.5 mb-0.5 first:mt-0">{children}</h4>,
        p: ({ children }) => <p className="text-xs text-strix-text-secondary mb-1.5 last:mb-0 leading-relaxed">{children}</p>,
        strong: ({ children }) => <strong className="font-semibold text-strix-text">{children}</strong>,
        em: ({ children }) => <em className="text-strix-text-secondary italic">{children}</em>,
        ul: ({ children }) => <ul className="text-xs text-strix-text-secondary mb-1.5 ml-3 space-y-0.5 list-disc">{children}</ul>,
        ol: ({ children }) => <ol className="text-xs text-strix-text-secondary mb-1.5 ml-3 space-y-0.5 list-decimal">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        code: ({ className, children, ...props }: ComponentPropsWithoutRef<"code"> & { inline?: boolean }) => {
          const isBlock = className?.includes("language-");
          if (isBlock) {
            return (
              <pre className="bg-strix-bg border border-strix-border-subtle rounded p-2 my-1.5 overflow-x-auto">
                <code className="text-[10px] font-mono text-strix-accent leading-relaxed">{children}</code>
              </pre>
            );
          }
          return <code className="text-[10px] font-mono bg-strix-bg text-strix-accent px-0.5 py-px rounded" {...props}>{children}</code>;
        },
        pre: ({ children }) => <>{children}</>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-strix-accent/40 pl-2 my-1.5 text-xs text-strix-text-muted italic">{children}</blockquote>
        ),
        hr: () => <hr className="border-strix-border-subtle my-1.5" />,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-strix-accent hover:underline">{children}</a>
        ),
        table: ({ children }) => (
          <div className="overflow-x-auto my-1.5">
            <table className="text-[10px] w-full border-collapse">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="border-b border-strix-border-subtle">{children}</thead>,
        th: ({ children }) => <th className="text-left px-1.5 py-0.5 text-strix-text-secondary font-semibold">{children}</th>,
        td: ({ children }) => <td className="px-1.5 py-0.5 text-strix-text-muted border-t border-strix-border-subtle/50">{children}</td>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
});

export default function ChatInterface() {
  const navigate = useNavigate();
  const activeScan = useScanStore((s) => s.activeScan);
  const [input, setInput] = useState("");
  const [isStarting, setIsStarting] = useState(false);

  // Chat state (active during scan)
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [executeMode, setExecuteMode] = useState(false);
  const [streamBlocks, setStreamBlocks] = useState<StreamBlock[]>([]);
  const [streamPhase, setStreamPhase] = useState<"init" | "working" | "done" | null>(null);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const [compacting, setCompacting] = useState(false);
  const [isResuming, setIsResuming] = useState(false);

  const typewriter = useTypewriter();
  const streamingText = typewriter.text;

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isScanActive = !!activeScan && activeScan.status === "running";

  // Reset chat state when scan changes
  const prevScanIdRef = useRef<string | null>(null);
  useEffect(() => {
    const scanId = activeScan?.id ?? null;
    if (scanId !== prevScanIdRef.current) {
      prevScanIdRef.current = scanId;
      setMessages([]);
      setSessionId(null);
      setExpandedTools(new Set());
      typewriter.reset();
      setStreamBlocks([]);
      setStreamPhase(null);
      setCompacting(false);
    }
  }, [activeScan?.id, typewriter]);

  // Auto scroll
  const scrollRaf = useRef(0);
  useEffect(() => {
    if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current);
    scrollRaf.current = requestAnimationFrame(() => {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
      scrollRaf.current = 0;
    });
  }, [messages, streamingText, streamBlocks]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 80) + "px";
    }
  }, [input]);

  const toggleTool = useCallback((toolId: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(toolId)) next.delete(toolId);
      else next.add(toolId);
      return next;
    });
  }, []);

  // Start scan (idle mode)
  const handleStartScan = async () => {
    if (!input.trim()) return;
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
    setInput("");
  };

  // Stop scan
  const handleStop = async () => {
    if (!activeScan) return;
    try {
      await fetch(`/api/scans/${activeScan.id}`, { method: "DELETE" });
    } catch (err) {
      console.error("Failed to stop scan:", err);
    }
  };

  // Resume a completed/stopped scan
  const handleResume = async () => {
    if (!activeScan || isResuming) return;
    setIsResuming(true);
    try {
      const res = await fetch(`/api/scans/${activeScan.id}/resume`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        console.error("Failed to resume scan:", err.error);
      }
    } catch (err) {
      console.error("Failed to resume scan:", err);
    } finally {
      setIsResuming(false);
    }
  };

  // Ask AI (scan mode) — SSE streaming
  const handleAsk = async () => {
    const q = input.trim();
    if (!q || asking || !activeScan) return;

    const isExec = executeMode;
    const userMsg: ChatMessage = { role: "user", content: q, isExecute: isExec, createdAt: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setAsking(true);
    typewriter.reset();
    setStreamBlocks([]);
    setStreamPhase(isExec ? "init" : null);
    setCompacting(false);

    // Auto-create session if none exists for this scan
    let sid = sessionId;
    if (!sid) {
      try {
        const session = await chatApi.createSession(activeScan.id, `Scan: ${activeScan.target}`);
        sid = session.id;
        setSessionId(session.id);
      } catch { /* ignore */ }
    }

    // Save user message
    if (sid) {
      try {
        await chatApi.saveMessage(sid, { role: "user", content: q, isExecute: isExec });
      } catch { /* ignore */ }
    }

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          scanId: activeScan.id,
          sessionId: sid,
          mode: isExec ? "execute" : "ask",
          history: messages.map((m) => ({ role: m.role, content: m.content })),
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

      if (pendingFlush) { cancelAnimationFrame(pendingFlush); pendingFlush = 0; }
      typewriter.stop();

      if (fullText || blocks.length > 0) {
        const assistantMsg: ChatMessage = isExec
          ? { role: "assistant", content: fullText, blocks: blocks.length > 0 ? [...blocks] : undefined, createdAt: new Date().toISOString() }
          : { role: "assistant", content: fullText, createdAt: new Date().toISOString() };
        setMessages((prev) => [...prev, assistantMsg]);

        if (sid) {
          try {
            await chatApi.saveMessage(sid, {
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

  const handleSubmit = () => {
    if (isScanActive) {
      handleAsk();
    } else {
      handleStartScan();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // ---- Render: Idle mode (no active scan) ----
  if (!activeScan) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 overflow-y-auto p-3 flex items-center justify-center">
          <div className="text-center text-strix-text-muted text-xs px-4">
            <Bot size={24} className="mx-auto mb-2 opacity-30" />
            Enter a target URL to begin scanning
          </div>
        </div>
        <div className="p-3 border-t border-strix-border-subtle">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleStartScan()}
              placeholder="Enter target URL..."
              className="flex-1 bg-strix-elevated border border-strix-border rounded-btn px-3 py-2 text-sm text-strix-text placeholder:text-strix-text-muted focus:outline-none focus:border-strix-accent"
            />
            <button
              onClick={handleStartScan}
              disabled={!input.trim() || isStarting}
              className={clsx(
                "p-2 rounded-btn transition-colors",
                input.trim() && !isStarting
                  ? "bg-strix-accent text-strix-text-on-accent hover:bg-strix-accent-hover"
                  : "bg-strix-elevated text-strix-text-muted"
              )}
            >
              {isStarting ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Render: Scan mode (scan active — chat interface) ----
  return (
    <div className="flex flex-col h-full">
      {/* Stop scan header */}
      <div className="px-3 py-2 border-b border-strix-border-subtle flex items-center gap-2 shrink-0">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <Bot size={14} className="text-strix-accent shrink-0" />
          <span className="text-xs text-strix-text-secondary truncate">
            {messages.length > 0 ? `${messages.length} messages` : "Ask about this scan"}
          </span>
        </div>
        {activeScan.status === "running" && (
          <button
            onClick={handleStop}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-severity-critical/20 text-severity-critical hover:bg-severity-critical/30 transition-colors shrink-0"
          >
            <StopCircle size={12} />
            Stop
          </button>
        )}
        {(activeScan.status === "completed" || activeScan.status === "stopped") && activeScan.claudeSessionId && (
          <button
            onClick={handleResume}
            disabled={isResuming}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-strix-accent/20 text-strix-accent hover:bg-strix-accent/30 transition-colors shrink-0 disabled:opacity-50"
          >
            {isResuming ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
            Resume
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {messages.length === 0 && !streamingText && !asking && (
          <div className="flex flex-col items-center justify-center h-full text-strix-text-muted px-4">
            <Bot size={20} className="mb-2 opacity-30" />
            <p className="text-[11px] text-center leading-relaxed">
              Ask questions about the scan, vulnerabilities found, or request deeper analysis.
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i}>
            {msg.role === "user" ? (
              <div className="flex justify-end">
                <div className={clsx(
                  "inline-block rounded-xl px-2.5 py-1.5 max-w-[90%] text-xs",
                  msg.isExecute
                    ? "bg-severity-high/20 text-severity-high"
                    : "bg-strix-accent/15 text-strix-accent"
                )}>
                  {msg.isExecute && <Zap size={10} className="inline mr-1 -mt-0.5" />}
                  <span className="whitespace-pre-wrap">{msg.content}</span>
                </div>
              </div>
            ) : msg.blocks ? (
              <div className="space-y-1.5">
                {msg.blocks.map((block, bi) =>
                  block.type === "text" && block.text ? (
                    <div key={bi} className="bg-strix-elevated border border-strix-border-subtle rounded-lg px-2.5 py-2">
                      <CompactMarkdown content={block.text} />
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
              <div className="bg-strix-elevated border border-strix-border-subtle rounded-lg px-2.5 py-2">
                <CompactMarkdown content={msg.content} />
              </div>
            )}
          </div>
        ))}

        {/* Execute mode: streaming blocks */}
        {streamBlocks.length > 0 && (
          <div className="space-y-1.5">
            {streamBlocks.map((block, bi) =>
              block.type === "text" && block.text ? (
                <div key={bi} className="bg-strix-elevated border border-strix-border-subtle rounded-lg px-2.5 py-2">
                  <CompactMarkdown content={block.text} />
                  {bi === streamBlocks.length - 1 && (
                    <span className="inline-block w-1 h-3 bg-strix-accent animate-pulse ml-0.5" />
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
          <div className="bg-strix-elevated border border-strix-border-subtle rounded-lg px-2.5 py-2">
            <CompactMarkdown content={streamingText} />
            <span className="inline-block w-1 h-3 bg-strix-accent animate-pulse ml-0.5" />
          </div>
        )}

        {/* Context compaction */}
        {compacting && (
          <div className="flex items-center gap-2 px-2.5 py-2 bg-strix-elevated border border-strix-accent/20 rounded-lg animate-fade-in">
            <div className="relative w-5 h-5 shrink-0">
              <div className="absolute inset-0 rounded-full border-2 border-strix-accent/30 border-t-strix-accent animate-spin" />
            </div>
            <div className="text-[10px] text-strix-text-muted">Compressing context...</div>
          </div>
        )}

        {/* Loading indicator */}
        {asking && !streamingText && streamBlocks.length === 0 && !compacting && (
          <div className={clsx("flex items-center gap-1.5 text-xs px-1", executeMode ? "text-severity-high" : "text-strix-text-muted")}>
            <Loader2 size={12} className="animate-spin" />
            {streamPhase === "init"
              ? (executeMode ? "Initializing..." : "Connecting...")
              : streamPhase === "working"
                ? (executeMode ? "Executing..." : "Thinking...")
                : "Thinking..."}
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="p-2 border-t border-strix-border-subtle">
        <div className="flex gap-1.5 items-end">
          <button
            onClick={() => setExecuteMode(!executeMode)}
            disabled={asking}
            title={executeMode ? "Execute mode: AI will use tools" : "Ask mode: AI answers questions"}
            className={clsx(
              "p-1.5 rounded transition-colors shrink-0 disabled:opacity-50",
              executeMode
                ? "bg-severity-high/20 text-severity-high border border-severity-high/30"
                : "bg-strix-elevated text-strix-text-muted hover:text-strix-accent border border-strix-border-subtle"
            )}
          >
            {executeMode ? <Zap size={14} /> : <MessageSquare size={14} />}
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={executeMode ? "Tell AI what to execute..." : "Ask about this scan..."}
            disabled={asking}
            rows={1}
            className={clsx(
              "flex-1 bg-strix-elevated border rounded-btn px-2.5 py-1.5 text-xs text-strix-text placeholder:text-strix-text-muted focus:outline-none transition-colors disabled:opacity-50 resize-none",
              executeMode ? "border-severity-high/30 focus:border-severity-high" : "border-strix-border focus:border-strix-accent"
            )}
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || asking}
            className={clsx(
              "p-1.5 rounded-btn disabled:opacity-30 transition-opacity shrink-0",
              executeMode ? "bg-severity-high text-strix-text-on-accent" : "bg-strix-accent text-strix-text-on-accent"
            )}
          >
            {executeMode ? <Zap size={14} /> : <Send size={14} />}
          </button>
        </div>
        {executeMode && (
          <div className="mt-1 text-[9px] text-severity-high/70 flex items-center gap-1 pl-8">
            <Zap size={8} />
            Execute mode — AI will use tools
          </div>
        )}
      </div>
    </div>
  );
}
