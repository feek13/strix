//! PostToolUse hook — runs after each tool execution.
//!
//! Truncates large output (>10KB) and records TOOL_COMPLETED events.
//!
//! Matches TypeScript `hooks/post-tool-use.ts`.

use serde_json::json;
use strix::hooks::shared::{read_stdin, truncate_output_if_needed, write_event, HookInput};

fn main() {
    match run() {
        Ok(()) => {}
        Err(e) => {
            eprintln!("[post-tool-use hook error] {}", e);
        }
    }
    // Always allow continuation
    println!(r#"{{"continue":true}}"#);
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let input = read_stdin();
    let hook_input: HookInput = serde_json::from_str(&input)?;
    let timestamp = chrono::Utc::now().to_rfc3339();
    let scan_id = std::env::var("STRIX_SCAN_ID").unwrap_or_else(|_| "default".into());

    if let (Some(ref name), Some(ref id)) = (&hook_input.tool_name, &hook_input.tool_use_id) {
        let truncated_output = hook_input
            .tool_response
            .as_ref()
            .map(|r| truncate_output_if_needed(r))
            .unwrap_or(json!(null));

        write_event(&json!({
            "type": "TOOL_COMPLETED",
            "timestamp": timestamp,
            "scanId": scan_id,
            "sessionId": hook_input.session_id,
            "toolUseId": id,
            "toolName": name,
            "toolInput": hook_input.tool_input.as_ref().unwrap_or(&json!({})),
            "toolOutput": truncated_output,
        }));
    }

    Ok(())
}
