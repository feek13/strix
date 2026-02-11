use std::io::Write;

use crate::models::InternalEvent;
use crate::store::AppDb;

/// Append an InternalEvent to the events JSONL file.
/// Matches the TypeScript `writeEvent()` in hooks/utils.ts.
pub fn write_event(event: &InternalEvent) {
    let event_dir = AppDb::data_dir().join("events");
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
