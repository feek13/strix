//! PreCompact hook — runs before Claude Code compacts context.
//!
//! Notifies the Strix backend so it can inform the frontend that
//! the assistant is compacting its context window.
//!
//! Matches TypeScript `hooks/pre-compact.ts`.

use strix::hooks::shared::read_stdin;

fn main() {
    match run() {
        Ok(()) => {}
        Err(e) => {
            eprintln!("[pre-compact hook error] {}", e);
        }
    }
    // Always allow compaction to continue
    println!(r#"{{"continue":true}}"#);
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let input = read_stdin();
    let parsed: serde_json::Value = serde_json::from_str(&input)?;

    let chat_session_id = std::env::var("STRIX_CHAT_SESSION_ID").ok();

    // Only notify for Ask AI sessions (not scans or terminal claude usage)
    if let Some(ref session_id) = chat_session_id {
        let port = std::env::var("PORT").unwrap_or_else(|_| "3000".into());
        let body = serde_json::json!({
            "chatSessionId": session_id,
            "claudeSessionId": parsed.get("session_id").and_then(|s| s.as_str()).unwrap_or(""),
            "trigger": parsed.get("trigger").and_then(|t| t.as_str()).unwrap_or("auto"),
        });

        // Fire-and-forget HTTP POST to backend
        let _ = http_post(
            &port,
            "/api/internal/compacting",
            &serde_json::to_string(&body).unwrap_or_default(),
        );
    }

    Ok(())
}

/// Simple synchronous HTTP POST to localhost (no external dependencies).
fn http_post(port: &str, path: &str, body: &str) -> Result<(), Box<dyn std::error::Error>> {
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::time::Duration;

    let addr = format!("127.0.0.1:{}", port);
    let mut stream = TcpStream::connect_timeout(
        &addr.parse()?,
        Duration::from_secs(2),
    )?;
    stream.set_write_timeout(Some(Duration::from_secs(2)))?;
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;

    let request = format!(
        "POST {} HTTP/1.1\r\n\
         Host: localhost:{}\r\n\
         Content-Type: application/json\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\
         \r\n\
         {}",
        path,
        port,
        body.len(),
        body
    );
    stream.write_all(request.as_bytes())?;

    // Read response (we don't care about the content, just drain it)
    let mut response = Vec::new();
    stream.read_to_end(&mut response).ok();

    Ok(())
}
