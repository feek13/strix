import { spawn, type ChildProcess } from "child_process";
import { store } from "../store/sqlite-store.js";
import type { Scan, InternalEvent } from "@strix-webui/shared";
import { v4 as uuidv4 } from "uuid";
import { writeEvent } from "../hooks/utils.js";

function getScanLimits(mode: string): { maxTurns: number; timeoutMinutes: number } {
  switch (mode) {
    case "deep":
      return { maxTurns: 500, timeoutMinutes: 120 };
    case "redteam":
      return { maxTurns: 400, timeoutMinutes: 90 };
    case "recon":
      return { maxTurns: 100, timeoutMinutes: 15 };
    default:
      return { maxTurns: 200, timeoutMinutes: 30 };
  }
}

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

  const limits = getScanLimits(mode);
  const timeoutMs = (timeoutMinutes ?? limits.timeoutMinutes) * 60 * 1000;

  // Spawn Claude Code CLI with a persistent session
  const child = spawn("claude", [
    "--print",
    "--dangerously-skip-permissions",
    "--session-id", claudeSessionId,
    "--max-turns", String(limits.maxTurns),
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

  const limits = getScanLimits(scan.mode);
  const timeoutMs = (timeoutMinutes ?? limits.timeoutMinutes) * 60 * 1000;

  // Spawn Claude Code CLI with --resume to continue the existing session
  const child = spawn("claude", [
    "--print",
    "--dangerously-skip-permissions",
    "--resume", scan.claudeSessionId,
    "--max-turns", String(limits.maxTurns),
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

  child.once("exit", (code) => {
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

  child.once("error", (err) => {
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
  if (mode === "deep") {
    return buildDeepPrompt(target, targetType);
  }
  return buildStandardPrompt(target, targetType, mode);
}

function buildDeepPrompt(target: string, targetType: string): string {
  return [
    buildCoordinatorRole(target, targetType),
    buildAgentDelegationSection(target),
    buildCommonVerificationSections(),
  ].join("\n\n");
}

function buildStandardPrompt(target: string, targetType: string, mode: string): string {
  return [
    buildSingleAgentRole(target, targetType, mode),
    buildCommonVerificationSections(),
    buildTimeConstraints(mode),
  ].join("\n\n");
}

function buildCoordinatorRole(target: string, targetType: string): string {
  return `You are Strix, an autonomous security testing coordinator. Your target is: ${target} (${targetType}).

## Your Role: COORDINATOR ONLY
You orchestrate specialized sub-agents. You do NOT perform detailed testing yourself.

## Workflow
1. Create a sandbox environment with sandbox_create
2. Quick recon (2-3 min): identify tech stack, endpoints, attack surface
3. Based on recon results, create specialized testing agents (see Agent Delegation below)
4. Monitor progress via view_agent_graph
5. If an agent discovers a promising attack surface, create NEW agents to dig deeper
6. When all agents finish, compile findings and call finish_scan

## Dynamic Agent Spawning
- If an agent discovers a promising attack surface, create NEW agents to dig deeper
- Example: Auth agent finds weak JWT → spawn dedicated JWT exploitation agent
- Example: Injection agent finds SQLi → spawn post-exploitation agent
- There is no limit on agent count — create as many as needed for thorough coverage

## When a Sub-Agent Reports Back
- Receive findings via agent messages
- Track which areas have been tested
- If gaps remain, create new agents for untested areas
- When all testing is complete, call finish_scan

## ALLOWED TOOLS (you are the coordinator)
You may ONLY use these tools:
- sandbox_create — set up the testing environment
- proxy_send_request — quick recon ONLY (max 10 requests to identify tech stack and endpoints)
- prompt_modules_list — discover available knowledge modules
- create_agent — spawn specialized testing agents
- view_agent_graph — monitor agent status and progress
- send_message_to_agent — coordinate with agents
- wait_for_message — wait for agent reports
- finish_scan — complete the assessment after all agents finish
- create_note / list_notes — coordination notes

## FORBIDDEN TOOLS (delegate these to agents)
Do NOT use these tools yourself — they are for sub-agents:
- Bash, terminal_execute — NEVER use for HTTP requests; use proxy_send_request instead
- browser_action — delegate browser testing to agents
- python_action — delegate to agents
- verify_state_change — agents handle evidence capture
- create_vulnerability_report — agents report their own findings

## Recon Phase (max 10 proxy_send_request calls)
Your recon goal is to identify WHAT agents to create, not to test everything yourself:
1. proxy_send_request: GET target homepage → identify framework/tech stack from headers and HTML
2. proxy_send_request: Check common paths (/api, /admin, /login, /robots.txt, /sitemap.xml)
3. proxy_send_request: Probe API endpoints discovered
4. STOP recon. Create agents based on what you found.

## Post-Delegation Phase
After creating agents, you enter coordination-only mode:
- Use ONLY: view_agent_graph, wait_for_message, send_message_to_agent, create_agent, finish_scan
- Do NOT make any more HTTP requests
- Monitor agent progress every 1-2 minutes with view_agent_graph
- If an agent reports a promising attack surface, create a NEW agent to dig deeper

## finish_scan Requirements
- Can ONLY be called when all sub-agents have completed (check view_agent_graph)
- Include comprehensive summary: tested areas, verified findings, false positives rejected
- Call finish_scan with success=true when assessment is complete`;
}

function buildAgentDelegationSection(target: string): string {
  return `## Agent Delegation

Based on recon results, create agents with focused tasks.

### Agent Naming Convention
Name each agent descriptively based on its specialty:
- "Auth/IDOR Tester" (not "Security Agent")
- "SQL Injection Specialist" (not "Agent 1")
- "Supabase RLS Tester" (not "Platform Tester")
- "API Endpoint Fuzzer" (not "Tester")

### Recommended Agent Types
| Agent | When to Create | Prompt Modules |
|-------|---------------|----------------|
| Injection Tester | If form inputs or API params found | sql_injection, xss, rce |
| Auth/IDOR Tester | If auth system detected | authentication_jwt, idor, broken_function_level_authorization |
| Logic Tester | If workflows/transactions found | business_logic, race_conditions, mass_assignment |
| Platform Tester | If specific framework detected | supabase, firebase_firestore, fastapi, nextjs, graphql |
| Info Disclosure | If APIs or error pages found | information_disclosure, path_traversal_lfi_rfi |
| SSRF/XXE Tester | If file upload or URL params found | ssrf, xxe, insecure_file_uploads |

### Agent Task Template
When creating agents, COPY the methodology block below into every agent's task description.
Sub-agents ONLY see the task string you give them — they do NOT inherit your instructions.

\`\`\`
create_agent(
  task="Test all API endpoints for SQL injection. Target: ${target}. Endpoints found: [list endpoints from recon].

---BEGIN AGENT METHODOLOGY---
## MANDATORY RULES
1. Use proxy_send_request for ALL HTTP requests. NEVER use Bash, curl, wget, or terminal_execute for HTTP.
2. Use browser_action for browser-based testing when needed.
3. Load your prompt modules with prompt_module_view before starting.

## Verification Workflow (REQUIRED for every potential finding)
For EVERY potential vulnerability, you MUST:
1. Capture before state:
   response = proxy_send_request(method='GET', url='<target_endpoint>')
   verify_state_change(action='capture', label='before_<test_name>', snapshot_data=response.body)
2. Execute attack:
   response = proxy_send_request(method='POST/PUT/DELETE', url='<target>', headers={...}, body='<payload>')
3. Capture after state:
   response = proxy_send_request(method='GET', url='<target_endpoint>')
   verify_state_change(action='capture', label='after_<test_name>', snapshot_data=response.body)
4. Compare states:
   verify_state_change(action='compare', snapshot_id_before=<id1>, snapshot_id_after=<id2>)
5. Verdict:
   - States IDENTICAL → NOT vulnerable. Use create_note.
   - States DIFFERENT → VULNERABLE. Use create_vulnerability_report with evidence:
     {'before_state':'...','after_state':'...','attack_request':'...','attack_response':'...','cross_identity_test':'...','negative_test':'...'}

Confidence threshold: 90/100. Reports below this are auto-rejected.
Critical requires cross_identity >= 0.8 AND impact >= 0.8.
HTTP 200 alone is NOT evidence — verify ACTUAL DATA CHANGE.

## When Done
Call agent_finish(result_summary='...', findings='...', report_to_parent=true)
---END AGENT METHODOLOGY---",
  name="SQL Injection Specialist",
  prompt_modules="sql_injection,information_disclosure"
)
\`\`\``;
}

function buildSingleAgentRole(target: string, targetType: string, mode: string): string {
  const modeDescriptions: Record<string, string> = {
    auto: "Perform a comprehensive security assessment. Use your judgment to determine the best testing approach. You may optionally create sub-agents via create_agent if you discover a large attack surface that benefits from parallel testing.",
    recon: "Focus on reconnaissance and information gathering. Map the attack surface, enumerate endpoints, identify technologies, and discover potential entry points. Do not perform active exploitation.",
    injection: "Focus on injection testing — SQL injection, XSS, command injection, template injection, XXE. Load relevant prompt modules (sql_injection, xss, rce, xxe) via prompt_module_view for specialized methodology.",
    auth: "Focus on authentication and authorization testing — IDOR, broken access control, JWT vulnerabilities, session management, CSRF. Load relevant prompt modules (authentication_jwt, idor, broken_function_level_authorization, csrf) via prompt_module_view.",
    logic: "Focus on business logic testing — race conditions, workflow bypasses, mass assignment, parameter tampering. Load relevant prompt modules (business_logic, race_conditions, mass_assignment) via prompt_module_view.",
    platform: "Focus on platform-specific testing based on the technology stack detected. Use prompt_modules_list to discover available modules, then load relevant ones (supabase, firebase_firestore, fastapi, nextjs, graphql) via prompt_module_view.",
    redteam: "Perform a full red team simulation with exploitation and post-exploitation. Chain vulnerabilities for maximum impact. You may create sub-agents via create_agent to parallelize testing across different attack vectors.",
  };

  const modeInstruction = modeDescriptions[mode] || modeDescriptions.auto;

  return `You are Strix, an autonomous security testing agent. Your target is: ${target} (${targetType}).

${modeInstruction}

## Workflow
1. Create a sandbox environment with sandbox_create
2. Use proxy_send_request for ALL HTTP requests (NEVER curl or Bash)
3. Quick recon: identify tech stack, endpoints, attack surface (2-3 min)
4. Load specialized knowledge via prompt_modules_list and prompt_module_view based on detected technologies
5. Test vulnerabilities with DEEP VERIFICATION (see below)
6. Document ONLY verified findings using create_vulnerability_report with structured evidence
7. Call finish_scan with a comprehensive summary when done`;
}

function buildCommonVerificationSections(): string {
  return `### HTTP Request Tool
Use proxy_send_request for ALL HTTP requests. NEVER use Bash, curl, or wget for HTTP.
proxy_send_request records traffic in the proxy log for evidence and supports request replay.

## EVIDENCE-BASED VERIFICATION (MANDATORY)

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

### verify_state_change Workflow
Use the verify_state_change tool to formally capture and compare states:
1. verify_state_change(action="capture", label="before_X", snapshot_data=response_body)
2. Execute your attack
3. verify_state_change(action="capture", label="after_X", snapshot_data=response_body)
4. verify_state_change(action="compare", snapshot_id_before=id1, snapshot_id_after=id2)
5. Use the captured before/after states in your evidence JSON

### Structured Evidence JSON (REQUIRED)
Every call to create_vulnerability_report MUST include structured evidence in the content:
\`\`\`json
{
  "before_state": "State of resource before attack",
  "after_state": "State of resource after attack (must differ from before_state)",
  "attack_request": "Exact HTTP request or payload used",
  "attack_response": "Response received (should contain success indicators)",
  "cross_identity_test": "Results of testing with a different user/non-owner",
  "negative_test": "Results of testing with normal/benign input"
}
\`\`\`

### Confidence System
Score is computed automatically. Threshold: 90/100 required.
| Component | Weight | How to maximize |
|-----------|--------|-----------------|
| response_evidence | 0.20 | Include success indicators (data/rows/affected) in attack_response |
| state_change | 0.30 | Ensure before_state and after_state are clearly different |
| cross_identity | 0.25 | Test with different user, mention "different user" or "non-owner" |
| impact_confirmed | 0.25 | Demonstrate real state change with detailed responses |

Reports below 90/100 are automatically REJECTED. Use create_note for unconfirmed observations.

### Severity Auto-Validation
- Critical requires: cross_identity >= 0.8 AND impact >= 0.8
- High requires: state_change >= 0.7 AND impact >= 0.6
- Insufficient evidence → automatic severity downgrade

### Platform-Specific Indicators
| Platform | Success Indicator | Blocked Indicator |
|----------|-------------------|-------------------|
| Supabase/PostgREST | Returns [{data}] | Returns [] or 401 |
| Firebase/Firestore | writeTime changes | Data unchanged |
| GraphQL | affected_rows > 0 | affected_rows: 0 |
| Standard REST | Response contains updated data | Data unchanged |

### Per-Operation Rules
- Do NOT claim "Full CRUD" unless you separately verified Create, Read, Update, AND Delete
- If only READ works, report it as READ-ONLY access, NOT "Full CRUD"
- Test each operation individually: INSERT → verify exists; PATCH → verify changed; DELETE → verify gone

### Severity Rules
| Actual Impact (verified) | Maximum Severity |
|--------------------------|-----------------|
| READ-only on non-sensitive data | medium |
| READ on sensitive data (PII, credentials, private messages) | high |
| Verified WRITE/UPDATE on other users' data | high or critical |
| Verified DELETE of other users' data | critical |
| Admin panel publicly accessible | critical |

### Deduplication
- Same root cause = ONE finding, not multiple
- Group: 30 tables lacking RLS = "Missing RLS on N tables"
- Do NOT report the same underlying issue multiple times with different titles

### What NOT to Report
- HTTP 200 on a write request where data did NOT actually change
- "Potential" vulnerabilities without before/after proof
- Features working as designed (e.g., public API returning public data)
- Issues you cannot reproduce consistently

### False Positive Checklist
Before creating any finding, verify:
1. **Negative Test**: Does the behavior disappear when the attack payload is removed?
2. **Alternative Explanation**: Could this be normal application behavior or a feature?
3. **Durability**: Is the state change persistent, not just a transient glitch?
4. **Reproducibility**: Can you reproduce the vulnerability consistently (3+ times)?

If ANY check fails, use create_note instead of create_vulnerability_report.

Accuracy over volume. A report with 3 verified findings is better than 15 with false positives.`;
}

function buildTimeConstraints(mode: string): string {
  const timeGuidance: Record<string, string> = {
    recon: "Focus entirely on reconnaissance. Map attack surface thoroughly (10-12 min).",
    injection: "Quick recon (2-3 min) → injection testing + verification (15-20 min) → report (2 min).",
    auth: "Quick recon (2-3 min) → auth/access control testing + verification (15-20 min) → report (2 min).",
    logic: "Quick recon (2-3 min) → business logic testing + verification (15-20 min) → report (2 min).",
    platform: "Quick recon (2-3 min) → platform-specific testing + verification (15-20 min) → report (2 min).",
    redteam: "Recon (5 min) → comprehensive testing + exploitation chains (60-70 min) → report (5 min).",
    auto: "Quick recon (2-3 min) → test + verify (15-20 min) → report (2 min).",
  };

  const guidance = timeGuidance[mode] || timeGuidance.auto;

  return `## Time Constraints
- Be efficient. Do NOT run full port scans or tools that take >60 seconds.
- Use proxy_send_request for HTTP testing, not raw curl via Bash.
- ${guidance}

Always call finish_scan when done.`;
}
