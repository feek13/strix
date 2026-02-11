//! Chat session PDF export — port of `reports/chat-pdf-generator.ts`.
//!
//! Generates a PDF containing: cover page with session metadata,
//! then all messages rendered with basic markdown support
//! (headings, code blocks, lists, blockquotes, horizontal rules).

use crate::models::{ChatMessageRecord, ChatSession};
use super::pdf_writer::{format_date, normalize_content, strip_markdown, truncate_str, PdfWriter};

const COLOR_TEXT: &str = "#000000";
const COLOR_MUTED: &str = "#A0A0A0";
const COLOR_ACCENT: &str = "#22C55E";
const COLOR_USER: &str = "#60A5FA";


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

/// Generate a PDF export for a chat session.
pub fn generate_chat_pdf(session: &ChatSession, messages: &[ChatMessageRecord]) -> Vec<u8> {
    let mut pdf = PdfWriter::new(&format!("Chat Export - {}", session.title));

    // ════════════════════ Cover Page ════════════════════

    pdf.move_down(20.0);
    pdf.font_bold(28.0);
    pdf.color_hex(COLOR_TEXT);
    pdf.text_centered("Chat Export");
    pdf.move_down(3.0);

    pdf.font_regular(16.0);
    pdf.color_hex(COLOR_ACCENT);
    pdf.text_centered(&session.title);
    pdf.move_down(10.0);

    pdf.font_regular(10.0);
    pdf.color_hex(COLOR_MUTED);
    pdf.text_centered(&format!("Session created: {}", format_date(&session.created_at)));
    pdf.text_centered(&format!("Messages: {}", messages.len()));

    if !messages.is_empty() {
        let first = format_date(&messages[0].created_at);
        let last = format_date(&messages[messages.len() - 1].created_at);
        pdf.text_centered(&format!("Time range: {} - {}", first, last));
    }

    pdf.move_down(25.0);
    pdf.font_regular(9.0);
    pdf.color_hex(COLOR_MUTED);
    pdf.text_centered("Exported from Strix");

    // ════════════════════ Messages ════════════════════

    pdf.new_page();

    for msg in messages {
        pdf.ensure_space(20.0);

        // Role + timestamp header
        let role_label = if msg.role == "user" { "User" } else { "Assistant" };
        let role_color = if msg.role == "user" {
            COLOR_USER
        } else {
            COLOR_ACCENT
        };

        pdf.font_bold(11.0);
        pdf.color_hex(role_color);
        pdf.text(&format!("{}   {}", role_label, format_date(&msg.created_at)));
        pdf.move_down(1.5);

        // Render content
        let has_blocks = msg.blocks.is_some();

        if has_blocks {
            if let Some(ref blocks_json) = msg.blocks {
                if let Ok(blocks) = serde_json::from_str::<Vec<ParsedBlock>>(blocks_json) {
                    for block in &blocks {
                        match block {
                            ParsedBlock::Text { text: Some(text) } => {
                                render_markdown_content(&mut pdf, text);
                            }
                            ParsedBlock::Tool { tool: Some(tool) } => {
                                render_tool_block(&mut pdf, tool);
                            }
                            _ => {}
                        }
                    }
                }
            }
        } else if !msg.content.is_empty() {
            render_markdown_content(&mut pdf, &msg.content);
        }

        // Separator
        pdf.move_down(2.0);
        pdf.horizontal_line();
        pdf.move_down(2.0);
    }

    if messages.is_empty() {
        pdf.font_regular(11.0);
        pdf.color_hex(COLOR_MUTED);
        pdf.text("No messages in this session.");
    }

    pdf.finish()
}

/// Render markdown-ish text content line by line.
fn render_markdown_content(pdf: &mut PdfWriter, text: &str) {
    let normalized = normalize_content(text);
    let lines: Vec<&str> = normalized.split('\n').collect();
    let mut in_code_block = false;

    for line in lines {
        pdf.ensure_space(5.0);
        let trimmed = line.trim();

        // Code block toggle
        if trimmed.starts_with("```") {
            in_code_block = !in_code_block;
            pdf.move_down(1.0);
            continue;
        }

        if in_code_block {
            pdf.font_mono(8.0);
            pdf.color_hex(COLOR_ACCENT);
            pdf.text(line);
            continue;
        }

        // Headings
        if line.starts_with("#### ") {
            pdf.font_bold(10.0);
            pdf.color_hex(COLOR_TEXT);
            pdf.text(&strip_markdown(&line[5..]));
            pdf.move_down(0.5);
            continue;
        }
        if line.starts_with("### ") {
            pdf.font_bold(11.0);
            pdf.color_hex(COLOR_TEXT);
            pdf.text(&strip_markdown(&line[4..]));
            pdf.move_down(1.0);
            continue;
        }
        if line.starts_with("## ") {
            pdf.font_bold(12.0);
            pdf.color_hex(COLOR_TEXT);
            pdf.text(&strip_markdown(&line[3..]));
            pdf.move_down(1.0);
            continue;
        }
        if line.starts_with("# ") {
            pdf.font_bold(14.0);
            pdf.color_hex(COLOR_TEXT);
            pdf.text(&strip_markdown(&line[2..]));
            pdf.move_down(1.5);
            continue;
        }

        // Horizontal rule
        if is_horizontal_rule(trimmed) {
            pdf.horizontal_line();
            pdf.move_down(1.5);
            continue;
        }

        // Empty line
        if trimmed.is_empty() {
            pdf.move_down(1.5);
            continue;
        }

        // List items (unordered)
        if trimmed.starts_with("- ") || trimmed.starts_with("* ") {
            let content = &trimmed[2..];
            pdf.font_regular(10.0);
            pdf.color_hex(COLOR_TEXT);
            pdf.text(&format!("  \u{2022}  {}", strip_markdown(content)));
            continue;
        }

        // List items (ordered)
        if is_ordered_list_item(trimmed) {
            pdf.font_regular(10.0);
            pdf.color_hex(COLOR_TEXT);
            pdf.text(&format!("  {}", strip_markdown(trimmed)));
            continue;
        }

        // Blockquote
        if line.starts_with("> ") {
            pdf.font_italic(10.0);
            pdf.color_hex(COLOR_MUTED);
            pdf.text(&format!("    {}", strip_markdown(&line[2..])));
            continue;
        }

        // Regular text
        pdf.font_regular(10.0);
        pdf.color_hex(COLOR_TEXT);
        pdf.text(&strip_markdown(line));
    }
}

/// Render a tool use block (name, status, truncated input/result).
fn render_tool_block(pdf: &mut PdfWriter, tool: &ToolBlock) {
    pdf.ensure_space(12.0);

    let status_icon = match tool.status.as_deref() {
        Some("done") => "OK",
        Some("error") => "ERR",
        _ => "...",
    };

    pdf.font_bold(9.0);
    pdf.color_hex(COLOR_MUTED);
    pdf.text(&format!("Tool: {} [{}]", tool.name, status_icon));

    if let Some(ref input) = tool.input {
        let input_str = serde_json::to_string(input).unwrap_or_default();
        let truncated = truncate_str(&input_str, TOOL_INPUT_TRUNCATE);
        pdf.font_mono(7.5);
        pdf.color_hex(COLOR_MUTED);
        pdf.text(&format!("  Input: {}", truncated));
    }

    if let Some(ref result) = tool.result {
        let truncated = truncate_str(result, TOOL_RESULT_TRUNCATE);
        pdf.font_mono(7.5);
        pdf.color_hex(COLOR_MUTED);
        pdf.text(&format!("  Result: {}", truncated));
    }

    pdf.move_down(1.0);
}

fn is_horizontal_rule(s: &str) -> bool {
    (s.len() >= 3 && s.chars().all(|c| c == '-'))
        || (s.len() >= 3 && s.chars().all(|c| c == '*'))
}

fn is_ordered_list_item(s: &str) -> bool {
    s.chars()
        .take_while(|c| c.is_ascii_digit())
        .count()
        > 0
        && (s.contains(". ") || s.contains(") "))
}
