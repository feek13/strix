import PDFDocument from "pdfkit";
import type { ChatSession, ChatMessageRecord } from "@strix-webui/shared";

const COLORS = {
  bg: "#0A0A0A",
  text: "#FFFFFF",
  muted: "#A0A0A0",
  border: "#2A2A2A",
  accent: "#22C55E",
};

interface ParsedBlock {
  type: "text" | "tool";
  text?: string;
  tool?: { name: string; status: string; input: Record<string, unknown>; result?: string };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number) {
  if (doc.y > doc.page.height - needed) {
    doc.addPage();
  }
}

/**
 * Normalize content that may have lost its newlines.
 * Inserts line breaks before markdown block markers that appear mid-line.
 */
function normalizeContent(text: string): string {
  // If text already has reasonable newlines, return as-is
  const lines = text.split("\n");
  if (lines.length > 3) return text;

  // Content might be a single long line — try to restore line breaks
  return text
    .replace(/([.!?:})\]]) (#{1,3} )/g, "$1\n\n$2")  // before headings
    .replace(/([.!?]) (- )/g, "$1\n$2")                 // before list items
    .replace(/(```)/g, "\n$1\n")                         // around code fences
    .replace(/\n{3,}/g, "\n\n");                         // collapse excess
}

/** Strip inline markdown and return plain text for safe PDFKit rendering */
function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1");
}

/** Render text content line-by-line (no `continued` to avoid PDFKit page-break crashes) */
function renderContent(doc: PDFKit.PDFDocument, text: string, pageWidth: number) {
  const normalized = normalizeContent(text);
  const lines = normalized.split("\n");
  let inCodeBlock = false;

  for (const line of lines) {
    ensureSpace(doc, 25);

    // Code block toggle
    if (line.trim().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      doc.moveDown(0.2);
      continue;
    }

    if (inCodeBlock) {
      doc.font("Courier").fontSize(8).fillColor(COLORS.accent)
        .text(line, { width: pageWidth });
      continue;
    }

    // Headings
    if (line.startsWith("#### ")) {
      doc.font("Helvetica-Bold").fontSize(10).fillColor(COLORS.text)
        .text(stripInlineMarkdown(line.slice(5)), { width: pageWidth });
      doc.moveDown(0.15);
      continue;
    }
    if (line.startsWith("### ")) {
      doc.font("Helvetica-Bold").fontSize(11).fillColor(COLORS.text)
        .text(stripInlineMarkdown(line.slice(4)), { width: pageWidth });
      doc.moveDown(0.2);
      continue;
    }
    if (line.startsWith("## ")) {
      doc.font("Helvetica-Bold").fontSize(12).fillColor(COLORS.text)
        .text(stripInlineMarkdown(line.slice(3)), { width: pageWidth });
      doc.moveDown(0.2);
      continue;
    }
    if (line.startsWith("# ")) {
      doc.font("Helvetica-Bold").fontSize(14).fillColor(COLORS.text)
        .text(stripInlineMarkdown(line.slice(2)), { width: pageWidth });
      doc.moveDown(0.3);
      continue;
    }

    // Horizontal rule
    if (/^-{3,}$/.test(line.trim()) || /^\*{3,}$/.test(line.trim())) {
      doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke(COLORS.border);
      doc.moveDown(0.3);
      continue;
    }

    // Empty line
    if (!line.trim()) {
      doc.moveDown(0.25);
      continue;
    }

    // List items (- or * or numbered)
    if (/^\s*[-*]\s/.test(line)) {
      const indent = line.match(/^(\s*)/)?.[1]?.length || 0;
      const content = line.replace(/^\s*[-*]\s+/, "");
      doc.font("Helvetica").fontSize(10).fillColor(COLORS.text)
        .text(`${"  ".repeat(Math.floor(indent / 2))}  \u2022  ${stripInlineMarkdown(content)}`, { width: pageWidth });
      continue;
    }
    if (/^\s*\d+[.)]\s/.test(line)) {
      const content = line.replace(/^\s*(\d+[.)]\s+)/, "$1");
      doc.font("Helvetica").fontSize(10).fillColor(COLORS.text)
        .text(`  ${stripInlineMarkdown(content)}`, { width: pageWidth });
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      doc.font("Helvetica-Oblique").fontSize(10).fillColor(COLORS.muted)
        .text(stripInlineMarkdown(line.slice(2)), { width: pageWidth - 20, indent: 20 });
      continue;
    }

    // Regular text — strip inline markdown, render as plain paragraph
    doc.font("Helvetica").fontSize(10).fillColor(COLORS.text)
      .text(stripInlineMarkdown(line), { width: pageWidth });
  }
}

export async function generateChatPDF(
  session: ChatSession,
  messages: ChatMessageRecord[],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 50, bottom: 60, left: 50, right: 50 },
      info: {
        Title: `Chat Export - ${session.title}`,
        Author: "Strix Security",
        Subject: "AI Chat Session Export",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - 100;

    // ==================== Cover Page ====================
    doc.moveDown(5);
    doc.fontSize(28).fillColor(COLORS.text).text("Chat Export", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(16).fillColor(COLORS.accent).text(session.title, { align: "center", width: pageWidth });
    doc.moveDown(2);

    doc.fontSize(10).fillColor(COLORS.muted);
    doc.text(`Session created: ${formatDate(session.createdAt)}`, { align: "center" });
    doc.text(`Messages: ${messages.length}`, { align: "center" });
    if (messages.length > 0) {
      const first = formatDate(messages[0].createdAt);
      const last = formatDate(messages[messages.length - 1].createdAt);
      doc.text(`Time range: ${first} — ${last}`, { align: "center" });
    }
    doc.moveDown(6);
    doc.fontSize(9).fillColor(COLORS.muted).text("Exported from Strix", { align: "center" });

    // ==================== Messages ====================
    doc.addPage();

    let pageNum = 2;
    const addFooter = () => {
      doc.fontSize(8).fillColor(COLORS.muted)
        .text(`Exported from Strix — Page ${pageNum}`, 50, doc.page.height - 40, {
          align: "center", width: pageWidth,
        });
      pageNum++;
    };

    doc.on("pageAdded", addFooter);

    for (const msg of messages) {
      ensureSpace(doc, 50);

      const roleLabel = msg.role === "user" ? "User" : "Assistant";
      const roleColor = msg.role === "user" ? "#60A5FA" : COLORS.accent;
      const hasBlocks = !!msg.blocks;

      // Role + timestamp header
      doc.font("Helvetica-Bold").fontSize(11).fillColor(roleColor)
        .text(`${roleLabel}  `, { continued: true });
      doc.font("Helvetica").fontSize(9).fillColor(COLORS.muted)
        .text(formatDate(msg.createdAt));

      doc.moveDown(0.3);

      // For messages with blocks (execute mode), skip content to avoid duplication
      if (hasBlocks) {
        try {
          const blocks: ParsedBlock[] = JSON.parse(msg.blocks!);
          for (const block of blocks) {
            if (block.type === "text" && block.text) {
              renderContent(doc, block.text, pageWidth);
            } else if (block.type === "tool" && block.tool) {
              ensureSpace(doc, 35);
              const statusIcon = block.tool.status === "done" ? "OK"
                : block.tool.status === "error" ? "ERR" : "...";

              doc.font("Courier-Bold").fontSize(9).fillColor(COLORS.muted)
                .text(`Tool: ${block.tool.name} [${statusIcon}]`);

              const inputStr = JSON.stringify(block.tool.input);
              const truncInput = inputStr.length > 200 ? inputStr.slice(0, 200) + "..." : inputStr;
              doc.font("Courier").fontSize(7.5).fillColor(COLORS.muted)
                .text(`  Input: ${truncInput}`, { width: pageWidth });

              if (block.tool.result) {
                const truncResult = block.tool.result.length > 300
                  ? block.tool.result.slice(0, 300) + "..." : block.tool.result;
                doc.font("Courier").fontSize(7.5).fillColor(COLORS.muted)
                  .text(`  Result: ${truncResult}`, { width: pageWidth });
              }
              doc.moveDown(0.2);
            }
          }
        } catch { /* invalid blocks JSON */ }
      } else if (msg.content) {
        renderContent(doc, msg.content, pageWidth);
      }

      // Separator
      doc.moveDown(0.4);
      doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke(COLORS.border);
      doc.moveDown(0.4);
    }

    if (messages.length === 0) {
      doc.fontSize(11).fillColor(COLORS.muted).text("No messages in this session.");
    }

    addFooter();
    doc.end();
  });
}
