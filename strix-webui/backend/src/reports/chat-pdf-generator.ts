import PDFDocument from "pdfkit";
import type { ChatSession, ChatMessageRecord } from "@strix-webui/shared";

const COLORS = {
  bg: "#0A0A0A",
  text: "#FFFFFF",
  muted: "#A0A0A0",
  border: "#2A2A2A",
  accent: "#22C55E",
  userBubble: "#1A3A2A",
  toolBg: "#1A1A2A",
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

/** Render lightweight markdown: bold, inline code, headings, code blocks */
function renderMarkdownText(doc: PDFKit.PDFDocument, text: string, pageWidth: number) {
  const lines = text.split("\n");
  let inCodeBlock = false;

  for (const line of lines) {
    ensureSpace(doc, 30);

    // Code block toggle
    if (line.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      if (inCodeBlock) {
        doc.moveDown(0.3);
      } else {
        doc.moveDown(0.3);
      }
      continue;
    }

    if (inCodeBlock) {
      doc.font("Courier").fontSize(8).fillColor(COLORS.accent)
        .text(line, { width: pageWidth });
      continue;
    }

    // Headings
    if (line.startsWith("### ")) {
      doc.font("Helvetica-Bold").fontSize(11).fillColor(COLORS.text)
        .text(line.slice(4), { width: pageWidth });
      doc.moveDown(0.2);
      continue;
    }
    if (line.startsWith("## ")) {
      doc.font("Helvetica-Bold").fontSize(12).fillColor(COLORS.text)
        .text(line.slice(3), { width: pageWidth });
      doc.moveDown(0.2);
      continue;
    }
    if (line.startsWith("# ")) {
      doc.font("Helvetica-Bold").fontSize(14).fillColor(COLORS.text)
        .text(line.slice(2), { width: pageWidth });
      doc.moveDown(0.3);
      continue;
    }

    // Empty line
    if (!line.trim()) {
      doc.moveDown(0.3);
      continue;
    }

    // Regular text with inline formatting
    // Process bold (**text**) and inline code (`code`)
    const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    let first = true;
    for (const part of parts) {
      if (!part) continue;
      if (part.startsWith("**") && part.endsWith("**")) {
        doc.font("Helvetica-Bold").fontSize(10).fillColor(COLORS.text)
          .text(part.slice(2, -2), { continued: true, width: first ? pageWidth : undefined });
      } else if (part.startsWith("`") && part.endsWith("`")) {
        doc.font("Courier").fontSize(9).fillColor(COLORS.accent)
          .text(part.slice(1, -1), { continued: true, width: first ? pageWidth : undefined });
      } else {
        doc.font("Helvetica").fontSize(10).fillColor(COLORS.text)
          .text(part, { continued: true, width: first ? pageWidth : undefined });
      }
      first = false;
    }
    // End the line
    doc.font("Helvetica").fontSize(10).fillColor(COLORS.text).text("", { continued: false });
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
    doc.fontSize(16).fillColor(COLORS.accent).text(session.title, { align: "center" });
    doc.moveDown(2);

    doc.fontSize(10).fillColor(COLORS.muted);
    doc.text(`Session created: ${formatDate(session.createdAt)}`, { align: "center" });
    doc.text(`Messages: ${messages.length}`, { align: "center" });
    if (messages.length > 0) {
      doc.text(`Time range: ${formatDate(messages[0].createdAt)} — ${formatDate(messages[messages.length - 1].createdAt)}`, { align: "center" });
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
      ensureSpace(doc, 60);

      const roleLabel = msg.role === "user" ? "User" : "Assistant";
      const roleColor = msg.role === "user" ? "#60A5FA" : COLORS.accent;

      // Role + timestamp header
      doc.font("Helvetica-Bold").fontSize(11).fillColor(roleColor)
        .text(roleLabel, { continued: true });
      doc.font("Helvetica").fontSize(9).fillColor(COLORS.muted)
        .text(`  ${formatDate(msg.createdAt)}`, { continued: false });

      doc.moveDown(0.3);

      // Message content
      if (msg.content) {
        renderMarkdownText(doc, msg.content, pageWidth);
      }

      // Tool blocks (if execute mode)
      if (msg.blocks) {
        try {
          const blocks: ParsedBlock[] = JSON.parse(msg.blocks);
          for (const block of blocks) {
            if (block.type === "text" && block.text) {
              renderMarkdownText(doc, block.text, pageWidth);
            } else if (block.type === "tool" && block.tool) {
              ensureSpace(doc, 40);
              const statusIcon = block.tool.status === "done" ? "[OK]"
                : block.tool.status === "error" ? "[ERR]" : "[...]";

              doc.font("Courier-Bold").fontSize(9).fillColor(COLORS.muted)
                .text(`  Tool: ${block.tool.name} ${statusIcon}`);

              // Show truncated input
              const inputStr = JSON.stringify(block.tool.input);
              const truncInput = inputStr.length > 200 ? inputStr.slice(0, 200) + "..." : inputStr;
              doc.font("Courier").fontSize(8).fillColor(COLORS.muted)
                .text(`  Input: ${truncInput}`, { width: pageWidth });

              // Show truncated result
              if (block.tool.result) {
                const truncResult = block.tool.result.length > 300
                  ? block.tool.result.slice(0, 300) + "..."
                  : block.tool.result;
                doc.text(`  Result: ${truncResult}`, { width: pageWidth });
              }
              doc.moveDown(0.2);
            }
          }
        } catch { /* invalid blocks JSON, skip */ }
      }

      // Separator
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke(COLORS.border);
      doc.moveDown(0.5);
    }

    if (messages.length === 0) {
      doc.fontSize(11).fillColor(COLORS.muted).text("No messages in this session.");
    }

    // Add footer to the last page
    addFooter();

    doc.end();
  });
}
