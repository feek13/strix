use std::path::PathBuf;

use serde_json::{json, Value};

/// Register Strix hooks in ~/.claude/settings.json.
/// Points to the compiled Rust hook binaries.
///
/// Matches the TypeScript install-hooks.sh script.
pub fn install_hooks(hook_dir: &std::path::Path) -> anyhow::Result<()> {
    let settings_file = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join(".claude")
        .join("settings.json");

    // Create directory if needed
    if let Some(parent) = settings_file.parent() {
        std::fs::create_dir_all(parent)?;
    }

    // Read existing settings or create empty object
    let mut settings: Value = if settings_file.exists() {
        let raw = std::fs::read_to_string(&settings_file)?;
        serde_json::from_str(&raw).unwrap_or(json!({}))
    } else {
        json!({})
    };

    // Ensure hooks object exists
    if !settings.get("hooks").is_some() {
        settings["hooks"] = json!({});
    }

    let hook_types = [
        ("PreToolUse", "strix-hook-pre-tool-use"),
        ("PostToolUse", "strix-hook-post-tool-use"),
        ("SubagentStop", "strix-hook-subagent-stop"),
        ("PreCompact", "strix-hook-pre-compact"),
    ];

    for (hook_type, binary_name) in &hook_types {
        let binary_path = hook_dir.join(binary_name);
        let command = binary_path.to_string_lossy().to_string();

        // Get or create the hook array
        let arr = settings["hooks"]
            .get_mut(*hook_type)
            .and_then(|v| v.as_array_mut());

        let mut entries: Vec<Value> = if let Some(arr) = arr {
            // Filter out existing strix hooks
            arr.iter()
                .filter(|entry| {
                    let hooks = entry.get("hooks").and_then(|h| h.as_array());
                    !hooks
                        .map(|h| h.iter().any(|cmd| {
                            // Check plain string format (legacy)
                            let is_str = cmd.as_str()
                                .map(|s| s.contains("strix-hook-"))
                                .unwrap_or(false);
                            // Check object format {"type":"command","command":"..."}
                            let is_obj = cmd.get("command")
                                .and_then(|c| c.as_str())
                                .map(|s| s.contains("strix-hook-"))
                                .unwrap_or(false);
                            is_str || is_obj
                        }))
                        .unwrap_or(false)
                })
                .cloned()
                .collect()
        } else {
            Vec::new()
        };

        // Add new hook (object format required by Claude Code)
        entries.push(json!({
            "matcher": "",
            "hooks": [{"type": "command", "command": command}]
        }));

        settings["hooks"][*hook_type] = Value::Array(entries);
    }

    // Write back
    let formatted = serde_json::to_string_pretty(&settings)?;
    std::fs::write(&settings_file, formatted)?;

    tracing::info!("[Hooks] Installed hooks to {:?}", settings_file);
    Ok(())
}
