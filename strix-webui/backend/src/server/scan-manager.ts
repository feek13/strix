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

## Workflow
1. Create a sandbox environment
2. Quick recon: identify tech stack, endpoints, attack surface (2-3 min)
3. Test vulnerabilities with DEEP VERIFICATION (see below)
4. Document ONLY verified findings using create_vulnerability_report
5. Call finish_scan with a comprehensive summary

## FALSE POSITIVE PREVENTION (CRITICAL — read carefully)

### Core Principle: HTTP Status Code ≠ Operation Success
Many APIs (especially Supabase/PostgREST) return HTTP 200/204 even when authorization BLOCKS the operation.
The ONLY reliable way to confirm a write vulnerability is to verify ACTUAL DATA CHANGE.

### 5-Step Deep Verification — REQUIRED for EVERY finding
Before reporting ANY vulnerability, you MUST complete ALL 5 steps:

1. **BEFORE STATE**: GET the target resource, save the original data
2. **EXECUTE ATTACK**: Perform the operation. For PostgREST, add header: Prefer: return=representation
3. **ANALYZE RESPONSE**:
   - [] (empty array) = 0 rows affected = BLOCKED by RLS → NOT a vulnerability
   - [{...}] with modified data = actual change → VULNERABILITY
   - 401/403 = permission denied → NOT a vulnerability
4. **AFTER STATE**: GET the target resource again, save the current data
5. **VERDICT**: Compare step 1 vs step 4.
   - before === after → SAFE (authorization blocked the operation) → DO NOT REPORT
   - before !== after → VULNERABLE → report with before/after evidence

### Per-Operation Rules
- Do NOT claim "Full CRUD" unless you separately verified Create, Read, Update, AND Delete
- If only READ works, report it as READ-ONLY access, NOT "Full CRUD"
- Test each operation individually: INSERT a record → verify it exists; PATCH a field → verify it changed; DELETE → verify it's gone

### Severity Rules
| Actual Impact (verified) | Maximum Severity |
|--------------------------|-----------------|
| READ-only on non-sensitive data | medium |
| READ on sensitive data (PII, credentials, private messages) | high |
| Verified WRITE/UPDATE on other users' data | high or critical |
| Verified DELETE of other users' data | critical |
| Admin panel publicly accessible | critical |

### Deduplication
- Do NOT report the same underlying issue multiple times with different titles
- If 30 tables all lack RLS for READ, that is ONE finding ("Missing RLS on N tables"), not 30
- Group related issues into a single comprehensive finding

### What NOT to report
- HTTP 200 on a write request where data did NOT actually change
- "Potential" vulnerabilities without before/after proof
- Features working as designed (e.g., public API returning public data)
- Issues you cannot reproduce consistently

## Time constraints
- Be efficient. Do NOT run full port scans or tools that take >60 seconds.
- Use proxy_send_request for HTTP testing, not raw curl via Bash.
- Move quickly: recon (2-3 min) → test + verify (15-20 min) → report (2 min).

Accuracy over volume. A report with 3 verified findings is better than 15 with false positives. Always call finish_scan when done.`;
}
