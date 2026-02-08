import { spawn, type ChildProcess } from "child_process";
import { store } from "../store/sqlite-store.js";
import type { Scan, InternalEvent } from "@strix-webui/shared";
import { v4 as uuidv4 } from "uuid";
import { writeEvent } from "../hooks/utils.js";

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const MAX_TURNS = 200;

interface ActiveScan {
  scan: Scan;
  process: ChildProcess;
  timeoutTimer: ReturnType<typeof setTimeout>;
}

let activeScan: ActiveScan | null = null;

export function getActiveScan(): ActiveScan | null {
  return activeScan;
}

export function startScan(
  target: string,
  targetType: Scan["targetType"],
  mode: string,
  timeoutMinutes?: number
): Scan {
  if (activeScan) {
    throw new Error("A scan is already running. Stop it first.");
  }

  const scanId = uuidv4();
  const now = new Date().toISOString();

  const scan: Scan = {
    id: scanId,
    target,
    targetType,
    status: "running",
    mode,
    createdAt: now,
    startedAt: now,
    completedAt: null,
    findings: 0,
  };

  store.saveScan(scan);

  // Write scan started event
  const startEvent: InternalEvent = {
    type: "SCAN_STARTED",
    timestamp: now,
    scanId,
    target,
    targetType,
    mode,
  };
  writeEvent(startEvent);

  // Build the prompt for Claude Code
  const prompt = buildPrompt(target, targetType, mode);

  const timeoutMs = (timeoutMinutes ?? 30) * 60 * 1000;

  // Spawn Claude Code CLI (uses global MCP servers from ~/.claude/settings.json)
  const child = spawn("claude", [
    "--print",
    "--dangerously-skip-permissions",
    "--no-session-persistence",
    "--max-turns", String(MAX_TURNS),
    prompt,
  ], {
    env: {
      ...process.env,
      STRIX_SCAN_ID: scanId,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Scan timeout — kill the process if it runs too long
  const timeoutTimer = setTimeout(() => {
    if (activeScan?.scan.id === scanId) {
      console.log(`[Scan ${scanId.slice(0, 8)}] Timeout after ${timeoutMs / 60000} minutes, killing process`);
      activeScan.process.kill("SIGTERM");
      setTimeout(() => {
        if (activeScan?.scan.id === scanId) {
          activeScan.process.kill("SIGKILL");
        }
      }, 10000);
    }
  }, timeoutMs);

  activeScan = { scan, process: child, timeoutTimer };

  child.stdout?.on("data", (data: Buffer) => {
    console.log(`[Scan ${scanId.slice(0, 8)}] ${data.toString().trim()}`);
  });

  child.stderr?.on("data", (data: Buffer) => {
    console.error(`[Scan ${scanId.slice(0, 8)}] ${data.toString().trim()}`);
  });

  child.on("exit", (code) => {
    const completedAt = new Date().toISOString();
    const status = code === 0 ? "completed" : "failed";
    store.updateScanStatus(scanId, status, completedAt);

    const completeEvent: InternalEvent = {
      type: "SCAN_COMPLETED",
      timestamp: completedAt,
      scanId,
      status,
    };
    writeEvent(completeEvent);

    if (activeScan?.scan.id === scanId) {
      clearTimeout(activeScan.timeoutTimer);
      activeScan = null;
    }
    console.log(`[Scan ${scanId.slice(0, 8)}] Process exited with code ${code}`);
  });

  child.on("error", (err) => {
    console.error(`[Scan ${scanId.slice(0, 8)}] Process error:`, err);
    store.updateScanStatus(scanId, "failed", new Date().toISOString());
    if (activeScan?.scan.id === scanId) {
      clearTimeout(activeScan.timeoutTimer);
      activeScan = null;
    }
  });

  return scan;
}

export function stopScan(scanId: string): boolean {
  if (!activeScan || activeScan.scan.id !== scanId) {
    return false;
  }

  clearTimeout(activeScan.timeoutTimer);
  activeScan.process.kill("SIGTERM");
  setTimeout(() => {
    if (activeScan?.scan.id === scanId) {
      activeScan.process.kill("SIGKILL");
    }
  }, 5000);

  store.updateScanStatus(scanId, "stopped", new Date().toISOString());
  activeScan = null;
  return true;
}

function buildPrompt(target: string, targetType: string, mode: string): string {
  const modeDescriptions: Record<string, string> = {
    auto: "Perform a comprehensive security assessment. Use your judgment to determine the best testing approach.",
    recon: "Focus on reconnaissance and information gathering. Map the attack surface.",
    injection: "Focus on injection testing - SQL injection, XSS, command injection, etc.",
    auth: "Focus on authentication and authorization testing - IDOR, broken access control, session management.",
    logic: "Focus on business logic testing - race conditions, workflow bypasses, mass assignment.",
    platform: "Focus on platform-specific testing based on the technology stack detected.",
    redteam: "Perform a full red team simulation with exploitation and post-exploitation.",
  };

  const modeInstruction = modeDescriptions[mode] || modeDescriptions.auto;

  return `You are Strix, an autonomous security testing agent. Your target is: ${target} (${targetType}).

${modeInstruction}

Instructions:
1. Start by creating a sandbox environment
2. Perform quick reconnaissance to understand the target (spend no more than 2-3 minutes on recon)
3. Identify potential vulnerabilities based on recon findings
4. Test and validate each finding with proof-of-concept
5. Document all verified vulnerabilities using create_vulnerability_report
6. When done, call finish_scan with a comprehensive summary

Time constraints:
- You have a maximum of 30 minutes total. Be efficient.
- Do NOT run long-running scans like full nmap port scans. Use quick targeted checks instead.
- Do NOT use Bash to run tools that take more than 60 seconds. Use proxy_send_request for HTTP testing.
- Prefer using the proxy and browser tools over raw Bash commands for web testing.
- Move quickly: recon (2-3 min) → test vulnerabilities (15-20 min) → report (2 min).

Focus on real, exploitable vulnerabilities. Avoid false positives. Always call finish_scan when done.`;
}
