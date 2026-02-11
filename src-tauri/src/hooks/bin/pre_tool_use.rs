//! PreToolUse hook — runs before each tool execution.
//!
//! Detects agent creation (Task / create_agent), records all tool starts,
//! and detects vulnerability reports.
//!
//! Matches TypeScript `hooks/pre-tool-use.ts`.

use serde_json::json;
use strix::hooks::shared::{read_stdin, write_event, HookInput};

fn main() {
    match run() {
        Ok(()) => {}
        Err(e) => {
            eprintln!("[pre-tool-use hook error] {}", e);
        }
    }
    // Always allow the tool to continue
    println!(r#"{{"continue":true}}"#);
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let input = read_stdin();
    let hook_input: HookInput = serde_json::from_str(&input)?;
    let timestamp = chrono::Utc::now().to_rfc3339();
    let scan_id = std::env::var("STRIX_SCAN_ID").unwrap_or_else(|_| "default".into());

    let tool_name = hook_input.tool_name.as_deref().unwrap_or("");

    // 1. Detect agent creation (Task tool or MCP create_agent)
    if (tool_name == "Task" || tool_name.ends_with("create_agent"))
        && hook_input.tool_use_id.is_some()
    {
        write_event(&json!({
            "type": "AGENT_CREATING",
            "timestamp": timestamp,
            "scanId": scan_id,
            "sessionId": hook_input.session_id,
            "toolUseId": hook_input.tool_use_id,
            "taskInput": hook_input.tool_input.as_ref().unwrap_or(&json!({})),
        }));
    }

    // 2. Record all tool starts
    if let (Some(ref name), Some(ref id)) = (&hook_input.tool_name, &hook_input.tool_use_id) {
        write_event(&json!({
            "type": "TOOL_STARTED",
            "timestamp": timestamp,
            "scanId": scan_id,
            "sessionId": hook_input.session_id,
            "toolUseId": id,
            "toolName": name,
            "toolInput": hook_input.tool_input.as_ref().unwrap_or(&json!({})),
        }));
    }

    // 3. Detect vulnerability reports (tool name may be MCP-prefixed)
    if tool_name.ends_with("create_vulnerability_report") {
        if let Some(ref ti) = hook_input.tool_input {
            write_event(&json!({
                "type": "VULNERABILITY_FOUND",
                "timestamp": timestamp,
                "scanId": scan_id,
                "agentId": "",
                "vulnerability": {
                    "title": ti.get("title").and_then(|t| t.as_str()).unwrap_or("Unknown"),
                    "severity": ti.get("severity").and_then(|s| s.as_str()).unwrap_or("info"),
                    "description": ti.get("content").and_then(|c| c.as_str()).unwrap_or(""),
                },
            }));
        }
    }

    Ok(())
}
