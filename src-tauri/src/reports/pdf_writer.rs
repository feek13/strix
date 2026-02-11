//! Thin wrapper around `printpdf` for building multi-page PDF reports.
//!
//! Tracks cursor position (top-down), word-wraps text, and manages pages
//! using built-in PDF fonts (Helvetica, Courier) — no external font files.

use printpdf::*;
use std::io::{BufWriter, Cursor};

const PAGE_W: f64 = 210.0; // A4 mm
const PAGE_H: f64 = 297.0;
const MARGIN: f64 = 20.0;
const CONTENT_W: f64 = PAGE_W - 2.0 * MARGIN;
const BOTTOM_LIMIT: f64 = PAGE_H - MARGIN;

/// Which built-in font is active.
#[derive(Clone, Copy)]
pub enum FontChoice {
    Regular,
    Bold,
    Italic,
    Mono,
}

/// A PDF document builder that tracks cursor position from the top of the page.
pub struct PdfWriter {
    doc: PdfDocumentReference,
    current_page: PdfPageIndex,
    current_layer: PdfLayerIndex,
    /// Vertical position in mm from the top of the current page.
    cursor_y: f64,
    font_regular: IndirectFontRef,
    font_bold: IndirectFontRef,
    font_italic: IndirectFontRef,
    font_mono: IndirectFontRef,
    current_font_size: f64,
    active_font: FontChoice,
}

impl PdfWriter {
    pub fn new(title: &str) -> Self {
        let (doc, page, layer) =
            PdfDocument::new(title, Mm(PAGE_W), Mm(PAGE_H), "Layer 1");
        let font_regular = doc.add_builtin_font(BuiltinFont::Helvetica).unwrap();
        let font_bold = doc.add_builtin_font(BuiltinFont::HelveticaBold).unwrap();
        let font_italic = doc.add_builtin_font(BuiltinFont::HelveticaOblique).unwrap();
        let font_mono = doc.add_builtin_font(BuiltinFont::Courier).unwrap();
        Self {
            doc,
            current_page: page,
            current_layer: layer,
            cursor_y: MARGIN,
            font_regular,
            font_bold,
            font_italic,
            font_mono,
            current_font_size: 10.0,
            active_font: FontChoice::Regular,
        }
    }

    // ── Font helpers ──────────────────────────────────────────────

    pub fn font_regular(&mut self, size: f64) {
        self.active_font = FontChoice::Regular;
        self.current_font_size = size;
    }
    pub fn font_bold(&mut self, size: f64) {
        self.active_font = FontChoice::Bold;
        self.current_font_size = size;
    }
    pub fn font_italic(&mut self, size: f64) {
        self.active_font = FontChoice::Italic;
        self.current_font_size = size;
    }
    pub fn font_mono(&mut self, size: f64) {
        self.active_font = FontChoice::Mono;
        self.current_font_size = size;
    }

    fn font_ref(&self) -> &IndirectFontRef {
        match self.active_font {
            FontChoice::Regular => &self.font_regular,
            FontChoice::Bold => &self.font_bold,
            FontChoice::Italic => &self.font_italic,
            FontChoice::Mono => &self.font_mono,
        }
    }

    /// Average character width factor relative to font size (in pt).
    fn char_width_factor(&self) -> f64 {
        match self.active_font {
            FontChoice::Mono => 0.60,
            FontChoice::Bold => 0.55,
            _ => 0.52,
        }
    }

    // ── Color ─────────────────────────────────────────────────────

    /// Set fill color for subsequent text and shapes (RGB 0.0–1.0).
    pub fn color(&self, r: f64, g: f64, b: f64) {
        self.layer()
            .set_fill_color(Color::Rgb(Rgb::new(r, g, b, None)));
    }

    /// Set fill color from a `#RRGGBB` hex string.
    pub fn color_hex(&self, hex: &str) {
        let (r, g, b) = hex_to_rgb(hex);
        self.color(r, g, b);
    }

    // ── Geometry helpers ──────────────────────────────────────────

    /// Convert cursor_y (mm from page top) to PDF y (mm from page bottom).
    fn pdf_y(&self) -> Mm {
        Mm(PAGE_H - self.cursor_y)
    }

    /// Line height in mm for the current font size.
    fn line_height(&self) -> f64 {
        self.current_font_size * 0.3528 * 1.5
    }

    /// Maximum characters per line for the current font.
    fn chars_per_line(&self) -> usize {
        let cw = self.char_width_factor() * self.current_font_size * 0.3528;
        (CONTENT_W / cw).max(1.0) as usize
    }

    fn layer(&self) -> PdfLayerReference {
        self.doc
            .get_page(self.current_page)
            .get_layer(self.current_layer)
    }

    // ── Text output ───────────────────────────────────────────────

    /// Word-wrap `text` to fit within the content width.
    fn wrap_text(&self, text: &str) -> Vec<String> {
        let max = self.chars_per_line();
        let mut lines = Vec::new();
        for paragraph in text.split('\n') {
            if paragraph.is_empty() {
                lines.push(String::new());
                continue;
            }
            let words: Vec<&str> = paragraph.split_whitespace().collect();
            let mut cur = String::new();
            for w in words {
                if cur.is_empty() {
                    cur = w.to_string();
                } else if cur.len() + 1 + w.len() <= max {
                    cur.push(' ');
                    cur.push_str(w);
                } else {
                    lines.push(cur);
                    cur = w.to_string();
                }
            }
            if !cur.is_empty() {
                lines.push(cur);
            }
        }
        if lines.is_empty() {
            lines.push(String::new());
        }
        lines
    }

    /// Write word-wrapped text at the current cursor position (left-aligned).
    pub fn text(&mut self, content: &str) {
        let lines = self.wrap_text(content);
        let lh = self.line_height();
        let font = self.font_ref().clone();
        let fs = self.current_font_size;
        for line in lines {
            self.ensure_space(lh);
            if !line.is_empty() {
                self.layer()
                    .use_text(&line, fs, Mm(MARGIN), self.pdf_y(), &font);
            }
            self.cursor_y += lh;
        }
    }

    /// Write a single line of text centered on the page.
    pub fn text_centered(&mut self, content: &str) {
        let cw = self.char_width_factor() * self.current_font_size * 0.3528;
        let tw = content.len() as f64 * cw;
        let x = ((PAGE_W - tw) / 2.0).max(MARGIN);
        let lh = self.line_height();
        self.ensure_space(lh);
        let font = self.font_ref().clone();
        self.layer()
            .use_text(content, self.current_font_size, Mm(x), self.pdf_y(), &font);
        self.cursor_y += lh;
    }

    /// Write text at a specific X offset (mm from left edge).
    #[allow(dead_code)]
    pub fn text_at_x(&mut self, content: &str, x_mm: f64) {
        let lh = self.line_height();
        self.ensure_space(lh);
        let font = self.font_ref().clone();
        self.layer()
            .use_text(content, self.current_font_size, Mm(x_mm), self.pdf_y(), &font);
        self.cursor_y += lh;
    }

    // ── Spacing / paging ──────────────────────────────────────────

    /// Advance cursor down by `mm` millimeters.
    pub fn move_down(&mut self, mm: f64) {
        self.cursor_y += mm;
    }

    /// Start a new page and reset cursor to the top margin.
    pub fn new_page(&mut self) {
        let (page, layer) = self.doc.add_page(Mm(PAGE_W), Mm(PAGE_H), "Layer 1");
        self.current_page = page;
        self.current_layer = layer;
        self.cursor_y = MARGIN;
    }

    /// If there isn't `needed` mm left on the current page, start a new one.
    pub fn ensure_space(&mut self, needed: f64) {
        if self.cursor_y + needed > BOTTOM_LIMIT {
            self.new_page();
        }
    }

    /// Current vertical position from the top of the page (mm).
    #[allow(dead_code)]
    pub fn cursor_y(&self) -> f64 {
        self.cursor_y
    }

    // ── Drawing ───────────────────────────────────────────────────

    /// Draw a thin horizontal separator line at the current cursor position.
    pub fn horizontal_line(&mut self) {
        let layer = self.layer();
        layer.set_outline_color(Color::Rgb(Rgb::new(0.165, 0.165, 0.165, None)));
        layer.set_outline_thickness(0.3);
        let y = self.pdf_y();
        layer.add_shape(Line {
            points: vec![
                (Point::new(Mm(MARGIN), y), false),
                (Point::new(Mm(PAGE_W - MARGIN), y), false),
            ],
            is_closed: false,
            has_fill: false,
            has_stroke: true,
            is_clipping_path: false,
        });
    }

    /// Draw a filled rectangle at the current cursor position.
    pub fn filled_rect(&mut self, x: f64, w: f64, h: f64, r: f64, g: f64, b: f64) {
        let layer = self.layer();
        layer.set_fill_color(Color::Rgb(Rgb::new(r, g, b, None)));
        let y_bottom = PAGE_H - self.cursor_y - h;
        layer.add_shape(Line {
            points: vec![
                (Point::new(Mm(x), Mm(y_bottom)), false),
                (Point::new(Mm(x + w), Mm(y_bottom)), false),
                (Point::new(Mm(x + w), Mm(y_bottom + h)), false),
                (Point::new(Mm(x), Mm(y_bottom + h)), false),
            ],
            is_closed: true,
            has_fill: true,
            has_stroke: false,
            is_clipping_path: false,
        });
    }

    // ── Finish ────────────────────────────────────────────────────

    /// Consume the writer and return the PDF as a byte vector.
    pub fn finish(self) -> Vec<u8> {
        let mut buf = BufWriter::new(Cursor::new(Vec::new()));
        match self.doc.save(&mut buf) {
            Ok(()) => buf
                .into_inner()
                .map(|c| c.into_inner())
                .unwrap_or_default(),
            Err(_) => Vec::new(),
        }
    }
}

// ── Utility ──────────────────────────────────────────────────────

/// Parse `#RRGGBB` to (r, g, b) floats in 0.0–1.0.
pub fn hex_to_rgb(hex: &str) -> (f64, f64, f64) {
    let hex = hex.trim_start_matches('#');
    if hex.len() < 6 {
        return (0.0, 0.0, 0.0);
    }
    let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(0) as f64 / 255.0;
    let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(0) as f64 / 255.0;
    let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(0) as f64 / 255.0;
    (r, g, b)
}

/// Strip simple markdown formatting from text (`**bold**`, `*italic*`,
/// `` `code` ``, `__underline__`). Preserves literal characters that
/// are not part of a matched pair.
pub fn strip_markdown(text: &str) -> String {
    let mut out = text.to_string();
    // Remove bold: **text** → text
    while let Some(start) = out.find("**") {
        if let Some(end) = out[start + 2..].find("**") {
            let end_abs = start + 2 + end;
            out = format!(
                "{}{}{}",
                &out[..start],
                &out[start + 2..end_abs],
                &out[end_abs + 2..]
            );
        } else {
            break;
        }
    }
    // Remove underline: __text__ → text
    while let Some(start) = out.find("__") {
        if let Some(end) = out[start + 2..].find("__") {
            let end_abs = start + 2 + end;
            out = format!(
                "{}{}{}",
                &out[..start],
                &out[start + 2..end_abs],
                &out[end_abs + 2..]
            );
        } else {
            break;
        }
    }
    // Remove inline code: `text` → text
    while let Some(start) = out.find('`') {
        if let Some(end) = out[start + 1..].find('`') {
            let end_abs = start + 1 + end;
            out = format!(
                "{}{}{}",
                &out[..start],
                &out[start + 1..end_abs],
                &out[end_abs + 1..]
            );
        } else {
            break;
        }
    }
    // Remove italic: *text* → text
    while let Some(start) = out.find('*') {
        if let Some(end) = out[start + 1..].find('*') {
            let end_abs = start + 1 + end;
            out = format!(
                "{}{}{}",
                &out[..start],
                &out[start + 1..end_abs],
                &out[end_abs + 1..]
            );
        } else {
            break;
        }
    }
    out
}

/// Normalize content that may have markdown block markers appearing inline.
/// Matches the TypeScript `normalizeContent()` from `reports/utils.ts`.
pub fn normalize_content(text: &str) -> String {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let line_count = normalized.split('\n').count();
    if line_count > 3 {
        return normalized;
    }
    // Insert newlines before headings that follow sentence endings
    let mut out = normalized;
    // Sentence end before heading: ". ## " → ".\n\n## "
    for heading_prefix in &["# ", "## ", "### "] {
        for end_char in &['.', '!', '?', ':', '}', ')', ']'] {
            let pattern = format!("{} {}", end_char, heading_prefix);
            let replacement = format!("{}\n\n{}", end_char, heading_prefix);
            out = out.replace(&pattern, &replacement);
        }
    }
    // Sentence end before list item: ". - " → ".\n- "
    for end_char in &['.', '!', '?'] {
        let pattern = format!("{} - ", end_char);
        let replacement = format!("{}\n- ", end_char);
        out = out.replace(&pattern, &replacement);
    }
    // Code fences on their own lines
    out = out.replace("```", "\n```\n");
    // Collapse excessive newlines
    while out.contains("\n\n\n") {
        out = out.replace("\n\n\n", "\n\n");
    }
    out
}

/// Truncate string to `max_len` characters, appending "..." if truncated.
pub fn truncate_str(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        format!("{}...", &s[..max_len.saturating_sub(3)])
    }
}

/// Format an ISO 8601 date string to a shorter display format.
pub fn format_date(iso: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(iso)
        .map(|dt| dt.format("%Y-%m-%d %H:%M").to_string())
        .unwrap_or_else(|_| iso.to_string())
}
