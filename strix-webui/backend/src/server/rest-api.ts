import express from "express";
import cors from "cors";
import { join } from "path";
import { homedir } from "os";
import { readFileSync, existsSync } from "fs";
import { spawn } from "child_process";
import { store } from "../store/sqlite-store.js";
import { startScan, stopScan, getActiveScan } from "./scan-manager.js";
import { generatePDFReport } from "../reports/pdf-generator.js";
import { generateChatPDF } from "../reports/chat-pdf-generator.js";
import { generateChatDOCX } from "../reports/chat-docx-generator.js";
import { randomUUID } from "crypto";
import type { Scan } from "@strix-webui/shared";

// In-memory map of active SSE streams for Ask AI sessions
// Key: web session ID, Value: active SSE response
const activeAskStreams = new Map<string, express.Response>();

export function createRestServer(port: number = 3000): express.Application {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", activeScan: getActiveScan()?.scan.id || null });
  });

  // Start new scan
  app.post("/api/scans", (req, res) => {
    try {
      const { target, targetType, mode, timeoutMinutes } = req.body;

      if (!target) {
        res.status(400).json({ error: "Target is required" });
        return;
      }

      // Auto-detect target type
      let type: Scan["targetType"] = targetType || "url";
      if (!targetType) {
        if (target.includes("github.com")) type = "github";
        else if (target.startsWith("/") || target.startsWith("./") || target.startsWith("~")) type = "local";
        else type = "url";
      }

      const scan = startScan(target, type, mode || "auto", timeoutMinutes);
      res.json(scan);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(409).json({ error: message });
    }
  });

  // List scans
  app.get("/api/scans", (_req, res) => {
    const scans = store.getAllScans();
    res.json(scans);
  });

  // Get scan detail
  app.get("/api/scans/:id", (req, res) => {
    const scan = store.getScan(req.params.id);
    if (!scan) {
      res.status(404).json({ error: "Scan not found" });
      return;
    }

    const agents = store.getAgentsByScan(scan.id);
    const tools = store.getToolsByScan(scan.id);
    const vulnerabilities = store.getVulnsByScan(scan.id);
    const logs = store.getRecentLogs(scan.id, 200);

    res.json({ scan, agents, tools, vulnerabilities, logs });
  });

  // Stop scan
  app.delete("/api/scans/:id", (req, res) => {
    const success = stopScan(req.params.id);
    if (success) {
      res.json({ message: "Scan stopped" });
    } else {
      res.status(404).json({ error: "Active scan not found" });
    }
  });

  // Get scan report (PDF)
  app.get("/api/scans/:id/report", async (req, res) => {
    const scan = store.getScan(req.params.id);
    if (!scan) {
      res.status(404).json({ error: "Scan not found" });
      return;
    }

    const vulnerabilities = store.getVulnsByScan(scan.id);
    const agents = store.getAgentsByScan(scan.id);
    const tools = store.getToolsByScan(scan.id);

    try {
      const pdfBuffer = await generatePDFReport(scan, vulnerabilities, agents, tools);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="strix-report-${scan.id.slice(0, 8)}.pdf"`);
      res.send(pdfBuffer);
    } catch (error) {
      console.error("PDF generation error:", error);
      res.status(500).json({ error: "Failed to generate report" });
    }
  });

  // Report preview (JSON summary)
  app.get("/api/scans/:id/report/preview", (req, res) => {
    const scan = store.getScan(req.params.id);
    if (!scan) {
      res.status(404).json({ error: "Scan not found" });
      return;
    }

    const vulnerabilities = store.getVulnsByScan(scan.id);
    const agents = store.getAgentsByScan(scan.id);
    const tools = store.getToolsByScan(scan.id);

    const severityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const v of vulnerabilities) {
      severityCounts[v.severity]++;
    }

    res.json({
      scan,
      summary: {
        totalFindings: vulnerabilities.length,
        severityCounts,
        totalAgents: agents.length,
        totalTools: tools.length,
        duration: scan.completedAt && scan.startedAt
          ? new Date(scan.completedAt).getTime() - new Date(scan.startedAt).getTime()
          : null,
      },
      vulnerabilities,
    });
  });

  // Fetch truncated content
  app.get("/api/tools/content/:contentId", (req, res) => {
    const contentPath = join(homedir(), ".strix-webui", "content", `${req.params.contentId}.json`);
    if (!existsSync(contentPath)) {
      res.status(404).json({ error: "Content not found" });
      return;
    }
    try {
      const content = JSON.parse(readFileSync(contentPath, "utf-8"));
      res.json(content);
    } catch {
      res.status(500).json({ error: "Failed to read content" });
    }
  });

  // Internal endpoint: PreCompact hook notifies that compaction is starting
  app.post("/api/internal/compacting", (req, res) => {
    const { chatSessionId, trigger } = req.body;
    const sseResponse = activeAskStreams.get(chatSessionId);
    if (sseResponse) {
      sseResponse.write(`data: ${JSON.stringify({ type: "compacting", trigger })}\n\n`);
    }
    res.json({ ok: true });
  });

  // Ask AI about the report (SSE streaming via Claude Code CLI)
  // Now session-aware: uses --session-id/--resume for persistent Claude CLI sessions
  app.post("/api/ask", (req, res) => {
    const { scanId, selectedText, question, history, mode, sessionId: webSessionId } = req.body;
    if (!question) {
      res.status(400).json({ error: "Question is required" });
      return;
    }

    const isExecute = mode === "execute";

    // Look up web session to get claudeSessionId if available
    let session: ReturnType<typeof store.getChatSessionById> | undefined;
    if (webSessionId) {
      session = store.getChatSessionById(webSessionId);
    }

    const currentMode = isExecute ? "execute" : "ask";
    // Resume only if we have a CLI session AND it was created in the same mode
    const modeChanged = !!(session?.claudeSessionId && session.claudeSessionMode !== currentMode);
    const isResume = !!(session?.claudeSessionId) && !modeChanged;

    if (modeChanged) {
      console.log(`[Ask AI] Mode changed from ${session!.claudeSessionMode} to ${currentMode}, creating new CLI session`);
    }

    // Gather scan context (only needed for first message or mode change)
    let context = "";
    if (!isResume && scanId) {
      const scan = store.getScan(scanId);
      if (scan) {
        const vulns = store.getVulnsByScan(scanId);
        context += `## Scan Context\nTarget: ${scan.target} (${scan.targetType})\nStatus: ${scan.status}\nMode: ${scan.mode}\n`;
        if (vulns.length > 0) {
          context += `\n## Vulnerabilities Found (${vulns.length})\n`;
          for (const v of vulns) {
            context += `\n### [${v.severity.toUpperCase()}] ${v.title}\n`;
            if (v.affectedUrl) context += `Affected URL: ${v.affectedUrl}\n`;
            if (v.description) context += `Description: ${v.description}\n`;
            if (v.proofOfConcept) context += `PoC: ${v.proofOfConcept}\n`;
            if (v.impact) context += `Impact: ${v.impact}\n`;
            if (v.remediation) context += `Remediation: ${v.remediation}\n`;
          }
        }
      }
    }

    // Build prompt
    let prompt: string;

    if (isResume) {
      // RESUME: Claude CLI has full context, just send the new question
      prompt = isExecute ? `Task: ${question}` : question;
      if (selectedText) {
        prompt = `[Selected text from report]: "${selectedText}"\n\n${prompt}`;
      }
    } else {
      // NEW session: include system prompt, context, and history
      const systemPrompt = isExecute
        ? [
            `You are Strix, an autonomous security testing agent. Execute the requested security test using your available tools. Report findings clearly with evidence.`,
            ``,
            `## MANDATORY Rules — violating these causes failures`,
            ``,
            `### 1. Sequential tool calls ONLY`,
            `NEVER make parallel/simultaneous tool calls. Always call ONE tool at a time. Parallel calls cause "Sibling tool call errored" failures that waste turns.`,
            ``,
            `### 2. NEVER use python3 -c for multi-line code`,
            `Inline python3 -c with double quotes causes \\! escaping bugs (SyntaxError: unexpected character after line continuation). ALWAYS do this instead:`,
            `- Step 1: Use the Write tool to write a .py file to /tmp/strix_script.py`,
            `- Step 2: Use Bash to run: python3 /tmp/strix_script.py`,
            ``,
            `### 3. Bash escaping`,
            `You are running in a non-interactive shell. History expansion is DISABLED. The ! character does NOT need escaping. Never write \\! — just write != directly.`,
            `Use single quotes for curl headers and URLs. Example:`,
            `  curl -s 'http://target/api' -H 'apikey: xxx' -H 'Authorization: Bearer xxx'`,
            ``,
            `### 4. Error recovery`,
            `If a command fails, analyze the error, fix the root cause, then retry. Do not repeat the same failing command.`,
          ].join("\n")
        : `You are a security expert assistant analyzing a penetration testing report generated by Strix. Answer questions about the vulnerabilities, their impact, remediation strategies, and security best practices. Be concise and technical.`;

      prompt = `${systemPrompt}\n\n${context}\n`;

      if (Array.isArray(history) && history.length > 0) {
        prompt += "\nPrevious conversation:\n";
        for (const msg of history) {
          prompt += `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}\n`;
        }
        prompt += "\n";
      }

      if (selectedText) {
        prompt += `[Selected text from report]: "${selectedText}"\n\n`;
      }
      prompt += isExecute ? `Task: ${question}` : `Question: ${question}`;
    }

    // Set up SSE — disable compression/buffering to keep connection alive
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // Send initial keepalive so client knows connection is established
    res.write(": connected\n\n");

    console.log(`[Ask AI] Spawning claude in ${isExecute ? "EXECUTE" : "ASK"} mode, ${isResume ? "RESUME" : "NEW"} session (${prompt.length} chars)`);

    // Build spawn args based on mode and session state
    const args: string[] = [];

    // Session management: --resume for existing sessions, --session-id for new ones
    let claudeSessionId: string;
    if (isResume) {
      claudeSessionId = session!.claudeSessionId!;
      args.push("--resume", claudeSessionId);
    } else {
      claudeSessionId = randomUUID();
      args.push("--session-id", claudeSessionId);
    }

    // Both modes use stream-json for real-time token streaming
    // stream-json requires --verbose in print mode
    args.push("--output-format", "stream-json", "--verbose");

    // Skip MCP server loading for both modes — built-in tools (Bash, Read,
    // Write, Glob, Grep, Edit) are always available and sufficient for Ask AI.
    // MCP initialization can hang for minutes (especially if Docker is down).
    // Full MCP tools are available through the dedicated Scan feature.
    args.push("--mcp-config", '{"mcpServers":{}}', "--strict-mcp-config");

    if (isExecute) {
      args.push("--dangerously-skip-permissions");
      args.push("--max-turns", "50");
    } else {
      // Ask mode: lightweight Q&A, no tool execution, fast model
      args.push("--max-turns", "1");
      args.push("--model", "sonnet");
    }

    // Register SSE stream for compaction notifications
    if (webSessionId) {
      activeAskStreams.set(webSessionId, res);
    }

    let finished = false;
    const child = spawn("claude", args, {
      env: {
        ...process.env,
        ...(webSessionId ? { STRIX_CHAT_SESSION_ID: webSessionId } : {}),
      },
      cwd: session?.cwd || process.env.HOME || homedir(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Pass prompt via stdin (works with both --session-id and --resume)
    child.stdin.write(prompt);
    child.stdin.end();

    // Send heartbeat every 5s to keep connection alive
    const heartbeat = setInterval(() => {
      if (!finished) res.write(": heartbeat\n\n");
    }, 5000);

    // Timeout: 10 min for execute mode, 3 min for ask mode
    const timeoutMs = isExecute ? 10 * 60 * 1000 : 3 * 60 * 1000;
    const timeout = setTimeout(() => {
      if (!finished) {
        console.log(`[Ask AI] ${isExecute ? "Execute" : "Ask"} timeout (${timeoutMs / 60000} min), killing process`);
        child.kill("SIGTERM");
      }
    }, timeoutMs);

    // Parse stream-json events and forward as typed SSE messages (both modes)
    let jsonBuffer = "";
    let textSent = false;
    let stderrBuffer = "";
    child.stdout.on("data", (data: Buffer) => {
      jsonBuffer += data.toString();
      const lines = jsonBuffer.split("\n");
      jsonBuffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);

          if (event.type === "system" && event.subtype === "init") {
            res.write(`data: ${JSON.stringify({ type: "init" })}\n\n`);
          } else if (event.type === "assistant") {
            const content = event.message?.content || [];
            for (const block of content) {
              if (block.type === "text") {
                textSent = true;
                res.write(`data: ${JSON.stringify({ type: "text", text: block.text })}\n\n`);
              } else if (block.type === "tool_use") {
                res.write(`data: ${JSON.stringify({
                  type: "tool_use",
                  name: block.name,
                  toolUseId: block.id,
                  input: block.input,
                })}\n\n`);
              }
            }
          } else if (event.type === "user") {
            const content = event.message?.content || [];
            for (const block of content) {
              if (block.type === "tool_result") {
                let resultContent = typeof block.content === "string"
                  ? block.content
                  : JSON.stringify(block.content);
                if (resultContent.length > 3000) {
                  resultContent = resultContent.slice(0, 3000) + "\n...(truncated)";
                }
                res.write(`data: ${JSON.stringify({
                  type: "tool_result",
                  toolUseId: block.tool_use_id,
                  content: resultContent,
                  isError: block.is_error || false,
                })}\n\n`);
              }
            }
          } else if (event.type === "result") {
            // If result has an error, forward it
            if (event.is_error || event.subtype === "error" || event.subtype === "error_during_execution") {
              const errorMsg = (event.errors && event.errors[0]) || event.result || event.error || "Unknown error";
              console.error(`[Ask AI] Result error: ${errorMsg}`);
              res.write(`data: ${JSON.stringify({ error: errorMsg })}\n\n`);
            } else if (!textSent && event.result) {
              // Fallback: if no text events were sent but result has text, send it
              textSent = true;
              res.write(`data: ${JSON.stringify({ type: "text", text: event.result })}\n\n`);
            }
            res.write(`data: ${JSON.stringify({ type: "result", result: event.result || "" })}\n\n`);
          }
        } catch {
          // Incomplete or invalid JSON line, skip
        }
      }
    });

    child.stderr.on("data", (data: Buffer) => {
      const msg = data.toString().trim();
      console.error(`[Ask AI stderr] ${msg}`);
      stderrBuffer += msg + "\n";
    });

    const cleanup = () => {
      clearInterval(heartbeat);
      clearTimeout(timeout);
      if (webSessionId) activeAskStreams.delete(webSessionId);
    };

    child.on("exit", (code) => {
      console.log(`[Ask AI] Process exited with code ${code}`);
      cleanup();

      // Save claudeSessionId + mode to DB after first message or mode change
      if (!isResume && webSessionId && session) {
        store.updateChatSessionClaudeId(webSessionId, session.userId, claudeSessionId, currentMode);
      }

      if (!finished) {
        finished = true;
        // Surface error to frontend if process failed without sending any text
        if (code !== 0 && !textSent && stderrBuffer.trim()) {
          res.write(`data: ${JSON.stringify({ error: stderrBuffer.trim() })}\n\n`);
        }
        res.write("data: [DONE]\n\n");
        res.end();
      }
    });

    child.on("error", (err) => {
      console.error(`[Ask AI] Process error: ${err.message}`);
      cleanup();
      if (!finished) {
        finished = true;
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      }
    });

    // Kill process only if client disconnects before we finish
    res.on("close", () => {
      if (!finished) {
        console.log("[Ask AI] Client disconnected, killing process");
        cleanup();
        child.kill("SIGTERM");
      }
    });
  });

  // ==================== Chat Sessions ====================

  // List user's chat sessions
  app.get("/api/chat/sessions", (req, res) => {
    const userId = req.headers["x-strix-user-id"] as string;
    if (!userId) { res.status(401).json({ error: "Missing X-Strix-User-Id header" }); return; }
    const sessions = store.getChatSessionsByUser(userId);
    res.json(sessions);
  });

  // Create new chat session
  app.post("/api/chat/sessions", (req, res) => {
    const userId = req.headers["x-strix-user-id"] as string;
    if (!userId) { res.status(401).json({ error: "Missing X-Strix-User-Id header" }); return; }
    const { scanId, title, cwd } = req.body;
    const now = new Date().toISOString();
    const session = {
      id: randomUUID(),
      userId,
      scanId: scanId || null,
      claudeSessionId: null,
      claudeSessionMode: null,
      cwd: cwd || null,
      title: title || "New Chat",
      createdAt: now,
      updatedAt: now,
    };
    store.createChatSession(session);
    res.json(session);
  });

  // Delete chat session
  app.delete("/api/chat/sessions/:id", (req, res) => {
    const userId = req.headers["x-strix-user-id"] as string;
    if (!userId) { res.status(401).json({ error: "Missing X-Strix-User-Id header" }); return; }
    const session = store.getChatSession(req.params.id, userId);
    if (!session) { res.status(404).json({ error: "Session not found" }); return; }
    store.deleteChatSession(req.params.id, userId);
    res.json({ message: "Session deleted" });
  });

  // Update chat session title
  app.patch("/api/chat/sessions/:id", (req, res) => {
    const userId = req.headers["x-strix-user-id"] as string;
    if (!userId) { res.status(401).json({ error: "Missing X-Strix-User-Id header" }); return; }
    const session = store.getChatSession(req.params.id, userId);
    if (!session) { res.status(404).json({ error: "Session not found" }); return; }
    const { title } = req.body;
    if (title) store.updateChatSessionTitle(req.params.id, userId, title);
    res.json({ ...session, title: title || session.title });
  });

  // Get messages for a session
  app.get("/api/chat/sessions/:id/messages", (req, res) => {
    const userId = req.headers["x-strix-user-id"] as string;
    if (!userId) { res.status(401).json({ error: "Missing X-Strix-User-Id header" }); return; }
    const session = store.getChatSession(req.params.id, userId);
    if (!session) { res.status(404).json({ error: "Session not found" }); return; }
    const messages = store.getChatMessages(req.params.id, userId);
    res.json(messages);
  });

  // Save a message to a session
  app.post("/api/chat/sessions/:id/messages", (req, res) => {
    const userId = req.headers["x-strix-user-id"] as string;
    if (!userId) { res.status(401).json({ error: "Missing X-Strix-User-Id header" }); return; }
    const session = store.getChatSession(req.params.id, userId);
    if (!session) { res.status(404).json({ error: "Session not found" }); return; }
    const { role, content, isExecute, blocks } = req.body;
    const message = {
      id: randomUUID(),
      sessionId: req.params.id,
      role,
      content: content || "",
      isExecute: isExecute || undefined,
      blocks: blocks || undefined,
      createdAt: new Date().toISOString(),
    };
    store.addChatMessage(message);
    res.json(message);
  });

  // ==================== Chat Export ====================

  // Export chat session as PDF
  app.get("/api/chat/sessions/:id/export/pdf", async (req, res) => {
    const userId = req.headers["x-strix-user-id"] as string;
    if (!userId) { res.status(401).json({ error: "Missing X-Strix-User-Id header" }); return; }
    const session = store.getChatSession(req.params.id, userId);
    if (!session) { res.status(404).json({ error: "Session not found" }); return; }
    const messages = store.getChatMessages(req.params.id, userId);

    try {
      const pdfBuffer = await generateChatPDF(session, messages);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="chat-${req.params.id.slice(0, 8)}.pdf"`);
      res.send(pdfBuffer);
    } catch (error) {
      console.error("Chat PDF generation error:", error);
      res.status(500).json({ error: "Failed to generate PDF" });
    }
  });

  // Export chat session as DOCX
  app.get("/api/chat/sessions/:id/export/docx", async (req, res) => {
    const userId = req.headers["x-strix-user-id"] as string;
    if (!userId) { res.status(401).json({ error: "Missing X-Strix-User-Id header" }); return; }
    const session = store.getChatSession(req.params.id, userId);
    if (!session) { res.status(404).json({ error: "Session not found" }); return; }
    const messages = store.getChatMessages(req.params.id, userId);

    try {
      const docxBuffer = await generateChatDOCX(session, messages);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="chat-${req.params.id.slice(0, 8)}.docx"`);
      res.send(docxBuffer);
    } catch (error) {
      console.error("Chat DOCX generation error:", error);
      res.status(500).json({ error: "Failed to generate DOCX" });
    }
  });

  app.listen(port, () => {
    console.log(`[REST] API server running on http://localhost:${port}`);
  });

  return app;
}
