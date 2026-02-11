//! Chat session DOCX export — port of `reports/chat-docx-generator.ts`.
//!
//! Generates a DOCX document using `docx-rs` with: title, session metadata,
//! messages with markdown rendering (headings, code blocks, lists,
//! blockquotes), and tool block summaries.

use std::io::Cursor;

use docx_rs::*;

use crate::models::{ChatMessageRecord, ChatSession};
use super::pdf_writer::{format_date, normalize_content as shared_normalize, truncate_str};

const TOOL_INPUT_TRUNCATE: usize = 200;
const TOOL_RESULT_TRUNCATE: usize = 300;

/// Parsed block from the `blocks` JSON field on assistant messages.
#[derive(serde::Deserialize)]
#[serde(tag = "type")]
enum ParsedBlock {
    #[serde(rename = "text")]
    Text { text: Option<String> },
    #[serde(rename = "tool")]
    Tool { tool: Option<ToolBlock> },
}

#[derive(serde::Deserialize)]
struct ToolBlock {
    name: String,
    status: Option<String>,
    input: Option<serde_json::Value>,
    result: Option<String>,
}

/// Generate a DOCX export for a chat session. Returns the raw bytes.
pub fn generate_chat_docx(
    session: &ChatSession,
    messages: &[ChatMessageRecord],
) -> Result<Vec<u8>, DocxError> {
    let mut doc = Docx::new();

    // ── Title ────────────────────────────────────────────────────
    doc = doc.add_paragraph(
        Paragraph::new()
            .add_run(Run::new().add_text("Chat Export").bold().size(56))
            .align(AlignmentType::Center),
    );

    doc = doc.add_paragraph(
        Paragraph::new()
            .add_run(
                Run::new()
                    .add_text(&session.title)
                    .bold()
                    .size(28)
                    .color("22C55E"),
            )
            .align(AlignmentType::Center),
    );

    // ── Metadata ─────────────────────────────────────────────────
    let mut meta_lines = vec![
        format!("Session created: {}", format_date(&session.created_at)),
        format!("Messages: {}", messages.len()),
    ];
    if !messages.is_empty() {
        let first = format_date(&messages[0].created_at);
        let last = format_date(&messages[messages.len() - 1].created_at);
        meta_lines.push(format!("Time range: {} - {}", first, last));
    }
    for line in &meta_lines {
        doc = doc.add_paragraph(
            Paragraph::new()
                .add_run(Run::new().add_text(line).size(20).color("A0A0A0").italic())
                .align(AlignmentType::Center),
        );
    }

    // Separator
    doc = doc.add_paragraph(Paragraph::new());

    // ── Messages ─────────────────────────────────────────────────
    for msg in messages {
        let role_label = if msg.role == "user" { "User" } else { "Assistant" };
        let role_color = if msg.role == "user" { "60A5FA" } else { "22C55E" };
        let has_blocks = msg.blocks.is_some();

        // Role header
        doc = doc.add_paragraph(
            Paragraph::new()
                .add_run(
                    Run::new()
                        .add_text(role_label)
                        .bold()
                        .size(22)
                        .color(role_color),
                )
                .add_run(
                    Run::new()
                        .add_text(&format!(" - {}", format_date(&msg.created_at)))
                        .size(18)
                        .color("A0A0A0"),
                ),
        );

        // Content
        if has_blocks {
            if let Some(ref blocks_json) = msg.blocks {
                if let Ok(blocks) = serde_json::from_str::<Vec<ParsedBlock>>(blocks_json) {
                    for block in &blocks {
                        match block {
                            ParsedBlock::Text { text: Some(text) } => {
                                let paragraphs = content_to_paragraphs(text);
                                for p in paragraphs {
                                    doc = doc.add_paragraph(p);
                                }
                            }
                            ParsedBlock::Tool { tool: Some(tool) } => {
                                let paragraphs = tool_to_paragraphs(tool);
                                for p in paragraphs {
                                    doc = doc.add_paragraph(p);
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
        } else if !msg.content.is_empty() {
            let paragraphs = content_to_paragraphs(&msg.content);
            for p in paragraphs {
                doc = doc.add_paragraph(p);
            }
        }

        // Separator
        doc = doc.add_paragraph(Paragraph::new());
    }

    if messages.is_empty() {
        doc = doc.add_paragraph(
            Paragraph::new().add_run(
                Run::new()
                    .add_text("No messages in this session.")
                    .italic()
                    .color("A0A0A0"),
            ),
        );
    }

    // Footer
    doc = doc.add_paragraph(
        Paragraph::new()
            .add_run(
                Run::new()
                    .add_text("Exported from Strix")
                    .size(16)
                    .color("A0A0A0")
                    .italic(),
            )
            .align(AlignmentType::Center),
    );

    // Serialize to bytes
    let mut cursor = Cursor::new(Vec::new());
    doc.build().pack(&mut cursor)?;
    Ok(cursor.into_inner())
}

// ── Markdown → Paragraphs ────────────────────────────────────────

/// Convert markdown-ish text into a vector of DOCX paragraphs.
fn content_to_paragraphs(content: &str) -> Vec<Paragraph> {
    let normalized = normalize_content(content);
    let mut paragraphs = Vec::new();
    let lines: Vec<&str> = normalized.split('\n').collect();
    let mut in_code_block = false;

    for line in lines {
        let trimmed = line.trim();

        // Code block toggle
        if trimmed.starts_with("```") {
            in_code_block = !in_code_block;
            continue;
        }

        if in_code_block {
            paragraphs.push(
                Paragraph::new().add_run(
                    Run::new()
                        .add_text(line)
                        .fonts(RunFonts::new().ascii("Courier New"))
                        .size(18)
                        .color("22C55E"),
                ),
            );
            continue;
        }

        // Headings
        if line.starts_with("#### ") {
            paragraphs.push(
                Paragraph::new()
                    .add_run(Run::new().add_text(strip_md(&line[5..])).bold().size(22)),
            );
            continue;
        }
        if line.starts_with("### ") {
            paragraphs.push(
                Paragraph::new()
                    .add_run(Run::new().add_text(strip_md(&line[4..])).bold().size(24)),
            );
            continue;
        }
        if line.starts_with("## ") {
            paragraphs.push(
                Paragraph::new()
                    .add_run(Run::new().add_text(strip_md(&line[3..])).bold().size(28)),
            );
            continue;
        }
        if line.starts_with("# ") {
            paragraphs.push(
                Paragraph::new()
                    .add_run(Run::new().add_text(strip_md(&line[2..])).bold().size(32)),
            );
            continue;
        }

        // Horizontal rule
        if is_hr(trimmed) {
            paragraphs.push(Paragraph::new());
            continue;
        }

        // Empty line
        if trimmed.is_empty() {
            paragraphs.push(Paragraph::new());
            continue;
        }

        // Unordered list items
        if trimmed.starts_with("- ") || trimmed.starts_with("* ") {
            let content = &trimmed[2..];
            let runs = markdown_to_runs(&format!("\u{2022}  {}", content));
            let mut p = Paragraph::new();
            for run in runs {
                p = p.add_run(run);
            }
            paragraphs.push(p);
            continue;
        }

        // Ordered list items
        if is_ordered_list(trimmed) {
            let runs = markdown_to_runs(trimmed);
            let mut p = Paragraph::new();
            for run in runs {
                p = p.add_run(run);
            }
            paragraphs.push(p);
            continue;
        }

        // Blockquote
        if line.starts_with("> ") {
            paragraphs.push(
                Paragraph::new().add_run(
                    Run::new()
                        .add_text(strip_md(&line[2..]))
                        .italic()
                        .color("666666"),
                ),
            );
            continue;
        }

        // Regular text with inline formatting
        let runs = markdown_to_runs(line);
        let mut p = Paragraph::new();
        for run in runs {
            p = p.add_run(run);
        }
        paragraphs.push(p);
    }

    paragraphs
}

/// Convert a tool block into DOCX paragraphs.
fn tool_to_paragraphs(tool: &ToolBlock) -> Vec<Paragraph> {
    let mut paragraphs = Vec::new();

    let status_icon = match tool.status.as_deref() {
        Some("done") => "OK",
        Some("error") => "ERR",
        _ => "...",
    };

    paragraphs.push(
        Paragraph::new().add_run(
            Run::new()
                .add_text(&format!("Tool: {} [{}]", tool.name, status_icon))
                .fonts(RunFonts::new().ascii("Courier New"))
                .size(18)
                .bold()
                .color("A0A0A0"),
        ),
    );

    if let Some(ref input) = tool.input {
        let input_str = serde_json::to_string(input).unwrap_or_default();
        let truncated = truncate_str(&input_str, TOOL_INPUT_TRUNCATE);
        paragraphs.push(
            Paragraph::new()
                .add_run(
                    Run::new()
                        .add_text("Input: ")
                        .fonts(RunFonts::new().ascii("Courier New"))
                        .size(16)
                        .color("A0A0A0")
                        .bold(),
                )
                .add_run(
                    Run::new()
                        .add_text(&truncated)
                        .fonts(RunFonts::new().ascii("Courier New"))
                        .size(16)
                        .color("A0A0A0"),
                ),
        );
    }

    if let Some(ref result) = tool.result {
        let truncated = truncate_str(result, TOOL_RESULT_TRUNCATE);
        paragraphs.push(
            Paragraph::new()
                .add_run(
                    Run::new()
                        .add_text("Result: ")
                        .fonts(RunFonts::new().ascii("Courier New"))
                        .size(16)
                        .color("A0A0A0")
                        .bold(),
                )
                .add_run(
                    Run::new()
                        .add_text(&truncated)
                        .fonts(RunFonts::new().ascii("Courier New"))
                        .size(16)
                        .color("A0A0A0"),
                ),
        );
    }

    paragraphs
}

// ── Inline markdown → Runs ───────────────────────────────────────

/// Convert markdown-ish text to DOCX TextRuns (handles `**bold**` and `` `code` ``).
fn markdown_to_runs(text: &str) -> Vec<Run> {
    let mut runs = Vec::new();
    let mut remaining = text;

    while !remaining.is_empty() {
        // Look for bold markers
        if let Some(bold_start) = remaining.find("**") {
            if bold_start > 0 {
                runs.push(Run::new().add_text(&remaining[..bold_start]));
            }
            let after_start = &remaining[bold_start + 2..];
            if let Some(bold_end) = after_start.find("**") {
                runs.push(Run::new().add_text(&after_start[..bold_end]).bold());
                remaining = &after_start[bold_end + 2..];
                continue;
            } else {
                // No closing **, treat as literal
                runs.push(Run::new().add_text(&remaining[bold_start..]));
                break;
            }
        }

        // Look for inline code
        if let Some(code_start) = remaining.find('`') {
            if code_start > 0 {
                runs.push(Run::new().add_text(&remaining[..code_start]));
            }
            let after_start = &remaining[code_start + 1..];
            if let Some(code_end) = after_start.find('`') {
                runs.push(
                    Run::new()
                        .add_text(&after_start[..code_end])
                        .fonts(RunFonts::new().ascii("Courier New"))
                        .size(18)
                        .color("22C55E"),
                );
                remaining = &after_start[code_end + 1..];
                continue;
            } else {
                runs.push(Run::new().add_text(&remaining[code_start..]));
                break;
            }
        }

        // No more markers — push remaining text
        runs.push(Run::new().add_text(remaining));
        break;
    }

    if runs.is_empty() {
        runs.push(Run::new().add_text(""));
    }
    runs
}

// ── Helpers ──────────────────────────────────────────────────────

fn normalize_content(text: &str) -> String {
    shared_normalize(text)
}

fn strip_md(text: &str) -> String {
    text.replace("**", "").replace('`', "").replace('*', "")
}

fn is_hr(s: &str) -> bool {
    (s.len() >= 3 && s.chars().all(|c| c == '-'))
        || (s.len() >= 3 && s.chars().all(|c| c == '*'))
}

fn is_ordered_list(s: &str) -> bool {
    s.chars().take_while(|c| c.is_ascii_digit()).count() > 0
        && (s.contains(". ") || s.contains(") "))
}
