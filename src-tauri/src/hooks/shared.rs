use std::io::Read;

use serde::Deserialize;
use serde_json::Value;

/// Large output configuration (matches TypeScript LARGE_OUTPUT_CONFIG).
const MAX_OUTPUT_SIZE: usize = 10_000;
const TRUNCATED_PREVIEW_SIZE: usize = 1_000;

/// Hook input structure sent by Claude Code via stdin.
/// Matches TypeScript `HookInput` in shared/src/index.ts.
#[derive(Debug, Deserialize)]
pub struct HookInput {
    pub hook_event_name: String,
    pub session_id: String,
    pub transcript_path: String,
    pub tool_name: Option<String>,
    pub tool_input: Option<Value>,
    pub tool_use_id: Option<String>,
    pub tool_response: Option<Value>,
    pub cwd: Option<String>,
}

/// Read all of stdin into a String (synchronous).
/// Matches TypeScript `readStdin()` in hooks/utils.ts.
pub fn read_stdin() -> String {
    let mut buf = String::new();
    std::io::stdin().read_to_string(&mut buf).unwrap_or(0);
    buf
}

/// Return the Strix data directory (~/.strix-webui).
pub fn data_dir() -> std::path::PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("/tmp"))
        .join(".strix-webui")
}

/// Append a JSON event line to events.jsonl.
/// Matches TypeScript `writeEvent()` in hooks/utils.ts.
pub fn write_event(event: &Value) {
    use std::io::Write;
    let event_dir = data_dir().join("events");
    std::fs::create_dir_all(&event_dir).ok();
    let path = event_dir.join("events.jsonl");
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        if let Ok(json) = serde_json::to_string(event) {
            let _ = writeln!(file, "{}", json);
        }
    }
}

/// Save full content to ~/.strix-webui/content/{uuid}.json.
/// Returns the content ID.
fn save_full_content(content: &Value) -> String {
    let content_dir = data_dir().join("content");
    std::fs::create_dir_all(&content_dir).ok();

    let content_id = uuid::Uuid::new_v4().to_string();
    let file_path = content_dir.join(format!("{}.json", content_id));
    if let Ok(json) = serde_json::to_string(content) {
        std::fs::write(file_path, json).ok();
    }
    content_id
}

/// Truncate tool output if it exceeds MAX_OUTPUT_SIZE bytes.
/// Large outputs are saved to the content directory, replaced with a truncated preview.
/// Matches TypeScript `truncateOutputIfNeeded()` in hooks/utils.ts.
pub fn truncate_output_if_needed(output: &Value) -> Value {
    if output.is_null() {
        return output.clone();
    }

    let serialized = serde_json::to_string(output).unwrap_or_default();

    if serialized.len() <= MAX_OUTPUT_SIZE {
        return output.clone();
    }

    let content_id = save_full_content(output);

    let preview = if let Some(s) = output.as_str() {
        // If the value is a string, truncate the string content
        let end = s
            .char_indices()
            .nth(TRUNCATED_PREVIEW_SIZE)
            .map(|(i, _)| i)
            .unwrap_or(s.len());
        s[..end].to_string()
    } else {
        // Otherwise truncate the JSON representation
        let end = serialized
            .char_indices()
            .nth(TRUNCATED_PREVIEW_SIZE)
            .map(|(i, _)| i)
            .unwrap_or(serialized.len());
        serialized[..end].to_string()
    };

    let suffix = if serialized.len() > TRUNCATED_PREVIEW_SIZE {
        "..."
    } else {
        ""
    };

    serde_json::json!({
        "__truncated": true,
        "__contentId": content_id,
        "__originalSize": serialized.len(),
        "__preview": format!("{}{}", preview, suffix),
    })
}
