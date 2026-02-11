use std::collections::{HashMap, HashSet};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::task::JoinHandle;

use crate::models::{InternalEvent, Scan, ScanStatus, TargetType};
use crate::store::AppDb;
use crate::utils::events::write_event;

/// Per-mode scan limits: max turns and default timeout.
struct ScanLimits {
    max_turns: u32,
    timeout_minutes: u32,
}

fn get_scan_limits(mode: &str) -> ScanLimits {
    match mode {
        "deep" => ScanLimits { max_turns: 500, timeout_minutes: 120 },
        "redteam" => ScanLimits { max_turns: 400, timeout_minutes: 90 },
        "recon" => ScanLimits { max_turns: 100, timeout_minutes: 15 },
        _ => ScanLimits { max_turns: 200, timeout_minutes: 30 },
    }
}

struct ActiveScanEntry {
    scan: Scan,
    pid: u32,
    timeout_handle: JoinHandle<()>,
}

/// Manages active scan processes, matching TypeScript scan-manager.ts.
pub struct ScanManager {
    db: AppDb,
    active_scans: Mutex<HashMap<String, ActiveScanEntry>>,
    stopped_scan_ids: Mutex<HashSet<String>>,
}

impl ScanManager {
    pub fn new(db: AppDb) -> Self {
        Self {
            db,
            active_scans: Mutex::new(HashMap::new()),
            stopped_scan_ids: Mutex::new(HashSet::new()),
        }
    }

    /// Get IDs of all currently active scans.
    pub fn get_active_scan_ids(&self) -> Vec<String> {
        self.active_scans
            .lock()
            .unwrap()
            .values()
            .map(|e| e.scan.id.clone())
            .collect()
    }

    /// Start a new scan. Spawns Claude CLI as a child process with monitoring.
    ///
    /// Matches TypeScript `startScan()`.
    pub fn start_scan(
        self: &Arc<Self>,
        target: &str,
        target_type: TargetType,
        mode: &str,
        timeout_minutes: Option<u32>,
    ) -> anyhow::Result<Scan> {
        let scan_id = uuid::Uuid::new_v4().to_string();
        let claude_session_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let scan = Scan {
            id: scan_id.clone(),
            target: target.to_string(),
            target_type: target_type.clone(),
            status: ScanStatus::Running,
            mode: mode.to_string(),
            created_at: now.clone(),
            started_at: Some(now.clone()),
            completed_at: None,
            findings: 0,
            claude_session_id: Some(claude_session_id.clone()),
        };

        self.db.save_scan(&scan)?;

        // Write SCAN_STARTED event to JSONL
        write_event(&InternalEvent::ScanStarted {
            timestamp: now,
            scan_id: scan_id.clone(),
            target: target.to_string(),
            target_type: target_type.as_str().to_string(),
            mode: mode.to_string(),
        });

        // Build the prompt
        let prompt = build_prompt(target, target_type.as_str(), mode);
        let limits = get_scan_limits(mode);
        let timeout_ms =
            (timeout_minutes.unwrap_or(limits.timeout_minutes) as u64) * 60 * 1000;

        // Spawn Claude CLI
        let child = tokio::process::Command::new("claude")
            .args([
                "--print",
                "--dangerously-skip-permissions",
                "--session-id",
                &claude_session_id,
                "--max-turns",
                &limits.max_turns.to_string(),
                &prompt,
            ])
            .env("STRIX_SCAN_ID", &scan_id)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        let pid = child.id().unwrap_or(0);

        // Spawn process monitor (logs stdout/stderr, handles exit)
        self.spawn_process_monitor(child, scan_id.clone());

        // Spawn timeout timer
        let timeout_handle = self.spawn_timeout(scan_id.clone(), pid, timeout_ms);

        // Track active scan
        self.active_scans.lock().unwrap().insert(
            scan_id,
            ActiveScanEntry {
                scan: scan.clone(),
                pid,
                timeout_handle,
            },
        );

        Ok(scan)
    }

    /// Resume a stopped/completed scan.
    ///
    /// Matches TypeScript `resumeScan()`.
    pub fn resume_scan(
        self: &Arc<Self>,
        scan_id: &str,
        timeout_minutes: Option<u32>,
    ) -> anyhow::Result<Scan> {
        let scan = self
            .db
            .get_scan(scan_id)?
            .ok_or_else(|| anyhow::anyhow!("Scan not found"))?;

        let claude_session_id = scan
            .claude_session_id
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Scan has no Claude session ID — cannot resume"))?
            .clone();

        if self.active_scans.lock().unwrap().contains_key(scan_id) {
            anyhow::bail!("Scan is already running");
        }

        // Update status back to running
        let now = chrono::Utc::now().to_rfc3339();
        self.db
            .update_scan_status(scan_id, &ScanStatus::Running, None)?;

        let mut scan = scan;
        scan.status = ScanStatus::Running;
        scan.completed_at = None;

        write_event(&InternalEvent::ScanStarted {
            timestamp: now,
            scan_id: scan_id.to_string(),
            target: scan.target.clone(),
            target_type: scan.target_type.as_str().to_string(),
            mode: scan.mode.clone(),
        });

        let limits = get_scan_limits(&scan.mode);
        let timeout_ms =
            (timeout_minutes.unwrap_or(limits.timeout_minutes) as u64) * 60 * 1000;

        // Spawn Claude CLI with --resume
        let mut child = tokio::process::Command::new("claude")
            .args([
                "--print",
                "--dangerously-skip-permissions",
                "--resume",
                &claude_session_id,
                "--max-turns",
                &limits.max_turns.to_string(),
            ])
            .env("STRIX_SCAN_ID", scan_id)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        // Send continuation prompt via stdin
        if let Some(mut stdin) = child.stdin.take() {
            tokio::spawn(async move {
                let prompt = "Continue the security scan from where you left off. \
                    Check your previous findings and continue testing any areas that \
                    haven't been covered yet. When done, call finish_scan with a \
                    comprehensive summary.";
                let _ = stdin.write_all(prompt.as_bytes()).await;
                // Dropping stdin closes it
            });
        }

        let pid = child.id().unwrap_or(0);
        let scan_id_owned = scan_id.to_string();

        self.spawn_process_monitor(child, scan_id_owned.clone());
        let timeout_handle = self.spawn_timeout(scan_id_owned.clone(), pid, timeout_ms);

        self.active_scans.lock().unwrap().insert(
            scan_id_owned,
            ActiveScanEntry {
                scan: scan.clone(),
                pid,
                timeout_handle,
            },
        );

        Ok(scan)
    }

    /// Stop an active scan. Returns true if found and stopped.
    ///
    /// Matches TypeScript `stopScan()`.
    pub fn stop_scan(self: &Arc<Self>, scan_id: &str) -> bool {
        let entry = self.active_scans.lock().unwrap().remove(scan_id);
        let Some(entry) = entry else {
            return false;
        };

        // Mark as stopped before killing so exit handler skips status update
        self.stopped_scan_ids
            .lock()
            .unwrap()
            .insert(scan_id.to_string());

        entry.timeout_handle.abort();

        // Send SIGTERM
        let pid = entry.pid;
        send_sigterm(pid);

        // Fallback SIGKILL after 5 seconds
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(5)).await;
            send_sigkill(pid);
        });

        let now = chrono::Utc::now().to_rfc3339();
        self.db
            .update_scan_status(scan_id, &ScanStatus::Stopped, Some(&now))
            .ok();

        write_event(&InternalEvent::ScanCompleted {
            timestamp: now,
            scan_id: scan_id.to_string(),
            status: "stopped".to_string(),
        });

        true
    }

    /// Spawn a task that monitors the child process (logs, exit handling).
    fn spawn_process_monitor(
        self: &Arc<Self>,
        mut child: tokio::process::Child,
        scan_id: String,
    ) {
        let scan_id_short = scan_id[..std::cmp::min(8, scan_id.len())].to_string();

        // Stream stdout
        if let Some(stdout) = child.stdout.take() {
            let sid = scan_id_short.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    tracing::info!("[Scan {}] {}", sid, line);
                }
            });
        }

        // Stream stderr
        if let Some(stderr) = child.stderr.take() {
            let sid = scan_id_short.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    tracing::error!("[Scan {}] {}", sid, line);
                }
            });
        }

        // Wait for exit
        let manager = Arc::clone(self);
        let scan_id2 = scan_id.clone();
        tokio::spawn(async move {
            let status = child.wait().await;
            let code = status
                .as_ref()
                .ok()
                .and_then(|s| s.code())
                .unwrap_or(-1);
            let completed_at = chrono::Utc::now().to_rfc3339();

            // Check if manually stopped
            if manager
                .stopped_scan_ids
                .lock()
                .unwrap()
                .remove(&scan_id2)
            {
                if let Some(entry) = manager.active_scans.lock().unwrap().remove(&scan_id2) {
                    entry.timeout_handle.abort();
                }
                tracing::info!(
                    "[Scan {}] Process exited with code {} (already stopped)",
                    &scan_id2[..std::cmp::min(8, scan_id2.len())],
                    code
                );
                return;
            }

            // Natural exit → completed
            let scan_status = ScanStatus::Completed;
            manager
                .db
                .update_scan_status(&scan_id2, &scan_status, Some(&completed_at))
                .ok();

            // Remove from active_scans BEFORE writing event so that
            // the event handler sees an empty active list.
            if let Some(entry) = manager.active_scans.lock().unwrap().remove(&scan_id2) {
                entry.timeout_handle.abort();
            }

            write_event(&InternalEvent::ScanCompleted {
                timestamp: completed_at,
                scan_id: scan_id2.clone(),
                status: "completed".to_string(),
            });

            tracing::info!(
                "[Scan {}] Process exited with code {} → completed",
                &scan_id2[..std::cmp::min(8, scan_id2.len())],
                code
            );
        });
    }

    /// Spawn a timeout task that kills the process after `timeout_ms`.
    fn spawn_timeout(self: &Arc<Self>, scan_id: String, pid: u32, timeout_ms: u64) -> JoinHandle<()> {
        let manager = Arc::clone(self);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(timeout_ms)).await;

            if manager.active_scans.lock().unwrap().contains_key(&scan_id) {
                tracing::info!(
                    "[Scan {}] Timeout after {} minutes, killing process",
                    &scan_id[..std::cmp::min(8, scan_id.len())],
                    timeout_ms / 60000
                );
                send_sigterm(pid);

                // Fallback SIGKILL after 10 seconds
                tokio::time::sleep(Duration::from_secs(10)).await;
                if manager.active_scans.lock().unwrap().contains_key(&scan_id) {
                    send_sigkill(pid);
                }
            }
        })
    }
}

// --- Signal helpers ---

#[cfg(unix)]
fn send_sigterm(pid: u32) {
    use nix::sys::signal::{kill, Signal};
    use nix::unistd::Pid;
    kill(Pid::from_raw(pid as i32), Signal::SIGTERM).ok();
}

#[cfg(not(unix))]
fn send_sigterm(_pid: u32) {
    // On non-Unix, fall through to SIGKILL via process handle
}

#[cfg(unix)]
fn send_sigkill(pid: u32) {
    use nix::sys::signal::{kill, Signal};
    use nix::unistd::Pid;
    kill(Pid::from_raw(pid as i32), Signal::SIGKILL).ok();
}

#[cfg(not(unix))]
fn send_sigkill(_pid: u32) {}

// --- Target type auto-detection ---

pub fn auto_detect_target_type(target: &str, explicit: Option<&str>) -> TargetType {
    if let Some(t) = explicit {
        return TargetType::from_str(t);
    }
    if target.contains("github.com") {
        TargetType::Github
    } else if target.starts_with('/') || target.starts_with("./") || target.starts_with('~') {
        TargetType::Local
    } else {
        TargetType::Url
    }
}

// =====================================================================
// Prompt builders — strict 1:1 port from scan-manager.ts
// =====================================================================

fn build_prompt(target: &str, target_type: &str, mode: &str) -> String {
    if mode == "deep" {
        build_deep_prompt(target, target_type)
    } else {
        build_standard_prompt(target, target_type, mode)
    }
}

fn build_deep_prompt(target: &str, target_type: &str) -> String {
    [
        build_coordinator_role(target, target_type),
        build_agent_delegation_section(target),
        build_common_verification_sections(),
    ]
    .join("\n\n")
}

fn build_standard_prompt(target: &str, target_type: &str, mode: &str) -> String {
    [
        build_single_agent_role(target, target_type, mode),
        build_common_verification_sections(),
        build_time_constraints(mode),
    ]
    .join("\n\n")
}

fn build_coordinator_role(target: &str, target_type: &str) -> String {
    format!(
        r#"You are Strix, an autonomous security testing coordinator. Your target is: {target} ({target_type}).

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
- Call finish_scan with success=true when assessment is complete"#
    )
}

fn build_agent_delegation_section(target: &str) -> String {
    format!(
        r#"## Agent Delegation

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

```
create_agent(
  task="Test all API endpoints for SQL injection. Target: {target}. Endpoints found: [list endpoints from recon].

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
   response = proxy_send_request(method='POST/PUT/DELETE', url='<target>', headers={{...}}, body='<payload>')
3. Capture after state:
   response = proxy_send_request(method='GET', url='<target_endpoint>')
   verify_state_change(action='capture', label='after_<test_name>', snapshot_data=response.body)
4. Compare states:
   verify_state_change(action='compare', snapshot_id_before=<id1>, snapshot_id_after=<id2>)
5. Verdict:
   - States IDENTICAL → NOT vulnerable. Use create_note.
   - States DIFFERENT → VULNERABLE. Use create_vulnerability_report with evidence:
     {{'before_state':'...','after_state':'...','attack_request':'...','attack_response':'...','cross_identity_test':'...','negative_test':'...'}}

Confidence threshold: 90/100. Reports below this are auto-rejected.
Critical requires cross_identity >= 0.8 AND impact >= 0.8.
HTTP 200 alone is NOT evidence — verify ACTUAL DATA CHANGE.

## When Done
Call agent_finish(result_summary='...', findings='...', report_to_parent=true)
---END AGENT METHODOLOGY---",
  name="SQL Injection Specialist",
  prompt_modules="sql_injection,information_disclosure"
)
```"#
    )
}

fn build_single_agent_role(target: &str, target_type: &str, mode: &str) -> String {
    let mode_descriptions: &[(&str, &str)] = &[
        ("auto", "Perform a comprehensive security assessment. Use your judgment to determine the best testing approach. You may optionally create sub-agents via create_agent if you discover a large attack surface that benefits from parallel testing."),
        ("recon", "Focus on reconnaissance and information gathering. Map the attack surface, enumerate endpoints, identify technologies, and discover potential entry points. Do not perform active exploitation."),
        ("injection", "Focus on injection testing — SQL injection, XSS, command injection, template injection, XXE. Load relevant prompt modules (sql_injection, xss, rce, xxe) via prompt_module_view for specialized methodology."),
        ("auth", "Focus on authentication and authorization testing — IDOR, broken access control, JWT vulnerabilities, session management, CSRF. Load relevant prompt modules (authentication_jwt, idor, broken_function_level_authorization, csrf) via prompt_module_view."),
        ("logic", "Focus on business logic testing — race conditions, workflow bypasses, mass assignment, parameter tampering. Load relevant prompt modules (business_logic, race_conditions, mass_assignment) via prompt_module_view."),
        ("platform", "Focus on platform-specific testing based on the technology stack detected. Use prompt_modules_list to discover available modules, then load relevant ones (supabase, firebase_firestore, fastapi, nextjs, graphql) via prompt_module_view."),
        ("redteam", "Perform a full red team simulation with exploitation and post-exploitation. Chain vulnerabilities for maximum impact. You may create sub-agents via create_agent to parallelize testing across different attack vectors."),
    ];

    let mode_instruction = mode_descriptions
        .iter()
        .find(|(m, _)| *m == mode)
        .map(|(_, desc)| *desc)
        .unwrap_or(mode_descriptions[0].1); // default to "auto"

    format!(
        r#"You are Strix, an autonomous security testing agent. Your target is: {target} ({target_type}).

{mode_instruction}

## Workflow
1. Create a sandbox environment with sandbox_create
2. Use proxy_send_request for ALL HTTP requests (NEVER curl or Bash)
3. Quick recon: identify tech stack, endpoints, attack surface (2-3 min)
4. Load specialized knowledge via prompt_modules_list and prompt_module_view based on detected technologies
5. Test vulnerabilities with DEEP VERIFICATION (see below)
6. Document ONLY verified findings using create_vulnerability_report with structured evidence
7. Call finish_scan with a comprehensive summary when done"#
    )
}

fn build_common_verification_sections() -> String {
    r#"### HTTP Request Tool
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
```json
{
  "before_state": "State of resource before attack",
  "after_state": "State of resource after attack (must differ from before_state)",
  "attack_request": "Exact HTTP request or payload used",
  "attack_response": "Response received (should contain success indicators)",
  "cross_identity_test": "Results of testing with a different user/non-owner",
  "negative_test": "Results of testing with normal/benign input"
}
```

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

Accuracy over volume. A report with 3 verified findings is better than 15 with false positives."#
        .to_string()
}

fn build_time_constraints(mode: &str) -> String {
    let guidance = match mode {
        "recon" => "Focus entirely on reconnaissance. Map attack surface thoroughly (10-12 min).",
        "injection" => "Quick recon (2-3 min) → injection testing + verification (15-20 min) → report (2 min).",
        "auth" => "Quick recon (2-3 min) → auth/access control testing + verification (15-20 min) → report (2 min).",
        "logic" => "Quick recon (2-3 min) → business logic testing + verification (15-20 min) → report (2 min).",
        "platform" => "Quick recon (2-3 min) → platform-specific testing + verification (15-20 min) → report (2 min).",
        "redteam" => "Recon (5 min) → comprehensive testing + exploitation chains (60-70 min) → report (5 min).",
        _ => "Quick recon (2-3 min) → test + verify (15-20 min) → report (2 min).",
    };

    format!(
        r#"## Time Constraints
- Be efficient. Do NOT run full port scans or tools that take >60 seconds.
- Use proxy_send_request for HTTP testing, not raw curl via Bash.
- {guidance}

Always call finish_scan when done."#
    )
}
