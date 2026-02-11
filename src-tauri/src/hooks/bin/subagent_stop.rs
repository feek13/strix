//! SubagentStop hook — runs when a subagent (Task tool) stops.
//!
//! Records AGENT_STOPPED events.
//!
//! Matches TypeScript `hooks/subagent-stop.ts`.

use serde_json::json;
use strix::hooks::shared::{read_stdin, write_event, HookInput};

fn main() {
    if let Err(e) = run() {
        eprintln!("[subagent-stop hook error] {}", e);
    }
    // No output needed (SubagentStop hooks don't require continue response)
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let input = read_stdin();
    let hook_input: HookInput = serde_json::from_str(&input)?;

    write_event(&json!({
        "type": "AGENT_STOPPED",
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "sessionId": hook_input.session_id,
    }));

    Ok(())
}
