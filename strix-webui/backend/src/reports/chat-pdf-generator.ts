import PDFDocument from "pdfkit";
import { existsSync } from "fs";
import type { ChatSession, ChatMessageRecord } from "@strix-webui/shared";

const COLORS = {
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

/** Font paths to try for CJK support (macOS → Linux fallbacks) */
const CJK_FONT_CANDIDATES = [
  { path: "/System/Library/Fonts/STHeiti Medium.ttc", name: "STHeiti" },
  { path: "/System/Library/Fonts/Hiragino Sans GB.ttc", name: "HiraginoSansGB" },
  { path: "/System/Library/Fonts/Supplemental/Arial Unicode.ttf", name: "ArialUnicode" },
  { path: "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", name: "NotoSansCJK" },
  { path: "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc", name: "NotoSansCJK" },
];

interface FontConfig {
  regular: string;
  bold: string;
  italic: string;
  mono: string;
  monoBold: string;
}

/** Register a CJK-capable font or fall back to Helvetica */
function setupFonts(doc: PDFKit.PDFDocument): FontConfig {
  for (const candidate of CJK_FONT_CANDIDATES) {
    if (existsSync(candidate.path)) {
      try {
        doc.registerFont("CJK-Regular", candidate.path);
        // TTC files may support bold via different index; TTF has only one face
        // For simplicity, use the same file for bold (PDFKit will fake bold)
        doc.registerFont("CJK-Bold", candidate.path);
        return {
          regular: "CJK-Regular",
          bold: "CJK-Bold",
          italic: "CJK-Regular",
          mono: "Courier",
          monoBold: "Courier-Bold",
        };
      } catch {
        // Font registration failed, try next candidate
      }
    }
  }

  // No CJK font found, use built-in Helvetica (ASCII only)
  return {
    regular: "Helvetica",
    bold: "Helvetica-Bold",
    italic: "Helvetica-Oblique",
    mono: "Courier",
    monoBold: "Courier-Bold",
  };
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

/** Normalize content that may have lost its newlines */
function normalizeContent(text: string): string {
  const lines = text.split("\n");
  if (lines.length > 3) return text;
  return text
    .replace(/([.!?:})\]]) (#{1,3} )/g, "$1\n\n$2")
    .replace(/([.!?]) (- )/g, "$1\n$2")
    .replace(/(```)/g, "\n$1\n")
    .replace(/\n{3,}/g, "\n\n");
}

/** Strip inline markdown markers */
function stripMd(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1");
}

/** Render text content line-by-line */
function renderContent(doc: PDFKit.PDFDocument, text: string, pageWidth: number, fonts: FontConfig) {
  const normalized = normalizeContent(text);
  const lines = normalized.split("\n");
  let inCodeBlock = false;

  for (const line of lines) {
    ensureSpace(doc, 25);

    if (line.trim().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      doc.moveDown(0.2);
      continue;
    }

    if (inCodeBlock) {
      doc.font(fonts.mono).fontSize(8).fillColor(COLORS.accent)
        .text(line, { width: pageWidth });
      continue;
    }

    // Headings
    if (line.startsWith("#### ")) {
      doc.font(fonts.bold).fontSize(10).fillColor(COLORS.text)
        .text(stripMd(line.slice(5)), { width: pageWidth });
      doc.moveDown(0.15);
      continue;
    }
    if (line.startsWith("### ")) {
      doc.font(fonts.bold).fontSize(11).fillColor(COLORS.text)
        .text(stripMd(line.slice(4)), { width: pageWidth });
      doc.moveDown(0.2);
      continue;
    }
    if (line.startsWith("## ")) {
      doc.font(fonts.bold).fontSize(12).fillColor(COLORS.text)
        .text(stripMd(line.slice(3)), { width: pageWidth });
      doc.moveDown(0.2);
      continue;
    }
    if (line.startsWith("# ")) {
      doc.font(fonts.bold).fontSize(14).fillColor(COLORS.text)
        .text(stripMd(line.slice(2)), { width: pageWidth });
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

    // List items
    if (/^\s*[-*]\s/.test(line)) {
      const indent = line.match(/^(\s*)/)?.[1]?.length || 0;
      const content = line.replace(/^\s*[-*]\s+/, "");
      doc.font(fonts.regular).fontSize(10).fillColor(COLORS.text)
        .text(`${"  ".repeat(Math.floor(indent / 2))}  \u2022  ${stripMd(content)}`, { width: pageWidth });
      continue;
    }
    if (/^\s*\d+[.)]\s/.test(line)) {
      const content = line.replace(/^\s*(\d+[.)]\s+)/, "$1");
      doc.font(fonts.regular).fontSize(10).fillColor(COLORS.text)
        .text(`  ${stripMd(content)}`, { width: pageWidth });
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      doc.font(fonts.italic).fontSize(10).fillColor(COLORS.muted)
        .text(stripMd(line.slice(2)), { width: pageWidth - 20, indent: 20 });
      continue;
    }

    // Regular text
    doc.font(fonts.regular).fontSize(10).fillColor(COLORS.text)
      .text(stripMd(line), { width: pageWidth });
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

    const fonts = setupFonts(doc);

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - 100;

    // ==================== Cover Page ====================
    doc.moveDown(5);
    doc.font(fonts.bold).fontSize(28).fillColor(COLORS.text).text("Chat Export", { align: "center" });
    doc.moveDown(0.5);
    doc.font(fonts.regular).fontSize(16).fillColor(COLORS.accent).text(session.title, { align: "center", width: pageWidth });
    doc.moveDown(2);

    doc.font(fonts.regular).fontSize(10).fillColor(COLORS.muted);
    doc.text(`Session created: ${formatDate(session.createdAt)}`, { align: "center" });
    doc.text(`Messages: ${messages.length}`, { align: "center" });
    if (messages.length > 0) {
      const first = formatDate(messages[0].createdAt);
      const last = formatDate(messages[messages.length - 1].createdAt);
      doc.text(`Time range: ${first} — ${last}`, { align: "center" });
    }
    doc.moveDown(6);
    doc.font(fonts.regular).fontSize(9).fillColor(COLORS.muted).text("Exported from Strix", { align: "center" });

    // ==================== Messages ====================
    doc.addPage();

    let pageNum = 2;
    const addFooter = () => {
      doc.font(fonts.regular).fontSize(8).fillColor(COLORS.muted)
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

      // Role + timestamp header (single line, no continued)
      doc.font(fonts.bold).fontSize(11).fillColor(roleColor)
        .text(`${roleLabel}   ${formatDate(msg.createdAt)}`, { width: pageWidth });

      doc.moveDown(0.3);

      // For messages with blocks (execute mode), skip content to avoid duplication
      if (hasBlocks) {
        try {
          const blocks: ParsedBlock[] = JSON.parse(msg.blocks!);
          for (const block of blocks) {
            if (block.type === "text" && block.text) {
              renderContent(doc, block.text, pageWidth, fonts);
            } else if (block.type === "tool" && block.tool) {
              ensureSpace(doc, 35);
              const statusIcon = block.tool.status === "done" ? "OK"
                : block.tool.status === "error" ? "ERR" : "...";

              doc.font(fonts.monoBold).fontSize(9).fillColor(COLORS.muted)
                .text(`Tool: ${block.tool.name} [${statusIcon}]`);

              const inputStr = JSON.stringify(block.tool.input);
              const truncInput = inputStr.length > 200 ? inputStr.slice(0, 200) + "..." : inputStr;
              doc.font(fonts.mono).fontSize(7.5).fillColor(COLORS.muted)
                .text(`  Input: ${truncInput}`, { width: pageWidth });

              if (block.tool.result) {
                const truncResult = block.tool.result.length > 300
                  ? block.tool.result.slice(0, 300) + "..." : block.tool.result;
                doc.font(fonts.mono).fontSize(7.5).fillColor(COLORS.muted)
                  .text(`  Result: ${truncResult}`, { width: pageWidth });
              }
              doc.moveDown(0.2);
            }
          }
        } catch { /* invalid blocks JSON */ }
      } else if (msg.content) {
        renderContent(doc, msg.content, pageWidth, fonts);
      }

      // Separator
      doc.moveDown(0.4);
      doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke(COLORS.border);
      doc.moveDown(0.4);
    }

    if (messages.length === 0) {
      doc.font(fonts.regular).fontSize(11).fillColor(COLORS.muted).text("No messages in this session.");
    }

    addFooter();
    doc.end();
  });
}
