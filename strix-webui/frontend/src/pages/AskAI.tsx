import { useState, useEffect, useRef, useCallback } from "react";
import clsx from "clsx";
import {
  MessageSquare, Send, Loader2, Zap, Plus, Trash2,
  FolderOpen, Download, Square, Menu,
} from "lucide-react";
import MobileDrawer from "../components/Layout/MobileDrawer";
import { useIsMobile } from "../hooks/useIsMobile";
import type { ChatSession } from "../types";
import type { ToolBlock, StreamBlock, ChatMessage } from "../types/chat";
import * as chatApi from "../lib/chatApi";
import { API_BASE_URL } from "../lib/config";
import { generateChatMarkdown, type ExportMessage } from "../lib/chatExport";
import { parseReportContext } from "../lib/chatUtils";
import { formatRelativeTime } from "../lib/dateUtils";
import { useTypewriter } from "../hooks/useTypewriter";
import { ChatMarkdown } from "../components/Chat/ChatMarkdown";
import { UserMessageContent } from "../components/Chat/UserMessageContent";
import { ToolBlockRenderer } from "../components/ToolBlockRenderer";
import { StrixIcon } from "../components/ui/StrixIcon";
import ExportPreviewModal from "../components/ExportPreviewModal";
import ScanLaunchProgress, { type PreflightStep } from "../components/ScanLaunchProgress";

export default function AskAI() {
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const isMobile = useIsMobile();
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false);

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(true);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [executeMode, setExecuteMode] = useState(false);
  const [streamBlocks, setStreamBlocks] = useState<StreamBlock[]>([]);
  const [streamPhase, setStreamPhase] = useState<"init" | "working" | "done" | null>(null);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const [compacting, setCompacting] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [preflightSteps, setPreflightSteps] = useState<PreflightStep[]>([]);

  const typewriter = useTypewriter();
  const streamingText = typewriter.text;

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

  // Abort in-flight streaming fetch on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  // Auto scroll (debounced to once per frame)
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
        createdAt: m.createdAt,
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

  const toggleTool = useCallback((toolId: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(toolId)) next.delete(toolId);
      else next.add(toolId);
      return next;
    });
  }, []);

  // Ask AI with SSE streaming
  const handleAsk = async () => {
    const q = question.trim();
    if (!q || asking) return;

    // Handle slash commands
    if (q.startsWith("/")) {
      const cmd = q.split(" ")[0].toLowerCase();
      switch (cmd) {
        case "/status": {
          setQuestion("");
          const s = sessions.find((s) => s.id === activeSessionId);
          const statusMsg: ChatMessage = {
            role: "assistant",
            content: s
              ? `**Session Status**\n- **Session ID**: \`${s.id.slice(0, 8)}...\`\n- **Claude Session**: ${s.claudeSessionId ? `\`${s.claudeSessionId.slice(0, 8)}...\` (resumable)` : "Not initialized"}\n- **Working Directory**: ${s.cwd || "Default (home)"}\n- **Messages**: ${messages.length}\n- **Created**: ${new Date(s.createdAt).toLocaleString()}`
              : "No active session.",
          };
          setMessages((prev) => [...prev, statusMsg]);
          return;
        }
        case "/clear":
          setQuestion("");
          setMessages([]);
          return;
      }
      // Other commands pass through to Claude
    }

    const isExec = executeMode;
    const userMsg: ChatMessage = { role: "user", content: q, isExecute: isExec, createdAt: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);
    setQuestion("");
    setAsking(true);
    typewriter.reset();
    setStreamBlocks([]);
    setStreamPhase(isExec ? "init" : null);
    setCompacting(false);
    setPreflightSteps(isExec ? [
      { step: 1, totalSteps: 3, id: "docker", label: "Docker Engine", status: "pending" },
      { step: 2, totalSteps: 3, id: "image", label: "Sandbox Image", status: "pending" },
      { step: 3, totalSteps: 3, id: "launch", label: "MCP Tools", status: "pending" },
    ] : []);

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

    // Declared outside try so catch can save partial responses on stream error
    let fullText = "";
    const blocks: StreamBlock[] = [];

    try {
      const controller = new AbortController();
      abortRef.current = controller;

      const res = await fetch(`${API_BASE_URL}/api/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          sessionId,
          mode: isExec ? "execute" : "ask",
          // Always send history — backend decides whether to use it
          // (needed when mode changes and a new CLI session is created)
          // Strip report-context delimiters from user messages to avoid bloating the prompt
          history: messages.map((m) => ({
            role: m.role,
            content: m.role === "user" ? parseReportContext(m.content).question : m.content,
          })),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Request failed");
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let lastStepTransitionAt = 0;
      const stepTransitions: Record<string, string> = {};
      const ensureStepDelay = async (minMs: number) => {
        if (lastStepTransitionAt > 0) {
          const elapsed = Date.now() - lastStepTransitionAt;
          if (elapsed < minMs) {
            await new Promise((r) => setTimeout(r, minMs - elapsed));
          }
        }
        lastStepTransitionAt = Date.now();
      };
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
                case "preflight_step": {
                  const prevStepStatus = stepTransitions[evt.id];
                  if (prevStepStatus !== evt.status) {
                    await ensureStepDelay(evt.status === "running" ? 100 : 350);
                    stepTransitions[evt.id] = evt.status;
                  }
                  setPreflightSteps((prev) =>
                    prev.map((s) =>
                      s.id === evt.id
                        ? { ...s, status: evt.status, detail: evt.detail }
                        : s
                    )
                  );
                  break;
                }
                case "preflight_done":
                  // All preflight done, mark step 3 (MCP Tools) as running
                  await ensureStepDelay(100);
                  stepTransitions["launch"] = "running";
                  setPreflightSteps((prev) =>
                    prev.map((s) =>
                      s.id === "launch"
                        ? { ...s, status: "running", detail: "Loading MCP tools..." }
                        : s
                    )
                  );
                  break;
                case "init":
                  // Claude CLI initialized — MCP tools loaded
                  await ensureStepDelay(350);
                  setPreflightSteps((prev) =>
                    prev.map((s) =>
                      s.id === "launch"
                        ? { ...s, status: "done" }
                        : s
                    )
                  );
                  // Clear preflight after a short delay for visual feedback
                  setTimeout(() => setPreflightSteps([]), 600);
                  setStreamPhase("working");
                  break;
                case "compacting":
                  setCompacting(true);
                  break;
                case "text": {
                  const text = evt.text || "";
                  fullText += text;
                  // Compaction done once text starts flowing again
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
                    // Typewriter animation for ask mode
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
          ? { role: "assistant", content: fullText, blocks: blocks.length > 0 ? [...blocks] : undefined, createdAt: new Date().toISOString() }
          : { role: "assistant", content: fullText, createdAt: new Date().toISOString() };
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
      const isAbort = err instanceof DOMException && err.name === "AbortError";

      // Mark any still-running tools as stopped
      for (const block of blocks) {
        if (block.type === "tool" && block.tool && block.tool.status === "running") {
          block.tool.status = "error";
          block.tool.result = "Stopped by user";
        }
      }

      // Save partial assistant response if any was accumulated before stop/error
      if ((fullText.trim() || blocks.length > 0) && sessionId) {
        const partialMsg: ChatMessage = {
          role: "assistant",
          content: fullText,
          blocks: blocks.length > 0 ? [...blocks] : undefined,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, partialMsg]);
        try {
          await chatApi.saveMessage(sessionId, {
            role: "assistant",
            content: fullText,
            blocks: partialMsg.blocks ? JSON.stringify(partialMsg.blocks) : undefined,
          });
        } catch { /* ignore save error */ }
      }

      if (!isAbort) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${msg}` }]);
      }
    } finally {
      abortRef.current = null;
      setAsking(false);
      typewriter.reset();
      setStreamBlocks([]);
      setStreamPhase(null);
      setCompacting(false);
      setPreflightSteps([]);
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAsk();
    }
  };

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  const sessionListContent = (
    <>
      <div className="h-12 border-b border-strix-border-subtle flex items-center px-3 gap-2 shrink-0">
        <StrixIcon size={16} className="text-strix-accent" />
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
                onClick={() => { loadSession(s.id); setSessionDrawerOpen(false); }}
                className={clsx(
                  "w-full text-left px-3 py-2.5 transition-colors group",
                  s.id === activeSessionId
                    ? "bg-strix-elevated text-strix-text"
                    : "text-strix-text-secondary hover:bg-strix-elevated/50 hover:text-strix-text"
                )}
              >
                <div className="flex items-center gap-2">
                  <span className={clsx(
                    "w-2 h-2 rounded-full shrink-0",
                    s.claudeSessionId ? "bg-strix-accent" : "bg-strix-text-muted/40"
                  )} title={s.claudeSessionId ? "Resumable session" : "Not initialized"} />
                  <span className="text-xs truncate flex-1">{s.title}</span>
                  <button
                    onClick={(e) => handleDeleteSession(s.id, e)}
                    className="opacity-0 group-hover:opacity-100 text-strix-text-muted hover:text-severity-high transition-all shrink-0 p-0.5"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
                <div className="text-[10px] text-strix-text-muted mt-0.5 ml-4 flex items-center gap-1.5">
                  <span>{formatRelativeTime(s.updatedAt)}</span>
                  {s.cwd && (
                    <>
                      <span className="opacity-30">|</span>
                      <span className="truncate" title={s.cwd}>{s.cwd.replace(/^\/Users\/[^/]+/, "~")}</span>
                    </>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="h-full flex animate-fade-in">
      {/* Session sidebar - desktop inline, mobile drawer */}
      {isMobile ? (
        <MobileDrawer isOpen={sessionDrawerOpen} onClose={() => setSessionDrawerOpen(false)} side="left" width="w-72">
          {sessionListContent}
        </MobileDrawer>
      ) : (
        <div className="w-64 border-r border-strix-border-subtle bg-strix-card flex flex-col shrink-0">
          {sessionListContent}
        </div>
      )}

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeSessionId ? (
          <>
            {/* Chat header */}
            <div className="h-12 border-b border-strix-border-subtle flex items-center px-4 gap-2 shrink-0 bg-strix-card">
              {isMobile && (
                <button
                  onClick={() => setSessionDrawerOpen(true)}
                  className="p-1 -ml-1 text-strix-text-secondary hover:text-strix-text transition-colors shrink-0"
                  aria-label="Open sessions"
                >
                  <Menu size={18} />
                </button>
              )}
              <span className="text-sm font-medium truncate flex-1">
                {activeSession?.title || "New Chat"}
              </span>
              {activeSession?.cwd && (
                <div className="flex items-center gap-1 text-[10px] text-strix-text-muted" title={activeSession.cwd}>
                  <FolderOpen size={10} />
                  <span className="truncate max-w-[150px]">{activeSession.cwd.replace(/^\/Users\/[^/]+/, "~")}</span>
                </div>
              )}
              {activeSession?.claudeSessionId && (
                <span className="text-[10px] text-strix-accent/60 bg-strix-accent/10 px-1.5 py-0.5 rounded" title="Persistent Claude CLI session">
                  resumable
                </span>
              )}
              {messages.length > 0 && (
                <button
                  onClick={() => setShowExport(true)}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] text-strix-text-muted hover:text-strix-accent bg-strix-elevated hover:bg-strix-bg border border-strix-border-subtle rounded-md transition-colors"
                  title="Export chat"
                >
                  <Download size={10} />
                  Export
                </button>
              )}
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
                        <UserMessageContent content={msg.content} />
                      </div>
                    ) : msg.blocks ? (
                      <div className="space-y-2 max-w-[95%]">
                        {msg.blocks.map((block, bi) =>
                          block.type === "text" && block.text ? (
                            <div key={bi} className="bg-strix-elevated border border-strix-border-subtle rounded-xl px-4 py-3">
                              <ChatMarkdown content={block.text} />
                            </div>
                          ) : block.type === "tool" && block.tool ? (
                            <ToolBlockRenderer
                              key={bi}
                              tool={block.tool}
                              toolKey={`${i}-${bi}`}
                              isExpanded={expandedTools.has(`${i}-${bi}`)}
                              onToggle={() => toggleTool(`${i}-${bi}`)}
                            />
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
                        <ToolBlockRenderer
                          key={bi}
                          tool={block.tool}
                          toolKey={`stream-${bi}`}
                          isExpanded={expandedTools.has(`stream-${bi}`)}
                          onToggle={() => toggleTool(`stream-${bi}`)}
                        />
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

                {/* Context compaction animation */}
                {compacting && (
                  <div className="flex items-center gap-3 px-4 py-3 bg-strix-elevated border border-strix-accent/20 rounded-xl animate-fade-in">
                    <div className="relative w-8 h-8 shrink-0">
                      <div className="absolute inset-0 rounded-full border-2 border-strix-accent/30 border-t-strix-accent animate-spin" />
                      <div className="absolute inset-2.5 rounded-full bg-strix-accent/20 animate-pulse" />
                    </div>
                    <div>
                      <div className="text-sm text-strix-text font-medium">Compressing context</div>
                      <div className="text-xs text-strix-text-muted">Optimizing conversation memory...</div>
                    </div>
                  </div>
                )}

                {/* Docker preflight progress (execute mode) */}
                {preflightSteps.length > 0 && (
                  <div className="max-w-md mx-auto">
                    <ScanLaunchProgress steps={preflightSteps} />
                  </div>
                )}

                {/* Loading indicator */}
                {asking && !streamingText && streamBlocks.length === 0 && !compacting && preflightSteps.length === 0 && (
                  <div className={clsx("flex items-center gap-2 text-sm", streamPhase && executeMode ? "text-severity-high" : streamPhase ? "text-strix-accent" : "text-strix-text-muted")}>
                    <Loader2 size={16} className="animate-spin" />
                    {streamPhase === "init"
                      ? (executeMode ? "Initializing AI agent..." : "Connecting...")
                      : streamPhase === "working"
                        ? (executeMode ? "Executing..." : "Thinking...")
                        : "Thinking..."}
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
                      "flex-1 bg-strix-elevated border rounded-lg px-4 py-2.5 text-sm text-strix-text placeholder:text-strix-text-muted focus:outline-none transition-colors disabled:opacity-50 resize-none",
                      executeMode ? "border-severity-high/30 focus:border-severity-high" : "border-strix-border focus:border-strix-accent"
                    )}
                  />
                  {asking ? (
                    <button
                      onClick={handleStop}
                      className="px-3 py-2.5 rounded-lg bg-strix-elevated border border-strix-border-subtle text-strix-text-secondary hover:text-strix-text hover:border-severity-critical/50 hover:bg-severity-critical/10 transition-colors shrink-0"
                      title="Stop generating"
                    >
                      <Square size={16} />
                    </button>
                  ) : (
                    <button
                      onClick={handleAsk}
                      disabled={!question.trim()}
                      className={clsx(
                        "px-3 py-2.5 rounded-lg disabled:opacity-30 transition-opacity shrink-0",
                        executeMode ? "bg-severity-high text-strix-text-on-accent" : "bg-strix-accent text-strix-text-on-accent"
                      )}
                    >
                      {executeMode ? <Zap size={16} /> : <Send size={16} />}
                    </button>
                  )}
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
          <div className="flex-1 flex flex-col items-center justify-center text-strix-text-muted px-4">
            <StrixIcon size={48} className="mb-4 opacity-30" />
            <h2 className="text-lg font-medium text-strix-text mb-1">Ask AI</h2>
            <p className="text-sm mb-6 text-center max-w-sm">
              Ask questions about security, analyze vulnerabilities, or execute security tests with AI assistance.
            </p>
            <div className="flex gap-3">
              <button
                onClick={createNewSession}
                className="flex items-center gap-2 px-4 py-2 bg-strix-accent text-strix-text-on-accent rounded-lg text-sm font-medium hover:bg-strix-accent-hover transition-colors"
              >
                <Plus size={16} />
                New Chat
              </button>
              {isMobile && sessions.length > 0 && (
                <button
                  onClick={() => setSessionDrawerOpen(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-strix-elevated text-strix-text-secondary rounded-lg text-sm font-medium hover:text-strix-text transition-colors"
                >
                  <Menu size={16} />
                  Sessions
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {activeSessionId && (
        <ExportPreviewModal
          isOpen={showExport}
          onClose={() => setShowExport(false)}
          sessionId={activeSessionId}
          sessionTitle={activeSession?.title || "Chat"}
          markdownContent={generateChatMarkdown(
            activeSession?.title || "Chat",
            messages as ExportMessage[],
            activeSession?.createdAt,
          )}
        />
      )}
    </div>
  );
}
