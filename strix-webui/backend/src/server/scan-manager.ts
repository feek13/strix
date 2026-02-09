import { spawn, type ChildProcess } from "child_process";
import { store } from "../store/sqlite-store.js";
import type { Scan, InternalEvent } from "@strix-webui/shared";
import { v4 as uuidv4 } from "uuid";
import { writeEvent } from "../hooks/utils.js";

const MAX_TURNS = 200;

interface ActiveScan {
  scan: Scan;
  process: ChildProcess;
  timeoutTimer: ReturnType<typeof setTimeout>;
}

/** All currently running scans, keyed by scan ID */
const activeScans = new Map<string, ActiveScan>();
/** Track scan IDs that were manually stopped so exit handler doesn't overwrite status */
const stoppedScanIds = new Set<string>();

export function getActiveScans(): ActiveScan[] {
  return Array.from(activeScans.values());
}

export function getActiveScanById(id: string): ActiveScan | undefined {
  return activeScans.get(id);
}

export function startScan(
  target: string,
  targetType: Scan["targetType"],
  mode: string,
  timeoutMinutes?: number
): Scan {
  const scanId = uuidv4();
  const claudeSessionId = uuidv4();
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
    claudeSessionId,
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

  // Spawn Claude Code CLI with a persistent session
  const child = spawn("claude", [
    "--print",
    "--dangerously-skip-permissions",
    "--session-id", claudeSessionId,
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
    const entry = activeScans.get(scanId);
    if (entry) {
      console.log(`[Scan ${scanId.slice(0, 8)}] Timeout after ${timeoutMs / 60000} minutes, killing process`);
      entry.process.kill("SIGTERM");
      setTimeout(() => {
        if (activeScans.has(scanId)) {
          activeScans.get(scanId)!.process.kill("SIGKILL");
        }
      }, 10000);
    }
  }, timeoutMs);

  activeScans.set(scanId, { scan, process: child, timeoutTimer });

  setupProcessHandlers(child, scanId);

  return scan;
}

export function resumeScan(scanId: string, timeoutMinutes?: number): Scan {
  const scan = store.getScan(scanId);
  if (!scan) {
    throw new Error("Scan not found");
  }
  if (!scan.claudeSessionId) {
    throw new Error("Scan has no Claude session ID — cannot resume");
  }
  if (activeScans.has(scanId)) {
    throw new Error("Scan is already running");
  }

  // Update status back to running
  const now = new Date().toISOString();
  store.updateScanStatus(scanId, "running", undefined);
  scan.status = "running";
  scan.completedAt = null;

  const startEvent: InternalEvent = {
    type: "SCAN_STARTED",
    timestamp: now,
    scanId,
    target: scan.target,
    targetType: scan.targetType,
    mode: scan.mode,
  };
  writeEvent(startEvent);

  const timeoutMs = (timeoutMinutes ?? 30) * 60 * 1000;

  // Spawn Claude Code CLI with --resume to continue the existing session
  const child = spawn("claude", [
    "--print",
    "--dangerously-skip-permissions",
    "--resume", scan.claudeSessionId,
    "--max-turns", String(MAX_TURNS),
  ], {
    env: {
      ...process.env,
      STRIX_SCAN_ID: scanId,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Send continuation prompt via stdin
  child.stdin!.write("Continue the security scan from where you left off. Check your previous findings and continue testing any areas that haven't been covered yet. When done, call finish_scan with a comprehensive summary.");
  child.stdin!.end();

  const timeoutTimer = setTimeout(() => {
    const entry = activeScans.get(scanId);
    if (entry) {
      console.log(`[Scan ${scanId.slice(0, 8)}] Timeout after ${timeoutMs / 60000} minutes, killing process`);
      entry.process.kill("SIGTERM");
      setTimeout(() => {
        if (activeScans.has(scanId)) {
          activeScans.get(scanId)!.process.kill("SIGKILL");
        }
      }, 10000);
    }
  }, timeoutMs);

  activeScans.set(scanId, { scan, process: child, timeoutTimer });

  setupProcessHandlers(child, scanId);

  return scan;
}

export function stopScan(scanId: string): boolean {
  const entry = activeScans.get(scanId);
  if (!entry) {
    return false;
  }

  // Mark as stopped before killing so exit handler doesn't overwrite
  stoppedScanIds.add(scanId);
  clearTimeout(entry.timeoutTimer);
  entry.process.kill("SIGTERM");
  setTimeout(() => {
    const current = activeScans.get(scanId);
    if (current) {
      current.process.kill("SIGKILL");
    }
  }, 5000);

  store.updateScanStatus(scanId, "stopped", new Date().toISOString());

  const stopEvent: InternalEvent = {
    type: "SCAN_COMPLETED",
    timestamp: new Date().toISOString(),
    scanId,
    status: "stopped",
  };
  writeEvent(stopEvent);

  activeScans.delete(scanId);
  return true;
}

function setupProcessHandlers(child: ChildProcess, scanId: string): void {
  child.stdout?.on("data", (data: Buffer) => {
    console.log(`[Scan ${scanId.slice(0, 8)}] ${data.toString().trim()}`);
  });

  child.stderr?.on("data", (data: Buffer) => {
    console.error(`[Scan ${scanId.slice(0, 8)}] ${data.toString().trim()}`);
  });

  child.on("exit", (code) => {
    const completedAt = new Date().toISOString();

    // Don't overwrite status if scan was manually stopped
    if (stoppedScanIds.has(scanId)) {
      stoppedScanIds.delete(scanId);
      const entry = activeScans.get(scanId);
      if (entry) {
        clearTimeout(entry.timeoutTimer);
        activeScans.delete(scanId);
      }
      console.log(`[Scan ${scanId.slice(0, 8)}] Process exited with code ${code} (already stopped)`);
      return;
    }

    // Treat all natural exits as "completed" — Claude CLI exits non-zero
    // for normal reasons (max turns, context overflow, etc.)
    const status = "completed";
    store.updateScanStatus(scanId, status, completedAt);

    const completeEvent: InternalEvent = {
      type: "SCAN_COMPLETED",
      timestamp: completedAt,
      scanId,
      status,
    };
    writeEvent(completeEvent);

    const entry = activeScans.get(scanId);
    if (entry) {
      clearTimeout(entry.timeoutTimer);
      activeScans.delete(scanId);
    }
    console.log(`[Scan ${scanId.slice(0, 8)}] Process exited with code ${code} → ${status}`);
  });

  child.on("error", (err) => {
    console.error(`[Scan ${scanId.slice(0, 8)}] Process error:`, err);
    store.updateScanStatus(scanId, "failed", new Date().toISOString());
    const entry = activeScans.get(scanId);
    if (entry) {
      clearTimeout(entry.timeoutTimer);
      activeScans.delete(scanId);
    }
  });
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
