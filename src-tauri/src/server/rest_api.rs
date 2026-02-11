use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tower_http::cors::CorsLayer;

use axum::http::header;

use crate::models::{ChatMessageRecord, ChatSession};
use crate::reports::chat_docx_generator::generate_chat_docx;
use crate::reports::chat_pdf_generator::generate_chat_pdf;
use crate::reports::pdf_generator::generate_scan_pdf;
use crate::server::docker_utils::ensure_docker_ready_with_steps;
use crate::server::scan_manager::{auto_detect_target_type, ScanManager};
use crate::server::sse::{setup_sse, SseSender};
use crate::store::AppDb;

/// Tracks an active Ask AI CLI process for graceful shutdown recovery.
pub struct ActiveAskProcess {
    pub pid: u32,
    pub web_session_id: String,
    pub user_id: String,
    pub claude_session_id: String,
    pub current_mode: String,
    pub is_resume: bool,
    pub accumulated_text: String,
}

/// Shared application state passed to all handlers via axum State.
pub struct AppState {
    pub db: AppDb,
    pub scan_manager: Arc<ScanManager>,
    /// Active SSE streams for Ask AI sessions, keyed by web session ID.
    /// Used by POST /api/internal/compacting to push events.
    pub active_ask_streams: Mutex<HashMap<String, SseSender>>,
    /// Active Ask AI CLI processes, keyed by process tracking ID.
    /// Used for graceful shutdown to save partial responses.
    pub active_ask_processes: Mutex<HashMap<String, ActiveAskProcess>>,
}

/// Build the axum REST API router with all endpoints.
///
/// Phase 3 endpoints: health, scans, tools, report preview.
/// Phase 4 endpoints: ask AI, chat sessions.
/// Phase 6 endpoints: PDF/DOCX report generation.
pub fn create_rest_router(state: Arc<AppState>) -> Router {
    Router::new()
        // Health
        .route("/api/health", get(health))
        // Scans
        .route("/api/scans", post(create_scan).get(list_scans))
        .route("/api/scans/start", post(start_scan_sse))
        .route("/api/scans/{id}", get(get_scan).delete(stop_scan))
        .route("/api/scans/{id}/resume", post(resume_scan))
        .route("/api/scans/{id}/report/preview", get(report_preview))
        // Tools
        .route("/api/tools/content/{content_id}", get(get_tool_content))
        // Internal
        .route("/api/internal/compacting", post(internal_compacting))
        // Chat sessions (Phase 4 — implemented now since they're simple CRUD)
        .route(
            "/api/chat/sessions",
            get(list_chat_sessions).post(create_chat_session),
        )
        .route(
            "/api/chat/sessions/{id}",
            delete(delete_chat_session).patch(update_chat_session),
        )
        .route(
            "/api/chat/sessions/{id}/messages",
            get(get_chat_messages).post(save_chat_message),
        )
        // Report generation (Phase 6)
        .route("/api/scans/{id}/report", get(get_scan_report))
        .route(
            "/api/chat/sessions/{id}/export/pdf",
            get(export_chat_pdf),
        )
        .route(
            "/api/chat/sessions/{id}/export/docx",
            get(export_chat_docx),
        )
        // Ask AI — SSE streaming via Claude CLI
        .route("/api/ask", post(ask_ai))
        // CORS
        .layer(CorsLayer::permissive())
        .with_state(state)
}

// =====================================================================
// Helper: extract X-Strix-User-Id header
// =====================================================================

fn get_user_id(headers: &HeaderMap) -> Result<String, (StatusCode, Json<Value>)> {
    headers
        .get("x-strix-user-id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .ok_or_else(|| {
            (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Missing X-Strix-User-Id header"})),
            )
        })
}

// =====================================================================
// Request body types
// =====================================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateScanRequest {
    target: Option<String>,
    target_type: Option<String>,
    mode: Option<String>,
    timeout_minutes: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResumeScanRequest {
    timeout_minutes: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompactingRequest {
    chat_session_id: Option<String>,
    trigger: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateSessionRequest {
    scan_id: Option<String>,
    title: Option<String>,
    cwd: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateSessionRequest {
    title: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveMessageRequest {
    role: String,
    content: Option<String>,
    is_execute: Option<bool>,
    blocks: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AskRequest {
    scan_id: Option<String>,
    selected_text: Option<String>,
    question: String,
    history: Option<Vec<HistoryMessage>>,
    mode: Option<String>,
    session_id: Option<String>,
}

#[derive(Deserialize)]
struct HistoryMessage {
    role: String,
    content: String,
}

// =====================================================================
// Health check
// =====================================================================

async fn health(State(state): State<Arc<AppState>>) -> Json<Value> {
    let active_ids = state.scan_manager.get_active_scan_ids();
    Json(json!({ "status": "ok", "activeScans": active_ids }))
}

// =====================================================================
// Scan endpoints
// =====================================================================

/// POST /api/scans — Create and start a new scan.
async fn create_scan(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateScanRequest>,
) -> Response {
    let target = match body.target.as_deref() {
        Some(t) if !t.is_empty() => t.trim().to_string(),
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Target is required"})),
            )
                .into_response()
        }
    };

    // Docker preflight
    if let Err(e) = crate::server::docker_utils::ensure_docker_ready(90_000).await {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": e.to_string(), "code": "DOCKER_NOT_READY"})),
        )
            .into_response();
    }

    let target_type = auto_detect_target_type(&target, body.target_type.as_deref());
    let mode = body.mode.as_deref().unwrap_or("auto");

    match state
        .scan_manager
        .start_scan(&target, target_type, mode, body.timeout_minutes)
    {
        Ok(scan) => Json(scan).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

/// POST /api/scans/start — Start scan with real-time SSE progress.
async fn start_scan_sse(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateScanRequest>,
) -> Response {
    let target = match body.target.as_deref() {
        Some(t) if !t.is_empty() => t.trim().to_string(),
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Target is required"})),
            )
                .into_response()
        }
    };

    let target_type_str = body.target_type.clone();
    let mode = body.mode.clone().unwrap_or_else(|| "auto".to_string());
    let timeout_minutes = body.timeout_minutes;

    let (sender, sse) = setup_sse();

    // Spawn the preflight + scan start work
    tokio::spawn(async move {
        // Docker preflight with structured steps
        let sender2 = sender.clone();
        let docker_result = ensure_docker_ready_with_steps(
            move |step| {
                sender2.send_json(&json!({
                    "type": "step",
                    "step": step.step,
                    "totalSteps": step.total_steps,
                    "id": step.id,
                    "label": step.label,
                    "status": step.status,
                    "detail": step.detail,
                }));
            },
            90_000,
        )
        .await;

        if let Err(e) = docker_result {
            tracing::error!("[Scan Start SSE] Error: {}", e);
            sender.send_json(&json!({"type": "error", "error": e.to_string()}));
            sender.send_done();
            return;
        }

        // Step 3: Launch the scan
        sender.send_json(&json!({
            "type": "step",
            "step": 3, "totalSteps": 3, "id": "launch",
            "label": "Launching Scan", "status": "running",
            "detail": "Creating scan...",
        }));

        let target_type = auto_detect_target_type(&target, target_type_str.as_deref());

        match state
            .scan_manager
            .start_scan(&target, target_type, &mode, timeout_minutes)
        {
            Ok(scan) => {
                sender.send_json(&json!({
                    "type": "step",
                    "step": 3, "totalSteps": 3, "id": "launch",
                    "label": "Launching Scan", "status": "done",
                }));
                sender.send_json(&json!({"type": "complete", "scan": scan}));
            }
            Err(e) => {
                sender.send_json(&json!({"type": "error", "error": e.to_string()}));
            }
        }
        sender.send_done();
    });

    sse.into_response()
}

/// GET /api/scans — List all scans (newest first).
async fn list_scans(State(state): State<Arc<AppState>>) -> Response {
    match state.db.get_all_scans() {
        Ok(scans) => Json(scans).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

/// GET /api/scans/:id — Get scan detail with related data.
async fn get_scan(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> Response {
    let scan = match state.db.get_scan(&id) {
        Ok(Some(s)) => s,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Scan not found"})),
            )
                .into_response()
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": e.to_string()})),
            )
                .into_response()
        }
    };

    let agents = state.db.get_agents_by_scan(&scan.id).unwrap_or_default();
    let tools = state.db.get_tools_by_scan(&scan.id).unwrap_or_default();
    let vulnerabilities = state.db.get_vulns_by_scan(&scan.id).unwrap_or_default();
    let logs = state.db.get_recent_logs(&scan.id, 200).unwrap_or_default();

    Json(json!({
        "scan": scan,
        "agents": agents,
        "tools": tools,
        "vulnerabilities": vulnerabilities,
        "logs": logs,
    }))
    .into_response()
}

/// DELETE /api/scans/:id — Stop an active scan.
async fn stop_scan(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> Response {
    if state.scan_manager.stop_scan(&id) {
        Json(json!({"message": "Scan stopped"})).into_response()
    } else {
        (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "Active scan not found"})),
        )
            .into_response()
    }
}

/// POST /api/scans/:id/resume — Resume a stopped/completed scan.
async fn resume_scan(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    body: Option<Json<ResumeScanRequest>>,
) -> Response {
    // Docker preflight
    if let Err(e) = crate::server::docker_utils::ensure_docker_ready(90_000).await {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": e.to_string(), "code": "DOCKER_NOT_READY"})),
        )
            .into_response();
    }

    let timeout_minutes = body.and_then(|b| b.timeout_minutes);

    match state.scan_manager.resume_scan(&id, timeout_minutes) {
        Ok(scan) => Json(scan).into_response(),
        Err(e) => {
            let message = e.to_string();
            let status = if message.contains("not found") {
                StatusCode::NOT_FOUND
            } else if message.contains("already running") {
                StatusCode::CONFLICT
            } else {
                StatusCode::BAD_REQUEST
            };
            (status, Json(json!({"error": message}))).into_response()
        }
    }
}

/// GET /api/scans/:id/report/preview — Report preview (JSON summary).
async fn report_preview(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> Response {
    let scan = match state.db.get_scan(&id) {
        Ok(Some(s)) => s,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Scan not found"})),
            )
                .into_response()
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": e.to_string()})),
            )
                .into_response()
        }
    };

    let vulnerabilities = state.db.get_vulns_by_scan(&scan.id).unwrap_or_default();
    let agents = state.db.get_agents_by_scan(&scan.id).unwrap_or_default();
    let tools = state.db.get_tools_by_scan(&scan.id).unwrap_or_default();

    let mut severity_counts = json!({
        "critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0,
    });
    for v in &vulnerabilities {
        if let Some(count) = severity_counts.get_mut(v.severity.as_str()) {
            *count = json!(count.as_i64().unwrap_or(0) + 1);
        }
    }

    // Calculate duration
    let duration = match (&scan.completed_at, &scan.started_at) {
        (Some(completed), Some(started)) => {
            let c = chrono::DateTime::parse_from_rfc3339(completed).ok();
            let s = chrono::DateTime::parse_from_rfc3339(started).ok();
            match (c, s) {
                (Some(c), Some(s)) => Some(c.timestamp_millis() - s.timestamp_millis()),
                _ => None,
            }
        }
        _ => None,
    };

    Json(json!({
        "scan": scan,
        "summary": {
            "totalFindings": vulnerabilities.len(),
            "severityCounts": severity_counts,
            "totalAgents": agents.len(),
            "totalTools": tools.len(),
            "duration": duration,
        },
        "vulnerabilities": vulnerabilities,
    }))
    .into_response()
}

// =====================================================================
// Tool content
// =====================================================================

/// GET /api/tools/content/:contentId — Fetch truncated content file.
async fn get_tool_content(Path(content_id): Path<String>) -> Response {
    let content_path = AppDb::data_dir()
        .join("content")
        .join(format!("{}.json", content_id));

    if !content_path.exists() {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "Content not found"})),
        )
            .into_response();
    }

    match std::fs::read_to_string(&content_path) {
        Ok(raw) => match serde_json::from_str::<Value>(&raw) {
            Ok(content) => Json(content).into_response(),
            Err(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to read content"})),
            )
                .into_response(),
        },
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to read content"})),
        )
            .into_response(),
    }
}

// =====================================================================
// Internal
// =====================================================================

/// POST /api/internal/compacting — Hook notification for context compaction.
async fn internal_compacting(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CompactingRequest>,
) -> Json<Value> {
    if let Some(session_id) = body.chat_session_id {
        let streams = state.active_ask_streams.lock().unwrap();
        if let Some(sender) = streams.get(&session_id) {
            sender.send_json(&json!({
                "type": "compacting",
                "trigger": body.trigger,
            }));
        }
    }
    Json(json!({"ok": true}))
}

// =====================================================================
// Chat sessions (simple CRUD)
// =====================================================================

/// GET /api/chat/sessions — List user's chat sessions.
async fn list_chat_sessions(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Response {
    let user_id = match get_user_id(&headers) {
        Ok(id) => id,
        Err(e) => return e.into_response(),
    };
    match state.db.get_chat_sessions_by_user(&user_id) {
        Ok(sessions) => Json(sessions).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

/// POST /api/chat/sessions — Create new chat session.
async fn create_chat_session(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<CreateSessionRequest>,
) -> Response {
    let user_id = match get_user_id(&headers) {
        Ok(id) => id,
        Err(e) => return e.into_response(),
    };
    let now = chrono::Utc::now().to_rfc3339();
    let session = ChatSession {
        id: uuid::Uuid::new_v4().to_string(),
        user_id,
        scan_id: body.scan_id,
        claude_session_id: None,
        claude_session_mode: None,
        cwd: body.cwd,
        title: body.title.unwrap_or_else(|| "New Chat".to_string()),
        created_at: now.clone(),
        updated_at: now,
    };
    match state.db.create_chat_session(&session) {
        Ok(()) => Json(session).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

/// DELETE /api/chat/sessions/:id
async fn delete_chat_session(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    let user_id = match get_user_id(&headers) {
        Ok(id) => id,
        Err(e) => return e.into_response(),
    };
    match state.db.get_chat_session(&id, &user_id) {
        Ok(Some(_)) => {}
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Session not found"})),
            )
                .into_response()
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": e.to_string()})),
            )
                .into_response()
        }
    }
    state.db.delete_chat_session(&id, &user_id).ok();
    Json(json!({"message": "Session deleted"})).into_response()
}

/// PATCH /api/chat/sessions/:id — Update session title.
async fn update_chat_session(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<UpdateSessionRequest>,
) -> Response {
    let user_id = match get_user_id(&headers) {
        Ok(id) => id,
        Err(e) => return e.into_response(),
    };
    let session = match state.db.get_chat_session(&id, &user_id) {
        Ok(Some(s)) => s,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Session not found"})),
            )
                .into_response()
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": e.to_string()})),
            )
                .into_response()
        }
    };
    if let Some(ref title) = body.title {
        state.db.update_chat_session_title(&id, &user_id, title).ok();
    }
    let updated_title = body.title.unwrap_or(session.title);
    Json(json!({ "id": session.id, "title": updated_title })).into_response()
}

/// GET /api/chat/sessions/:id/messages
async fn get_chat_messages(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    let user_id = match get_user_id(&headers) {
        Ok(id) => id,
        Err(e) => return e.into_response(),
    };
    match state.db.get_chat_session(&id, &user_id) {
        Ok(Some(_)) => {}
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Session not found"})),
            )
                .into_response()
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": e.to_string()})),
            )
                .into_response()
        }
    }
    match state.db.get_chat_messages(&id, &user_id) {
        Ok(msgs) => Json(msgs).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

/// POST /api/chat/sessions/:id/messages — Save a message.
async fn save_chat_message(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<SaveMessageRequest>,
) -> Response {
    let user_id = match get_user_id(&headers) {
        Ok(id) => id,
        Err(e) => return e.into_response(),
    };
    match state.db.get_chat_session(&id, &user_id) {
        Ok(Some(_)) => {}
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Session not found"})),
            )
                .into_response()
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": e.to_string()})),
            )
                .into_response()
        }
    }
    let message = ChatMessageRecord {
        id: uuid::Uuid::new_v4().to_string(),
        session_id: id,
        role: body.role,
        content: body.content.unwrap_or_default(),
        is_execute: body.is_execute,
        blocks: body.blocks,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    match state.db.add_chat_message(&message) {
        Ok(()) => Json(message).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// =====================================================================
// Ask AI — SSE streaming via Claude CLI
// =====================================================================

const ASK_SYSTEM_PROMPT_EXECUTE: &str = "\
You are Strix, an autonomous security testing agent. Execute the requested security test using your available tools.

## MANDATORY Rules — violating these causes failures

### 1. Sequential tool calls ONLY
NEVER make parallel/simultaneous tool calls. Always call ONE tool at a time. Parallel calls cause \"Sibling tool call errored\" failures that waste turns.

### 2. NEVER use python3 -c for multi-line code
Inline python3 -c with double quotes causes \\! escaping bugs (SyntaxError: unexpected character after line continuation). ALWAYS do this instead:
- Step 1: Use the Write tool to write a .py file to /tmp/strix_script.py
- Step 2: Use Bash to run: python3 /tmp/strix_script.py

### 3. Bash escaping
You are running in a non-interactive shell. History expansion is DISABLED. The ! character does NOT need escaping. Never write \\! — just write != directly.
Use single quotes for curl headers and URLs. Example:
  curl -s 'http://target/api' -H 'apikey: xxx' -H 'Authorization: Bearer xxx'

### 4. Error recovery
If a command fails, analyze the error, fix the root cause, then retry. Do not repeat the same failing command.

## FALSE POSITIVE PREVENTION (CRITICAL)

### Core Principle: HTTP Status Code ≠ Operation Success
Many APIs return HTTP 200/204 even when authorization blocks the actual operation.
The ONLY reliable indicator of a write vulnerability is ACTUAL DATA CHANGE verified through direct comparison.

### 5-Step Deep Verification (REQUIRED for every finding)
Before reporting ANY vulnerability, you MUST execute ALL 5 steps:

1. **BEFORE STATE**: GET the target resource, record the original value
2. **EXECUTE OPERATION**: Perform the attack. For Supabase/PostgREST, add `Prefer: return=representation` header
3. **ANALYZE RESPONSE**: Check response content:
   - `[]` (empty array) = 0 rows affected = BLOCKED by RLS = NOT vulnerable
   - `[{...}]` with modified data = VULNERABILITY EXISTS
   - 401/403 = permission denied = BLOCKED
4. **AFTER STATE**: GET the target resource again, record the current value
5. **VERDICT**: Compare before vs after. If before === after, the operation was BLOCKED — do NOT report as vulnerability

### Per-Operation Verification
| Claim | How to verify | False positive if... |
|-------|--------------|---------------------|
| \"Full CRUD\" | Test each of C/R/U/D separately | Only READ works |
| \"Can DELETE user\" | DELETE then GET to confirm gone | User still exists |
| \"Can UPDATE data\" | PATCH then GET to verify change | Data unchanged |
| \"Can INSERT data\" | POST then GET to verify exists | Record not found |

### Severity Rules
- READ-only access on non-sensitive data = medium at most, NOT critical
- READ access on sensitive data (PII, credentials) = high
- Verified WRITE/DELETE on other users' data = critical
- \"Potential\" or \"possible\" = do NOT report. Only report CONFIRMED findings with before/after proof
- If an operation returns HTTP 200 but data is unchanged, explicitly state \"NOT vulnerable — RLS/authorization blocked the operation\"

### Report Format
For each confirmed vulnerability, include:
- Before state (exact data before attack)
- Attack request (full curl command)
- Response (full response body)
- After state (exact data after attack)
- Verdict: VULNERABLE (data changed) or SAFE (data unchanged)";

const ASK_SYSTEM_PROMPT_ASK: &str = "You are a security expert assistant analyzing a penetration testing report generated by Strix. Answer questions about the vulnerabilities, their impact, remediation strategies, and security best practices. Be concise and technical.";

/// Kill a child process and its entire process group (spawned with detached/process_group(0)).
/// Matches TypeScript `killProcessGroup()`.
#[cfg(unix)]
fn kill_process_group(pid: u32) {
    if pid == 0 {
        return;
    }
    use nix::sys::signal::{killpg, Signal};
    use nix::unistd::Pid;
    if let Err(_) = killpg(Pid::from_raw(pid as i32), Signal::SIGTERM) {
        // Fallback: kill just the process
        let _ = nix::sys::signal::kill(Pid::from_raw(pid as i32), Signal::SIGTERM);
    }
}

#[cfg(not(unix))]
fn kill_process_group(_pid: u32) {}

/// Graceful shutdown: save all active Ask AI session state to DB.
/// Call this before exiting to preserve partial responses.
pub fn save_active_ask_sessions(state: &AppState) {
    let processes = state.active_ask_processes.lock().unwrap();
    for (id, proc) in processes.iter() {
        // Save claudeSessionId if this was a new session
        if !proc.is_resume {
            let _ = state.db.update_chat_session_claude_id(
                &proc.web_session_id,
                &proc.user_id,
                &proc.claude_session_id,
                Some(&proc.current_mode),
            );
        }
        // Save accumulated assistant response
        let text = proc.accumulated_text.trim();
        if !text.is_empty() {
            let message = ChatMessageRecord {
                id: uuid::Uuid::new_v4().to_string(),
                session_id: proc.web_session_id.clone(),
                role: "assistant".to_string(),
                content: text.to_string(),
                is_execute: if proc.current_mode == "execute" {
                    Some(true)
                } else {
                    None
                },
                blocks: None,
                created_at: chrono::Utc::now().to_rfc3339(),
            };
            if state.db.add_chat_message(&message).is_ok() {
                tracing::info!(
                    "[Shutdown] Saved partial assistant response for session {} ({} chars)",
                    proc.web_session_id,
                    text.len()
                );
            }
        }
        // Kill the process
        kill_process_group(proc.pid);
        tracing::info!("[Shutdown] Killed ask process {}", id);
    }
}

/// Build scan context string for Ask AI prompts.
fn build_scan_context(db: &AppDb, scan_id: Option<&str>) -> String {
    let scan_id = match scan_id {
        Some(id) if !id.is_empty() => id,
        _ => return String::new(),
    };
    let scan = match db.get_scan(scan_id) {
        Ok(Some(s)) => s,
        _ => return String::new(),
    };
    let vulns = db.get_vulns_by_scan(scan_id).unwrap_or_default();

    let mut context = format!(
        "## Scan Context\nTarget: {} ({})\nStatus: {}\nMode: {}\n",
        scan.target,
        scan.target_type.as_str(),
        scan.status.as_str(),
        &scan.mode,
    );

    if !vulns.is_empty() {
        context.push_str(&format!(
            "\n## Vulnerabilities Found ({})\n",
            vulns.len()
        ));
        for v in &vulns {
            context.push_str(&format!(
                "\n### [{}] {}\n",
                v.severity.as_str().to_uppercase(),
                v.title
            ));
            if let Some(ref url) = v.affected_url {
                context.push_str(&format!("Affected URL: {}\n", url));
            }
            if !v.description.is_empty() {
                context.push_str(&format!("Description: {}\n", v.description));
            }
            if let Some(ref poc) = v.proof_of_concept {
                context.push_str(&format!("PoC: {}\n", poc));
            }
            if let Some(ref impact) = v.impact {
                context.push_str(&format!("Impact: {}\n", impact));
            }
            if let Some(ref remediation) = v.remediation {
                context.push_str(&format!("Remediation: {}\n", remediation));
            }
        }
    }
    context
}

/// Build the full prompt for Ask AI.
fn build_ask_prompt(
    is_resume: bool,
    is_execute: bool,
    question: &str,
    selected_text: Option<&str>,
    history: Option<&Vec<HistoryMessage>>,
    context: &str,
) -> String {
    if is_resume {
        // RESUME: Claude CLI has full context, just send the new question
        let mut prompt = String::new();
        if let Some(text) = selected_text {
            prompt.push_str(&format!(
                "[Selected text from report]: \"{}\"\n\n",
                text
            ));
        }
        if is_execute {
            prompt.push_str(&format!("Task: {}", question));
        } else {
            prompt.push_str(question);
        }
        return prompt;
    }

    // NEW session: include system prompt, context, and history
    let system_prompt = if is_execute {
        ASK_SYSTEM_PROMPT_EXECUTE
    } else {
        ASK_SYSTEM_PROMPT_ASK
    };

    let mut prompt = format!("{}\n\n{}\n", system_prompt, context);

    if let Some(history) = history {
        if !history.is_empty() {
            prompt.push_str("\nPrevious conversation:\n");
            for msg in history {
                let label = if msg.role == "user" {
                    "User"
                } else {
                    "Assistant"
                };
                prompt.push_str(&format!("{}: {}\n", label, msg.content));
            }
            prompt.push('\n');
        }
    }

    if let Some(text) = selected_text {
        prompt.push_str(&format!(
            "[Selected text from report]: \"{}\"\n\n",
            text
        ));
    }

    if is_execute {
        prompt.push_str(&format!("Task: {}", question));
    } else {
        prompt.push_str(&format!("Question: {}", question));
    }

    prompt
}

/// POST /api/ask — Ask AI via SSE streaming through Claude CLI.
/// Supports ask mode (lightweight Q&A) and execute mode (full security testing).
async fn ask_ai(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<AskRequest>,
) -> Response {
    let question = body.question.trim().to_string();
    if question.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Question is required"})),
        )
            .into_response();
    }

    let is_execute = body.mode.as_deref() == Some("execute");
    let current_mode = if is_execute { "execute" } else { "ask" };
    let web_session_id = body.session_id.clone();

    // Get user_id from header (for session DB ops)
    let user_id = headers
        .get("x-strix-user-id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("anonymous")
        .to_string();

    // Look up web session to get claudeSessionId
    let session = web_session_id
        .as_ref()
        .and_then(|id| state.db.get_chat_session_by_id(id).ok().flatten());

    // Resume only if we have a CLI session AND it was created in the same mode
    let mode_changed = session
        .as_ref()
        .map(|s| {
            s.claude_session_id.is_some()
                && s.claude_session_mode.as_deref() != Some(current_mode)
        })
        .unwrap_or(false);
    let is_resume = session
        .as_ref()
        .map(|s| s.claude_session_id.is_some())
        .unwrap_or(false)
        && !mode_changed;

    if mode_changed {
        tracing::info!(
            "[Ask AI] Mode changed from {:?} to {}, creating new CLI session",
            session
                .as_ref()
                .and_then(|s| s.claude_session_mode.as_deref()),
            current_mode
        );
    }

    // Build context (only needed for first message or mode change)
    let context = if !is_resume {
        build_scan_context(&state.db, body.scan_id.as_deref())
    } else {
        String::new()
    };

    // Build prompt
    let prompt = build_ask_prompt(
        is_resume,
        is_execute,
        &question,
        body.selected_text.as_deref(),
        body.history.as_ref(),
        &context,
    );

    // Set up SSE
    let (sender, sse) = setup_sse();

    // Register SSE stream for compacting notifications
    if let Some(ref wsid) = web_session_id {
        state
            .active_ask_streams
            .lock()
            .unwrap()
            .insert(wsid.clone(), sender.clone());
    }

    // Spawn background task for the entire ask session
    let state2 = state.clone();
    tokio::spawn(async move {
        // Docker preflight for execute mode (new session only)
        if is_execute && !is_resume {
            let preflight_sender = sender.clone();
            let docker_result = ensure_docker_ready_with_steps(
                move |step| {
                    preflight_sender.send_json(&json!({
                        "type": "preflight_step",
                        "step": step.step,
                        "totalSteps": step.total_steps,
                        "id": step.id,
                        "label": step.label,
                        "status": step.status,
                        "detail": step.detail,
                    }));
                },
                90_000,
            )
            .await;

            if let Err(e) = docker_result {
                tracing::error!("[Ask AI] Docker preflight failed: {}", e);
                sender.send_json(&json!({"error": e.to_string()}));
                sender.send_done();
                cleanup_ask_tracking(&state2, &web_session_id, None);
                return;
            }
            sender.send_json(&json!({"type": "preflight_done"}));
        }

        // Build CLI args
        let mut args: Vec<String> = Vec::new();
        let claude_session_id;

        if is_resume {
            claude_session_id = session
                .as_ref()
                .and_then(|s| s.claude_session_id.clone())
                .unwrap_or_default();
            args.push("--resume".into());
            args.push(claude_session_id.clone());
        } else {
            claude_session_id = uuid::Uuid::new_v4().to_string();
            args.push("--session-id".into());
            args.push(claude_session_id.clone());
        }

        // Both modes use stream-json for real-time token streaming
        args.extend(
            ["--output-format", "stream-json", "--verbose"]
                .iter()
                .map(|s| s.to_string()),
        );

        if is_execute {
            args.push("--dangerously-skip-permissions".into());
        } else {
            args.extend(
                [
                    "--mcp-config",
                    r#"{"mcpServers":{}}"#,
                    "--strict-mcp-config",
                ]
                .iter()
                .map(|s| s.to_string()),
            );
            args.extend(
                ["--max-turns", "1", "--model", "sonnet"]
                    .iter()
                    .map(|s| s.to_string()),
            );
        }

        tracing::info!(
            "[Ask AI] Spawning claude in {} mode, {} session ({} chars)",
            if is_execute { "EXECUTE" } else { "ASK" },
            if is_resume { "RESUME" } else { "NEW" },
            prompt.len(),
        );

        // Determine CWD
        let cwd = session
            .as_ref()
            .and_then(|s| s.cwd.clone())
            .or_else(|| dirs::home_dir().map(|p| p.to_string_lossy().to_string()))
            .unwrap_or_else(|| "/tmp".to_string());

        // Spawn claude process
        let mut cmd = tokio::process::Command::new("claude");
        cmd.args(&args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .current_dir(&cwd);

        if let Some(ref wsid) = web_session_id {
            cmd.env("STRIX_CHAT_SESSION_ID", wsid);
        }

        // Note: Tokio's Command doesn't expose process_group directly.
        // We rely on SIGTERM to the process (Claude CLI handles child cleanup).

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                tracing::error!("[Ask AI] Failed to spawn claude: {}", e);
                sender.send_json(&json!({"error": format!("Failed to start Claude: {}", e)}));
                sender.send_done();
                cleanup_ask_tracking(&state2, &web_session_id, None);
                return;
            }
        };

        let child_pid = child.id().unwrap_or(0);

        // Write prompt to stdin, then close
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(prompt.as_bytes()).await;
            drop(stdin);
        }

        // Track process for graceful shutdown
        let process_id = uuid::Uuid::new_v4().to_string();
        if web_session_id.is_some() {
            state2.active_ask_processes.lock().unwrap().insert(
                process_id.clone(),
                ActiveAskProcess {
                    pid: child_pid,
                    web_session_id: web_session_id.clone().unwrap_or_default(),
                    user_id: user_id.clone(),
                    claude_session_id: claude_session_id.clone(),
                    current_mode: current_mode.to_string(),
                    is_resume,
                    accumulated_text: String::new(),
                },
            );
        }

        // Read stderr in background
        let stderr_buf = Arc::new(std::sync::Mutex::new(String::new()));
        if let Some(stderr) = child.stderr.take() {
            let buf = stderr_buf.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    tracing::debug!("[Ask AI stderr] {}", line);
                    let mut b = buf.lock().unwrap();
                    b.push_str(&line);
                    b.push('\n');
                }
            });
        }

        // Timeout for ask mode (3 min); no timeout for execute mode
        let timeout_ms: u64 = if is_execute { 0 } else { 3 * 60 * 1000 };
        let killed_by_timeout = Arc::new(AtomicBool::new(false));
        let timeout_handle = if timeout_ms > 0 {
            let killed = killed_by_timeout.clone();
            let pid = child_pid;
            Some(tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(timeout_ms)).await;
                killed.store(true, Ordering::Relaxed);
                tracing::info!(
                    "[Ask AI] Ask timeout ({} min), killing process",
                    timeout_ms / 60000
                );
                kill_process_group(pid);
            }))
        } else {
            None
        };

        // Client disconnect detection
        let disconnect_handle = {
            let sender_check = sender.clone();
            let pid = child_pid;
            tokio::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_millis(500)).await;
                    if sender_check.is_closed() {
                        tracing::info!("[Ask AI] Client disconnected, killing process");
                        kill_process_group(pid);
                        break;
                    }
                }
            })
        };

        // Parse stream-json events from stdout and forward as typed SSE messages
        let mut text_sent = false;
        if let Some(stdout) = child.stdout.take() {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if line.trim().is_empty() {
                    continue;
                }
                let event: Value = match serde_json::from_str(&line) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                let event_type = event
                    .get("type")
                    .and_then(|t| t.as_str())
                    .unwrap_or("");

                match event_type {
                    "system" => {
                        if event.get("subtype").and_then(|s| s.as_str()) == Some("init") {
                            sender.send_json(&json!({"type": "init"}));
                        }
                    }
                    "assistant" => {
                        let content = event
                            .get("message")
                            .and_then(|m| m.get("content"))
                            .and_then(|c| c.as_array());
                        if let Some(blocks) = content {
                            for block in blocks {
                                let block_type = block
                                    .get("type")
                                    .and_then(|t| t.as_str())
                                    .unwrap_or("");
                                match block_type {
                                    "text" => {
                                        if let Some(text) =
                                            block.get("text").and_then(|t| t.as_str())
                                        {
                                            text_sent = true;
                                            // Accumulate for graceful shutdown
                                            if let Ok(mut procs) =
                                                state2.active_ask_processes.lock()
                                            {
                                                if let Some(proc) =
                                                    procs.get_mut(&process_id)
                                                {
                                                    proc.accumulated_text
                                                        .push_str(text);
                                                }
                                            }
                                            sender.send_json(
                                                &json!({"type": "text", "text": text}),
                                            );
                                        }
                                    }
                                    "tool_use" => {
                                        sender.send_json(&json!({
                                            "type": "tool_use",
                                            "name": block.get("name"),
                                            "toolUseId": block.get("id"),
                                            "input": block.get("input"),
                                        }));
                                    }
                                    _ => {}
                                }
                            }
                        }
                    }
                    "user" => {
                        let content = event
                            .get("message")
                            .and_then(|m| m.get("content"))
                            .and_then(|c| c.as_array());
                        if let Some(blocks) = content {
                            for block in blocks {
                                if block.get("type").and_then(|t| t.as_str())
                                    == Some("tool_result")
                                {
                                    let result_content = block
                                        .get("content")
                                        .map(|c| {
                                            if c.is_string() {
                                                c.as_str()
                                                    .unwrap_or("")
                                                    .to_string()
                                            } else {
                                                serde_json::to_string(c)
                                                    .unwrap_or_default()
                                            }
                                        })
                                        .unwrap_or_default();
                                    let truncated = if result_content.len() > 3000 {
                                        format!(
                                            "{}\n...(truncated)",
                                            &result_content[..3000]
                                        )
                                    } else {
                                        result_content
                                    };
                                    sender.send_json(&json!({
                                        "type": "tool_result",
                                        "toolUseId": block.get("tool_use_id"),
                                        "content": truncated,
                                        "isError": block.get("is_error")
                                            .and_then(|e| e.as_bool())
                                            .unwrap_or(false),
                                    }));
                                }
                            }
                        }
                    }
                    "result" => {
                        let is_error = event
                            .get("is_error")
                            .and_then(|e| e.as_bool())
                            .unwrap_or(false);
                        let subtype = event
                            .get("subtype")
                            .and_then(|s| s.as_str())
                            .unwrap_or("");

                        if is_error
                            || subtype == "error"
                            || subtype == "error_during_execution"
                        {
                            let error_msg = event
                                .get("errors")
                                .and_then(|e| e.as_array())
                                .and_then(|arr| arr.first())
                                .and_then(|e| e.as_str())
                                .or_else(|| {
                                    event.get("result").and_then(|r| r.as_str())
                                })
                                .or_else(|| {
                                    event.get("error").and_then(|e| e.as_str())
                                })
                                .unwrap_or("Unknown error");
                            tracing::error!(
                                "[Ask AI] Result error: {}",
                                error_msg
                            );
                            sender.send_json(&json!({"error": error_msg}));
                        } else if !text_sent {
                            if let Some(result_text) =
                                event.get("result").and_then(|r| r.as_str())
                            {
                                if !result_text.is_empty() {
                                    text_sent = true;
                                    if let Ok(mut procs) =
                                        state2.active_ask_processes.lock()
                                    {
                                        if let Some(proc) =
                                            procs.get_mut(&process_id)
                                        {
                                            proc.accumulated_text
                                                .push_str(result_text);
                                        }
                                    }
                                    sender.send_json(
                                        &json!({"type": "text", "text": result_text}),
                                    );
                                }
                            }
                        }

                        let result = event
                            .get("result")
                            .and_then(|r| r.as_str())
                            .unwrap_or("");
                        sender
                            .send_json(&json!({"type": "result", "result": result}));
                    }
                    _ => {}
                }
            }
        }

        // Cancel timeout and disconnect detection tasks
        if let Some(h) = timeout_handle {
            h.abort();
        }
        disconnect_handle.abort();

        // Wait for process exit
        let exit_status = child.wait().await;
        let exit_code = exit_status.ok().and_then(|s| s.code()).unwrap_or(-1);
        let was_timeout = killed_by_timeout.load(Ordering::Relaxed);

        tracing::info!(
            "[Ask AI] Process exited with code {}{}",
            exit_code,
            if was_timeout { " (timeout)" } else { "" }
        );

        // Save claudeSessionId + mode to DB for new sessions
        if !is_resume {
            if let Some(ref wsid) = web_session_id {
                let _ = state2.db.update_chat_session_claude_id(
                    wsid,
                    &user_id,
                    &claude_session_id,
                    Some(current_mode),
                );
            }
        }

        // Send timeout event to frontend
        if was_timeout {
            sender.send_json(&json!({
                "type": "timeout",
                "timeoutMinutes": timeout_ms as f64 / 60000.0,
            }));
        }

        // Surface error if process failed without sending any text
        if exit_code != 0 && !text_sent {
            let stderr_text = stderr_buf.lock().unwrap().trim().to_string();
            if !stderr_text.is_empty() {
                sender.send_json(&json!({"error": stderr_text}));
            }
        }

        // Send [DONE] sentinel
        sender.send_done();

        // Cleanup tracking maps
        cleanup_ask_tracking(&state2, &web_session_id, Some(&process_id));
    });

    sse.into_response()
}

/// Remove an Ask AI session from tracking maps.
fn cleanup_ask_tracking(
    state: &Arc<AppState>,
    web_session_id: &Option<String>,
    process_id: Option<&str>,
) {
    if let Some(ref wsid) = web_session_id {
        state.active_ask_streams.lock().unwrap().remove(wsid);
    }
    if let Some(pid) = process_id {
        state.active_ask_processes.lock().unwrap().remove(pid);
    }
}

/// GET /api/scans/:id/report — Download scan vulnerability report as PDF.
async fn get_scan_report(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> Response {
    let db = &state.db;

    let scan = match db.get_scan(&id) {
        Ok(Some(s)) => s,
        Ok(None) => {
            return (StatusCode::NOT_FOUND, Json(json!({"error": "Scan not found"}))).into_response()
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": format!("DB error: {}", e)})),
            )
                .into_response()
        }
    };

    let vulns = db.get_vulns_by_scan(&id).unwrap_or_default();
    let agents = db.get_agents_by_scan(&id).unwrap_or_default();
    let tools = db.get_tools_by_scan(&id).unwrap_or_default();

    let bytes = generate_scan_pdf(&scan, &vulns, &agents, &tools);

    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, "application/pdf".parse().unwrap());
    headers.insert(
        header::CONTENT_DISPOSITION,
        format!("attachment; filename=\"strix-report-{}.pdf\"", id)
            .parse()
            .unwrap(),
    );
    headers.insert(header::CACHE_CONTROL, "no-store".parse().unwrap());

    (StatusCode::OK, headers, bytes).into_response()
}

/// GET /api/chat/sessions/:id/export/pdf — Export chat session as PDF.
async fn export_chat_pdf(
    Path(id): Path<String>,
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> Response {
    let user_id = match headers.get("x-strix-user-id").and_then(|v| v.to_str().ok()) {
        Some(uid) => uid.to_string(),
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Missing user ID"})),
            )
                .into_response()
        }
    };

    let session = match state.db.get_chat_session(&id, &user_id) {
        Ok(Some(s)) => s,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Session not found"})),
            )
                .into_response()
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": format!("DB error: {}", e)})),
            )
                .into_response()
        }
    };

    let messages = state
        .db
        .get_chat_messages(&id, &user_id)
        .unwrap_or_default();

    let bytes = generate_chat_pdf(&session, &messages);

    let mut resp_headers = HeaderMap::new();
    resp_headers.insert(header::CONTENT_TYPE, "application/pdf".parse().unwrap());
    resp_headers.insert(
        header::CONTENT_DISPOSITION,
        format!("attachment; filename=\"chat-export-{}.pdf\"", id)
            .parse()
            .unwrap(),
    );

    (StatusCode::OK, resp_headers, bytes).into_response()
}

/// GET /api/chat/sessions/:id/export/docx — Export chat session as DOCX.
async fn export_chat_docx(
    Path(id): Path<String>,
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> Response {
    let user_id = match headers.get("x-strix-user-id").and_then(|v| v.to_str().ok()) {
        Some(uid) => uid.to_string(),
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Missing user ID"})),
            )
                .into_response()
        }
    };

    let session = match state.db.get_chat_session(&id, &user_id) {
        Ok(Some(s)) => s,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Session not found"})),
            )
                .into_response()
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": format!("DB error: {}", e)})),
            )
                .into_response()
        }
    };

    let messages = state
        .db
        .get_chat_messages(&id, &user_id)
        .unwrap_or_default();

    match generate_chat_docx(&session, &messages) {
        Ok(bytes) => {
            let mut resp_headers = HeaderMap::new();
            resp_headers.insert(
                header::CONTENT_TYPE,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    .parse()
                    .unwrap(),
            );
            resp_headers.insert(
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"chat-export-{}.docx\"", id)
                    .parse()
                    .unwrap(),
            );
            (StatusCode::OK, resp_headers, bytes).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": format!("DOCX generation failed: {:?}", e)})),
        )
            .into_response(),
    }
}
