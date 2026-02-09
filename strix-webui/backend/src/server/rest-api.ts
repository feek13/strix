import express from "express";
import cors from "cors";
import { join } from "path";
import { homedir } from "os";
import { readFileSync, existsSync } from "fs";
import { spawn } from "child_process";
import { store } from "../store/sqlite-store.js";
import { startScan, stopScan, resumeScan, getActiveScans, getActiveScanById } from "./scan-manager.js";
import { ensureDockerReady, ensureDockerReadyWithSteps } from "./docker-utils.js";
import type { PreflightStep } from "./docker-utils.js";
import { eventReceiver } from "../bridge/event-receiver.js";
import { generatePDFReport } from "../reports/pdf-generator.js";
import { generateChatPDF } from "../reports/chat-pdf-generator.js";
import { generateChatDOCX } from "../reports/chat-docx-generator.js";
import { randomUUID } from "crypto";
import type { ChildProcess } from "child_process";
import type { Scan } from "@strix-webui/shared";

// In-memory map of active SSE streams for Ask AI sessions
// Key: web session ID, Value: active SSE response
const activeAskStreams = new Map<string, express.Response>();

// Track active Ask AI CLI processes for graceful shutdown
interface ActiveAskProcess {
  child: ChildProcess;
  webSessionId: string;
  userId: string;
  claudeSessionId: string;
  currentMode: string;
  isResume: boolean;
  accumulatedText: string;  // assistant response accumulated so far
}
const activeAskProcesses = new Map<string, ActiveAskProcess>();

/** Kill a child process and its entire process group (spawned with detached: true) */
function killProcessGroup(child: ChildProcess) {
  try {
    if (child.pid) process.kill(-child.pid, "SIGTERM");
  } catch {
    try { child.kill("SIGTERM"); } catch {}
  }
}

// Graceful shutdown: save all active Ask AI session state to DB before exit
function saveActiveAskSessions() {
  for (const [id, proc] of activeAskProcesses) {
    try {
      // Save claudeSessionId if this was a new session
      if (!proc.isResume) {
        store.updateChatSessionClaudeId(proc.webSessionId, proc.userId, proc.claudeSessionId, proc.currentMode);
      }
      // Save accumulated assistant response if any
      if (proc.accumulatedText.trim()) {
        store.addChatMessage({
          id: randomUUID(),
          sessionId: proc.webSessionId,
          role: "assistant",
          content: proc.accumulatedText,
          isExecute: proc.currentMode === "execute",
          blocks: undefined,
          createdAt: new Date().toISOString(),
        });
        console.log(`[Shutdown] Saved partial assistant response for session ${proc.webSessionId} (${proc.accumulatedText.length} chars)`);
      }
    } catch (err) {
      console.error(`[Shutdown] Failed to save session ${id}:`, err);
    }
  }
}

// Register shutdown handlers
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(`[Shutdown] Received ${signal}, saving ${activeAskProcesses.size} active session(s)...`);
    saveActiveAskSessions();
    // Persist EventReceiver cursor so no events are lost on restart
    eventReceiver.stop();
    // Kill all child processes
    for (const [, proc] of activeAskProcesses) {
      killProcessGroup(proc.child);
    }
    activeAskProcesses.clear();
    process.exit(0);
  });
}

export function createRestServer(port: number = 3000): express.Application {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Health check
  app.get("/api/health", (_req, res) => {
    const activeIds = getActiveScans().map(s => s.scan.id);
    res.json({ status: "ok", activeScans: activeIds });
  });

  // Start new scan
  app.post("/api/scans", async (req, res) => {
    try {
      const { target, targetType, mode, timeoutMinutes } = req.body;

      if (!target) {
        res.status(400).json({ error: "Target is required" });
        return;
      }

      // Pre-flight: ensure Docker is running (auto-starts if needed)
      try {
        await ensureDockerReady(90_000, (msg) => {
          console.log(`[Docker] ${msg}`);
        });
      } catch (dockerErr) {
        const msg = dockerErr instanceof Error ? dockerErr.message : "Docker is not available";
        res.status(503).json({ error: msg, code: "DOCKER_NOT_READY" });
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
      res.status(500).json({ error: message });
    }
  });

  // Start scan with real-time SSE progress for preflight checks
  app.post("/api/scans/start", async (req, res) => {
    const { target, targetType, mode, timeoutMinutes } = req.body;

    if (!target) {
      res.status(400).json({ error: "Target is required" });
      return;
    }

    // Set up SSE headers (same pattern as /api/ask)
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    res.write(": connected\n\n");

    let finished = false;

    // Heartbeat every 5s to keep connection alive during long builds
    const heartbeat = setInterval(() => {
      if (!finished) res.write(": heartbeat\n\n");
    }, 5000);

    const cleanup = () => {
      finished = true;
      clearInterval(heartbeat);
    };

    res.on("close", () => {
      cleanup();
    });

    const writeEvent = (data: Record<string, unknown>) => {
      if (!finished) {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      }
    };

    try {
      // Run preflight checks with structured step reporting
      await ensureDockerReadyWithSteps((step: PreflightStep) => {
        writeEvent({ type: "step", ...step });
      }, 90_000);

      // Step 3: Launch the scan
      writeEvent({
        type: "step",
        step: 3, totalSteps: 3, id: "launch",
        label: "Launching Scan", status: "running",
        detail: "Creating scan...",
      });

      // Auto-detect target type
      let type: Scan["targetType"] = targetType || "url";
      if (!targetType) {
        if (target.includes("github.com")) type = "github";
        else if (target.startsWith("/") || target.startsWith("./") || target.startsWith("~")) type = "local";
        else type = "url";
      }

      const scan = startScan(target.trim(), type, mode || "auto", timeoutMinutes);

      writeEvent({
        type: "step",
        step: 3, totalSteps: 3, id: "launch",
        label: "Launching Scan", status: "done",
      });

      writeEvent({ type: "complete", scan });
      res.write("data: [DONE]\n\n");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`[Scan Start SSE] Error: ${message}`);
      writeEvent({ type: "error", error: message });
      res.write("data: [DONE]\n\n");
    } finally {
      cleanup();
      res.end();
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

  // Resume a completed/stopped scan
  app.post("/api/scans/:id/resume", async (req, res) => {
    try {
      // Pre-flight: ensure Docker is running
      try {
        await ensureDockerReady(90_000, (msg) => {
          console.log(`[Docker] ${msg}`);
        });
      } catch (dockerErr) {
        const msg = dockerErr instanceof Error ? dockerErr.message : "Docker is not available";
        res.status(503).json({ error: msg, code: "DOCKER_NOT_READY" });
        return;
      }

      const { timeoutMinutes } = req.body || {};
      const scan = resumeScan(req.params.id, timeoutMinutes);
      res.json(scan);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const status = message.includes("not found") ? 404 : message.includes("already running") ? 409 : 400;
      res.status(status).json({ error: message });
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
  app.post("/api/ask", async (req, res) => {
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
            `You are Strix, an autonomous security testing agent. Execute the requested security test using your available tools.`,
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
            ``,
            `## FALSE POSITIVE PREVENTION (CRITICAL)`,
            ``,
            `### Core Principle: HTTP Status Code ≠ Operation Success`,
            `Many APIs return HTTP 200/204 even when authorization blocks the actual operation.`,
            `The ONLY reliable indicator of a write vulnerability is ACTUAL DATA CHANGE verified through direct comparison.`,
            ``,
            `### 5-Step Deep Verification (REQUIRED for every finding)`,
            `Before reporting ANY vulnerability, you MUST execute ALL 5 steps:`,
            ``,
            `1. **BEFORE STATE**: GET the target resource, record the original value`,
            `2. **EXECUTE OPERATION**: Perform the attack. For Supabase/PostgREST, add \`Prefer: return=representation\` header`,
            `3. **ANALYZE RESPONSE**: Check response content:`,
            `   - \`[]\` (empty array) = 0 rows affected = BLOCKED by RLS = NOT vulnerable`,
            `   - \`[{...}]\` with modified data = VULNERABILITY EXISTS`,
            `   - 401/403 = permission denied = BLOCKED`,
            `4. **AFTER STATE**: GET the target resource again, record the current value`,
            `5. **VERDICT**: Compare before vs after. If before === after, the operation was BLOCKED — do NOT report as vulnerability`,
            ``,
            `### Per-Operation Verification`,
            `| Claim | How to verify | False positive if... |`,
            `|-------|--------------|---------------------|`,
            `| "Full CRUD" | Test each of C/R/U/D separately | Only READ works |`,
            `| "Can DELETE user" | DELETE then GET to confirm gone | User still exists |`,
            `| "Can UPDATE data" | PATCH then GET to verify change | Data unchanged |`,
            `| "Can INSERT data" | POST then GET to verify exists | Record not found |`,
            ``,
            `### Severity Rules`,
            `- READ-only access on non-sensitive data = medium at most, NOT critical`,
            `- READ access on sensitive data (PII, credentials) = high`,
            `- Verified WRITE/DELETE on other users' data = critical`,
            `- "Potential" or "possible" = do NOT report. Only report CONFIRMED findings with before/after proof`,
            `- If an operation returns HTTP 200 but data is unchanged, explicitly state "NOT vulnerable — RLS/authorization blocked the operation"`,
            ``,
            `### Report Format`,
            `For each confirmed vulnerability, include:`,
            `- Before state (exact data before attack)`,
            `- Attack request (full curl command)`,
            `- Response (full response body)`,
            `- After state (exact data after attack)`,
            `- Verdict: VULNERABLE (data changed) or SAFE (data unchanged)`,
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

    // Execute mode (new session): Docker preflight before spawning Claude
    // so that strix-sandbox MCP server can connect to the container.
    if (isExecute && !isResume) {
      try {
        await ensureDockerReadyWithSteps((step) => {
          res.write(`data: ${JSON.stringify({ type: "preflight_step", ...step })}\n\n`);
        }, 90_000);
        res.write(`data: ${JSON.stringify({ type: "preflight_done" })}\n\n`);
      } catch (dockerErr) {
        const msg = dockerErr instanceof Error ? dockerErr.message : "Docker is not available";
        console.error(`[Ask AI] Docker preflight failed: ${msg}`);
        res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }
    }

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

    if (isExecute) {
      // Execute mode: load full MCP servers (including strix-sandbox) for
      // Docker sandbox, browser automation, multi-agent, and findings tools.
      // MCP init takes ~2.5min but enables deep security testing capabilities.
      args.push("--dangerously-skip-permissions");
      // No turn limit — security tests run until the task is done.
    } else {
      // Ask mode: skip MCP servers for fast lightweight Q&A.
      // Built-in tools (Bash, Read, Write, etc.) are sufficient.
      args.push("--mcp-config", '{"mcpServers":{}}', "--strict-mcp-config");
      args.push("--max-turns", "1");
      args.push("--model", "sonnet");
    }

    // Register SSE stream for compaction notifications
    if (webSessionId) {
      activeAskStreams.set(webSessionId, res);
    }

    let finished = false;
    const child = spawn("claude", args, {
      detached: true,
      env: {
        ...process.env,
        ...(webSessionId ? { STRIX_CHAT_SESSION_ID: webSessionId } : {}),
      },
      cwd: session?.cwd || process.env.HOME || homedir(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Track this process for graceful shutdown recovery
    const processId = randomUUID();
    if (webSessionId && session) {
      activeAskProcesses.set(processId, {
        child,
        webSessionId,
        userId: session.userId,
        claudeSessionId,
        currentMode,
        isResume,
        accumulatedText: "",
      });
    }

    // Pass prompt via stdin (works with both --session-id and --resume)
    child.stdin.write(prompt);
    child.stdin.end();

    // Send heartbeat every 5s to keep connection alive
    const heartbeat = setInterval(() => {
      if (!finished) res.write(": heartbeat\n\n");
    }, 5000);

    // No timeout for execute mode — task runs until done.
    // Ask mode: 3 min timeout (single-turn Q&A).
    const timeoutMs = isExecute ? 0 : 3 * 60 * 1000;
    let killedByTimeout = false;
    const timeout = timeoutMs > 0 ? setTimeout(() => {
      if (!finished) {
        killedByTimeout = true;
        console.log(`[Ask AI] Ask timeout (${timeoutMs / 60000} min), killing process`);
        killProcessGroup(child);
      }
    }, timeoutMs) : null;

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
                // Accumulate text for graceful shutdown recovery
                const tracked = activeAskProcesses.get(processId);
                if (tracked) tracked.accumulatedText += block.text;
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
              const tracked = activeAskProcesses.get(processId);
              if (tracked) tracked.accumulatedText += event.result;
              res.write(`data: ${JSON.stringify({ type: "text", text: event.result })}\n\n`);
            }
            res.write(`data: ${JSON.stringify({
              type: "result",
              result: event.result || "",
            })}\n\n`);
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
      if (timeout) clearTimeout(timeout);
      if (webSessionId) activeAskStreams.delete(webSessionId);
      activeAskProcesses.delete(processId);
    };

    child.on("exit", (code) => {
      console.log(`[Ask AI] Process exited with code ${code}${killedByTimeout ? " (timeout)" : ""}`);

      // Save claudeSessionId + mode to DB after first message or mode change
      if (!isResume && webSessionId && session) {
        store.updateChatSessionClaudeId(webSessionId, session.userId, claudeSessionId, currentMode);
      }

      cleanup();

      if (!finished) {
        finished = true;
        // Surface timeout to frontend so it can show "send a message to continue"
        if (killedByTimeout) {
          res.write(`data: ${JSON.stringify({ type: "timeout", timeoutMinutes: timeoutMs / 60000 })}\n\n`);
        }
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
        killProcessGroup(child);
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
