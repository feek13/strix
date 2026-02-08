import express from "express";
import cors from "cors";
import { join } from "path";
import { homedir } from "os";
import { readFileSync, existsSync } from "fs";
import { spawn } from "child_process";
import { store } from "../store/sqlite-store.js";
import { startScan, stopScan, getActiveScan } from "./scan-manager.js";
import { generatePDFReport } from "../reports/pdf-generator.js";
import { randomUUID } from "crypto";
import type { Scan } from "@strix-webui/shared";

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

  // Ask AI about the report (SSE streaming via Claude Code CLI)
  app.post("/api/ask", (req, res) => {
    const { scanId, selectedText, question, history, mode } = req.body;
    if (!question) {
      res.status(400).json({ error: "Question is required" });
      return;
    }

    const isExecute = mode === "execute";

    // Gather scan context
    let context = "";
    if (scanId) {
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

    // Build prompt — different system prompt for execute mode
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

    let prompt = `${systemPrompt}\n\n${context}\n`;

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

    // Set up SSE — disable compression/buffering to keep connection alive
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // Send initial keepalive so client knows connection is established
    res.write(": connected\n\n");

    console.log(`[Ask AI] Spawning claude in ${isExecute ? "EXECUTE" : "ASK"} mode (${prompt.length} chars)`);

    // Build spawn args based on mode
    const args: string[] = ["--no-session-persistence"];

    if (isExecute) {
      // Execute mode: structured streaming with tool visibility
      args.push("--output-format", "stream-json", "--verbose");
      args.push("--dangerously-skip-permissions");
      args.push("--max-turns", "50");
    } else {
      // Ask mode: lightweight Q&A, no tools
      args.push("--print");
      args.push("--max-turns", "1");
      args.push("--model", "sonnet");
      args.push("--mcp-config", '{"mcpServers":{}}', "--strict-mcp-config");
    }

    let finished = false;
    const child = spawn("claude", args, {
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Pass prompt via stdin (avoids arg length limits)
    child.stdin.write(prompt);
    child.stdin.end();

    // Send heartbeat every 5s to keep connection alive
    const heartbeat = setInterval(() => {
      if (!finished) res.write(": heartbeat\n\n");
    }, 5000);

    // Execute mode: 5-minute timeout
    let timeout: ReturnType<typeof setTimeout> | null = null;
    if (isExecute) {
      timeout = setTimeout(() => {
        if (!finished) {
          console.log("[Ask AI] Execute timeout (10 min), killing process");
          child.kill("SIGTERM");
        }
      }, 10 * 60 * 1000);
    }

    if (isExecute) {
      // Parse stream-json events and forward as typed SSE messages
      let jsonBuffer = "";
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
              res.write(`data: ${JSON.stringify({ type: "result", result: event.result || "" })}\n\n`);
            }
          } catch {
            // Incomplete or invalid JSON line, skip
          }
        }
      });
    } else {
      // Ask mode: simple text streaming
      child.stdout.on("data", (data: Buffer) => {
        const text = data.toString();
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      });
    }

    child.stderr.on("data", (data: Buffer) => {
      console.error(`[Ask AI stderr] ${data.toString().trim()}`);
    });

    child.on("exit", (code) => {
      console.log(`[Ask AI] Process exited with code ${code}`);
      clearInterval(heartbeat);
      if (timeout) clearTimeout(timeout);
      if (!finished) {
        finished = true;
        res.write("data: [DONE]\n\n");
        res.end();
      }
    });

    child.on("error", (err) => {
      console.error(`[Ask AI] Process error: ${err.message}`);
      clearInterval(heartbeat);
      if (timeout) clearTimeout(timeout);
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
        clearInterval(heartbeat);
        if (timeout) clearTimeout(timeout);
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
    const { scanId, title } = req.body;
    const now = new Date().toISOString();
    const session = {
      id: randomUUID(),
      userId,
      scanId: scanId || null,
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

  app.listen(port, () => {
    console.log(`[REST] API server running on http://localhost:${port}`);
  });

  return app;
}
