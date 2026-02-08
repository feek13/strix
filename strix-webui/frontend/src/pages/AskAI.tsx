import { useState, useEffect, useRef, useCallback, memo, type ComponentPropsWithoutRef } from "react";
import clsx from "clsx";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  MessageSquare, Send, Loader2, Bot, Zap, Plus, Trash2,
  ChevronRight, Check, XCircle, Terminal,
} from "lucide-react";
import type { ChatSession } from "../types";
import * as chatApi from "../lib/chatApi";

interface ToolBlock {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: "running" | "done" | "error";
  result?: string;
}

interface StreamBlock {
  type: "text" | "tool";
  text?: string;
  tool?: ToolBlock;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  isExecute?: boolean;
  blocks?: StreamBlock[];
}

const ChatMarkdown = memo(function ChatMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h3 className="text-sm font-bold text-white mt-3 mb-1.5 first:mt-0">{children}</h3>,
        h2: ({ children }) => <h3 className="text-sm font-bold text-white mt-3 mb-1.5 first:mt-0">{children}</h3>,
        h3: ({ children }) => <h4 className="text-xs font-bold text-white mt-2.5 mb-1 first:mt-0">{children}</h4>,
        h4: ({ children }) => <h4 className="text-xs font-semibold text-strix-text-secondary mt-2 mb-1 first:mt-0">{children}</h4>,
        p: ({ children }) => <p className="text-sm text-strix-text-secondary mb-2 last:mb-0 leading-relaxed">{children}</p>,
        strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
        em: ({ children }) => <em className="text-strix-text-secondary italic">{children}</em>,
        ul: ({ children }) => <ul className="text-sm text-strix-text-secondary mb-2 ml-4 space-y-0.5 list-disc">{children}</ul>,
        ol: ({ children }) => <ol className="text-sm text-strix-text-secondary mb-2 ml-4 space-y-0.5 list-decimal">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        code: ({ className, children, ...props }: ComponentPropsWithoutRef<"code"> & { inline?: boolean }) => {
          const isBlock = className?.includes("language-");
          if (isBlock) {
            return (
              <pre className="bg-strix-bg border border-strix-border-subtle rounded-md p-3 my-2 overflow-x-auto">
                <code className="text-xs font-mono text-strix-accent leading-relaxed">{children}</code>
              </pre>
            );
          }
          return <code className="text-xs font-mono bg-strix-bg text-strix-accent px-1 py-0.5 rounded" {...props}>{children}</code>;
        },
        pre: ({ children }) => <>{children}</>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-strix-accent/40 pl-3 my-2 text-sm text-strix-text-muted italic">{children}</blockquote>
        ),
        hr: () => <hr className="border-strix-border-subtle my-2" />,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-strix-accent hover:underline">{children}</a>
        ),
        table: ({ children }) => (
          <div className="overflow-x-auto my-2">
            <table className="text-xs w-full border-collapse">{children}</table>
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

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function AskAI() {
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(true);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [executeMode, setExecuteMode] = useState(false);
  const [streamBlocks, setStreamBlocks] = useState<StreamBlock[]>([]);
  const [streamPhase, setStreamPhase] = useState<"init" | "working" | "done" | null>(null);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());

  // Load sessions on mount
  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const s = await chatApi.listSessions();
      setSessions(s);
    } catch { /* ignore */ } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // Auto scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText, streamBlocks]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + "px";
    }
  }, [question]);

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
      setExpandedTools(new Set());
      setTimeout(() => inputRef.current?.focus(), 100);
    } catch { /* ignore */ }
  }, []);

  const createNewSession = useCallback(async () => {
    try {
      const session = await chatApi.createSession();
      setSessions((prev) => [session, ...prev]);
      setMessages([]);
      setActiveSessionId(session.id);
      setExpandedTools(new Set());
      setTimeout(() => inputRef.current?.focus(), 100);
    } catch { /* ignore */ }
  }, []);

  const handleDeleteSession = useCallback(async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await chatApi.deleteSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (activeSessionId === sessionId) {
        setActiveSessionId(null);
        setMessages([]);
      }
    } catch { /* ignore */ }
  }, [activeSessionId]);

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

    const isExec = executeMode;
    const userMsg: ChatMessage = { role: "user", content: q, isExecute: isExec };
    setMessages((prev) => [...prev, userMsg]);
    setQuestion("");
    setAsking(true);
    setStreamingText("");
    setStreamBlocks([]);
    setStreamPhase(isExec ? "init" : null);

    // Auto-create session if none active
    let sessionId = activeSessionId;
    if (!sessionId) {
      try {
        const session = await chatApi.createSession(undefined, q.slice(0, 50));
        sessionId = session.id;
        setActiveSessionId(session.id);
        setSessions((prev) => [session, ...prev]);
      } catch { /* ignore */ }
    }

    // Save user message and auto-title
    if (sessionId) {
      try {
        await chatApi.saveMessage(sessionId, { role: "user", content: q, isExecute: isExec });
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
          question: q,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
          mode: isExec ? "execute" : "ask",
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

            if (isExec && evt.type) {
              switch (evt.type) {
                case "init":
                  setStreamPhase("working");
                  break;
                case "text": {
                  const text = evt.text || "";
                  fullText += text;
                  const last = blocks[blocks.length - 1];
                  if (last && last.type === "text") {
                    last.text = (last.text || "") + text;
                  } else {
                    blocks.push({ type: "text", text });
                  }
                  setStreamBlocks([...blocks]);
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
                  setStreamBlocks([...blocks]);
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
                  setStreamBlocks([...blocks]);
                  break;
                }
                case "result":
                  setStreamPhase("done");
                  break;
              }
            } else if (evt.text) {
              fullText += evt.text;
              setStreamingText(fullText);
            }
          } catch (e) {
            if (e instanceof Error && e.message !== "[DONE]") throw e;
          }
        }
      }

      const assistantMsg: ChatMessage = isExec
        ? { role: "assistant", content: fullText, blocks: blocks.length > 0 ? [...blocks] : undefined }
        : { role: "assistant", content: fullText };
      setMessages((prev) => [...prev, assistantMsg]);
      setStreamingText("");
      setStreamBlocks([]);
      setStreamPhase(null);

      if (sessionId) {
        try {
          await chatApi.saveMessage(sessionId, {
            role: "assistant",
            content: fullText,
            blocks: assistantMsg.blocks ? JSON.stringify(assistantMsg.blocks) : undefined,
          });
        } catch { /* ignore */ }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${msg}` }]);
    } finally {
      setAsking(false);
      setStreamingText("");
      setStreamBlocks([]);
      setStreamPhase(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAsk();
    }
  };

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  return (
    <div className="h-full flex animate-fade-in">
      {/* Session sidebar */}
      <div className="w-64 border-r border-strix-border-subtle bg-strix-card flex flex-col shrink-0">
        <div className="h-12 border-b border-strix-border-subtle flex items-center px-3 gap-2 shrink-0">
          <Bot size={16} className="text-strix-accent" />
          <span className="text-sm font-medium flex-1">Chat Sessions</span>
          <button
            onClick={createNewSession}
            className="text-strix-text-muted hover:text-strix-accent transition-colors p-1 rounded hover:bg-strix-elevated"
            title="New Chat"
          >
            <Plus size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {sessionsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={16} className="animate-spin text-strix-text-muted" />
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-xs text-strix-text-muted text-center py-8 px-4">
              No conversations yet.
              <br />Click + to start.
            </div>
          ) : (
            <div className="py-1">
              {sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => loadSession(s.id)}
                  className={clsx(
                    "w-full text-left px-3 py-2.5 transition-colors group",
                    s.id === activeSessionId
                      ? "bg-strix-elevated text-white"
                      : "text-strix-text-secondary hover:bg-strix-elevated/50 hover:text-white"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <MessageSquare size={12} className="shrink-0 opacity-50" />
                    <span className="text-xs truncate flex-1">{s.title}</span>
                    <button
                      onClick={(e) => handleDeleteSession(s.id, e)}
                      className="opacity-0 group-hover:opacity-100 text-strix-text-muted hover:text-severity-high transition-all shrink-0 p-0.5"
                    >
                      <Trash2 size={11} />
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
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeSessionId ? (
          <>
            {/* Chat header */}
            <div className="h-12 border-b border-strix-border-subtle flex items-center px-4 gap-2 shrink-0 bg-strix-card">
              <span className="text-sm font-medium truncate flex-1">
                {activeSession?.title || "New Chat"}
              </span>
              <div className="flex items-center gap-1.5 text-[10px] text-strix-text-muted">
                {activeSession && formatRelativeTime(activeSession.updatedAt)}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto">
              <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
                {messages.length === 0 && !streamingText && !asking && (
                  <div className="text-sm text-strix-text-muted text-center py-16">
                    Ask a question about security, vulnerabilities, or use execute mode to run tests.
                  </div>
                )}

                {messages.map((msg, i) => (
                  <div key={i} className={clsx(msg.role === "user" ? "flex justify-end" : "")}>
                    {msg.role === "user" ? (
                      <div className={clsx(
                        "inline-block rounded-2xl px-4 py-2.5 max-w-[85%] text-sm",
                        msg.isExecute
                          ? "bg-severity-high/20 text-severity-high"
                          : "bg-strix-accent/15 text-strix-accent"
                      )}>
                        {msg.isExecute && <Zap size={12} className="inline mr-1.5 -mt-0.5" />}
                        <span className="whitespace-pre-wrap">{msg.content}</span>
                      </div>
                    ) : msg.blocks ? (
                      <div className="space-y-2 max-w-[95%]">
                        {msg.blocks.map((block, bi) =>
                          block.type === "text" && block.text ? (
                            <div key={bi} className="bg-strix-elevated border border-strix-border-subtle rounded-xl px-4 py-3">
                              <ChatMarkdown content={block.text} />
                            </div>
                          ) : block.type === "tool" && block.tool ? (
                            <div key={bi} className="border border-strix-border-subtle rounded-xl overflow-hidden">
                              <button
                                onClick={() => toggleTool(`${i}-${bi}`)}
                                className="w-full flex items-center gap-2 px-3 py-2 bg-strix-elevated hover:bg-strix-bg transition-colors text-left"
                              >
                                <ChevronRight
                                  size={12}
                                  className={clsx("text-strix-text-muted transition-transform shrink-0", expandedTools.has(`${i}-${bi}`) && "rotate-90")}
                                />
                                <Terminal size={12} className="text-strix-accent shrink-0" />
                                <span className="text-xs font-mono text-strix-text-secondary truncate flex-1">{block.tool.name}</span>
                                {block.tool.status === "done" && <Check size={12} className="text-strix-accent shrink-0" />}
                                {block.tool.status === "error" && <XCircle size={12} className="text-severity-high shrink-0" />}
                              </button>
                              {expandedTools.has(`${i}-${bi}`) && (
                                <div className="border-t border-strix-border-subtle">
                                  <div className="px-3 py-2 bg-strix-bg">
                                    <div className="text-[10px] uppercase text-strix-text-muted tracking-wider mb-1">Input</div>
                                    <pre className="text-xs font-mono text-strix-text-muted overflow-x-auto whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                                      {JSON.stringify(block.tool.input, null, 2)}
                                    </pre>
                                  </div>
                                  {block.tool.result && (
                                    <div className="px-3 py-2 bg-strix-bg border-t border-strix-border-subtle">
                                      <div className="text-[10px] uppercase text-strix-text-muted tracking-wider mb-1">Output</div>
                                      <pre className="text-xs font-mono text-strix-text-muted overflow-x-auto whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
                                        {block.tool.result}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : null
                        )}
                      </div>
                    ) : (
                      <div className="bg-strix-elevated border border-strix-border-subtle rounded-xl px-4 py-3 max-w-[95%]">
                        <ChatMarkdown content={msg.content} />
                      </div>
                    )}
                  </div>
                ))}

                {/* Execute mode: streaming blocks */}
                {streamBlocks.length > 0 && (
                  <div className="space-y-2 max-w-[95%]">
                    {streamBlocks.map((block, bi) =>
                      block.type === "text" && block.text ? (
                        <div key={bi} className="bg-strix-elevated border border-strix-border-subtle rounded-xl px-4 py-3">
                          <ChatMarkdown content={block.text} />
                          {bi === streamBlocks.length - 1 && (
                            <span className="inline-block w-1.5 h-4 bg-strix-accent animate-pulse ml-0.5" />
                          )}
                        </div>
                      ) : block.type === "tool" && block.tool ? (
                        <div key={bi} className={clsx(
                          "border rounded-xl overflow-hidden",
                          block.tool.status === "running" ? "border-severity-high/40" : "border-strix-border-subtle"
                        )}>
                          <button
                            onClick={() => toggleTool(`stream-${bi}`)}
                            className="w-full flex items-center gap-2 px-3 py-2 bg-strix-elevated hover:bg-strix-bg transition-colors text-left"
                          >
                            <ChevronRight
                              size={12}
                              className={clsx("text-strix-text-muted transition-transform shrink-0", expandedTools.has(`stream-${bi}`) && "rotate-90")}
                            />
                            {block.tool.status === "running" ? (
                              <Loader2 size={12} className="text-severity-high animate-spin shrink-0" />
                            ) : (
                              <Terminal size={12} className="text-strix-accent shrink-0" />
                            )}
                            <span className={clsx(
                              "text-xs font-mono truncate flex-1",
                              block.tool.status === "running" ? "text-severity-high" : "text-strix-text-secondary"
                            )}>
                              {block.tool.name}
                            </span>
                            {block.tool.status === "running" && (
                              <span className="text-[10px] text-severity-high/70">running</span>
                            )}
                            {block.tool.status === "done" && <Check size={12} className="text-strix-accent shrink-0" />}
                            {block.tool.status === "error" && <XCircle size={12} className="text-severity-high shrink-0" />}
                          </button>
                          {expandedTools.has(`stream-${bi}`) && (
                            <div className="border-t border-strix-border-subtle">
                              <div className="px-3 py-2 bg-strix-bg">
                                <div className="text-[10px] uppercase text-strix-text-muted tracking-wider mb-1">Input</div>
                                <pre className="text-xs font-mono text-strix-text-muted overflow-x-auto whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                                  {JSON.stringify(block.tool.input, null, 2)}
                                </pre>
                              </div>
                              {block.tool.result && (
                                <div className="px-3 py-2 bg-strix-bg border-t border-strix-border-subtle">
                                  <div className="text-[10px] uppercase text-strix-text-muted tracking-wider mb-1">Output</div>
                                  <pre className="text-xs font-mono text-strix-text-muted overflow-x-auto whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
                                    {block.tool.result}
                                  </pre>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ) : null
                    )}
                  </div>
                )}

                {/* Ask mode: streaming text */}
                {streamingText && streamBlocks.length === 0 && (
                  <div className="bg-strix-elevated border border-strix-border-subtle rounded-xl px-4 py-3 max-w-[95%]">
                    <ChatMarkdown content={streamingText} />
                    <span className="inline-block w-1.5 h-4 bg-strix-accent animate-pulse ml-0.5" />
                  </div>
                )}

                {/* Loading indicator */}
                {asking && !streamingText && streamBlocks.length === 0 && (
                  <div className={clsx("flex items-center gap-2 text-sm", streamPhase ? "text-severity-high" : "text-strix-text-muted")}>
                    <Loader2 size={16} className="animate-spin" />
                    {streamPhase === "init" ? "Initializing AI agent..." : streamPhase === "working" ? "Executing..." : "Thinking..."}
                  </div>
                )}

                <div ref={chatEndRef} />
              </div>
            </div>

            {/* Input bar */}
            <div className="border-t border-strix-border-subtle bg-strix-card p-4">
              <div className="max-w-3xl mx-auto">
                <div className="flex gap-2 items-end">
                  <button
                    onClick={() => setExecuteMode(!executeMode)}
                    disabled={asking}
                    title={executeMode ? "Execute mode: AI will use tools to test" : "Ask mode: AI answers questions only"}
                    className={clsx(
                      "px-2.5 py-2.5 rounded-lg transition-colors shrink-0 disabled:opacity-50",
                      executeMode
                        ? "bg-severity-high/20 text-severity-high border border-severity-high/30"
                        : "bg-strix-elevated text-strix-text-muted hover:text-strix-accent border border-strix-border-subtle"
                    )}
                  >
                    {executeMode ? <Zap size={16} /> : <MessageSquare size={16} />}
                  </button>
                  <textarea
                    ref={inputRef}
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={executeMode ? "Tell AI what to execute..." : "Ask about security, vulnerabilities, or best practices..."}
                    disabled={asking}
                    rows={1}
                    className={clsx(
                      "flex-1 bg-strix-elevated border rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-strix-text-muted focus:outline-none transition-colors disabled:opacity-50 resize-none",
                      executeMode ? "border-severity-high/30 focus:border-severity-high" : "border-strix-border focus:border-strix-accent"
                    )}
                  />
                  <button
                    onClick={handleAsk}
                    disabled={!question.trim() || asking}
                    className={clsx(
                      "px-3 py-2.5 rounded-lg disabled:opacity-30 transition-opacity shrink-0",
                      executeMode ? "bg-severity-high text-white" : "bg-strix-accent text-black"
                    )}
                  >
                    {executeMode ? <Zap size={16} /> : <Send size={16} />}
                  </button>
                </div>
                {executeMode && (
                  <div className="mt-1.5 text-[10px] text-severity-high/70 flex items-center gap-1">
                    <Zap size={10} />
                    Execute mode — AI will use security tools to test
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          /* Empty state — no session selected */
          <div className="flex-1 flex flex-col items-center justify-center text-strix-text-muted">
            <Bot size={48} className="mb-4 opacity-30" />
            <h2 className="text-lg font-medium text-white mb-1">Ask AI</h2>
            <p className="text-sm mb-6 text-center max-w-sm">
              Ask questions about security, analyze vulnerabilities, or execute security tests with AI assistance.
            </p>
            <button
              onClick={createNewSession}
              className="flex items-center gap-2 px-4 py-2 bg-strix-accent text-black rounded-lg text-sm font-medium hover:bg-strix-accent-hover transition-colors"
            >
              <Plus size={16} />
              New Chat
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
