import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle, ShadingType,
} from "docx";
import type { ChatSession, ChatMessageRecord } from "@strix-webui/shared";

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

/**
 * Normalize content that may have lost its newlines.
 */
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
function strip(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1");
}

/** Convert markdown-ish text to TextRuns with basic formatting */
function markdownToRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith("**") && part.endsWith("**")) {
      runs.push(new TextRun({ text: part.slice(2, -2), bold: true }));
    } else if (part.startsWith("`") && part.endsWith("`")) {
      runs.push(new TextRun({
        text: part.slice(1, -1),
        font: "Courier New",
        size: 18,
        color: "22C55E",
      }));
    } else {
      runs.push(new TextRun({ text: part }));
    }
  }
  return runs;
}

/** Convert multi-line content into Paragraph objects */
function contentToParagraphs(content: string): Paragraph[] {
  const normalized = normalizeContent(content);
  const paragraphs: Paragraph[] = [];
  const lines = normalized.split("\n");
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      paragraphs.push(new Paragraph({
        children: [new TextRun({
          text: line,
          font: "Courier New",
          size: 18,
          color: "22C55E",
        })],
        spacing: { before: 20, after: 20 },
        shading: { type: ShadingType.SOLID, fill: "F0F0F0" },
      }));
      continue;
    }

    // Headings
    if (line.startsWith("#### ")) {
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: strip(line.slice(5)), bold: true, size: 22 })],
        spacing: { before: 100, after: 40 },
      }));
      continue;
    }
    if (line.startsWith("### ")) {
      paragraphs.push(new Paragraph({
        text: strip(line.slice(4)),
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 120, after: 60 },
      }));
      continue;
    }
    if (line.startsWith("## ")) {
      paragraphs.push(new Paragraph({
        text: strip(line.slice(3)),
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 160, after: 80 },
      }));
      continue;
    }
    if (line.startsWith("# ")) {
      paragraphs.push(new Paragraph({
        text: strip(line.slice(2)),
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 200, after: 100 },
      }));
      continue;
    }

    // Horizontal rule
    if (/^-{3,}$/.test(line.trim()) || /^\*{3,}$/.test(line.trim())) {
      paragraphs.push(new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" } },
        spacing: { before: 60, after: 60 },
      }));
      continue;
    }

    // Empty line
    if (!line.trim()) {
      paragraphs.push(new Paragraph({ spacing: { before: 40, after: 40 } }));
      continue;
    }

    // List items
    if (/^\s*[-*]\s/.test(line)) {
      const content = line.replace(/^\s*[-*]\s+/, "");
      paragraphs.push(new Paragraph({
        children: markdownToRuns(`\u2022  ${content}`),
        spacing: { before: 20, after: 20 },
        indent: { left: 360 },
      }));
      continue;
    }
    if (/^\s*\d+[.)]\s/.test(line)) {
      paragraphs.push(new Paragraph({
        children: markdownToRuns(line),
        spacing: { before: 20, after: 20 },
        indent: { left: 360 },
      }));
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: strip(line.slice(2)), italics: true, color: "666666" })],
        spacing: { before: 40, after: 40 },
        indent: { left: 360 },
        border: { left: { style: BorderStyle.SINGLE, size: 3, color: "22C55E" } },
      }));
      continue;
    }

    // Regular text with inline formatting
    paragraphs.push(new Paragraph({
      children: markdownToRuns(line),
      spacing: { before: 30, after: 30 },
    }));
  }

  return paragraphs;
}

export async function generateChatDOCX(
  session: ChatSession,
  messages: ChatMessageRecord[],
): Promise<Buffer> {
  const children: Paragraph[] = [];

  // Title
  children.push(new Paragraph({
    text: "Chat Export",
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
    spacing: { after: 100 },
  }));

  children.push(new Paragraph({
    children: [new TextRun({ text: session.title, bold: true, size: 28, color: "22C55E" })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
  }));

  // Metadata
  const metaLines = [
    `Session created: ${formatDate(session.createdAt)}`,
    `Messages: ${messages.length}`,
  ];
  if (messages.length > 0) {
    metaLines.push(
      `Time range: ${formatDate(messages[0].createdAt)} — ${formatDate(messages[messages.length - 1].createdAt)}`
    );
  }
  for (const line of metaLines) {
    children.push(new Paragraph({
      children: [new TextRun({ text: line, size: 20, color: "A0A0A0", italics: true })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
    }));
  }

  children.push(new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: "2A2A2A" } },
    spacing: { before: 200, after: 200 },
  }));

  // Messages
  for (const msg of messages) {
    const roleLabel = msg.role === "user" ? "User" : "Assistant";
    const roleColor = msg.role === "user" ? "60A5FA" : "22C55E";
    const hasBlocks = !!msg.blocks;

    // Role header
    children.push(new Paragraph({
      children: [
        new TextRun({ text: roleLabel, bold: true, size: 22, color: roleColor }),
        new TextRun({ text: ` — ${formatDate(msg.createdAt)}`, size: 18, color: "A0A0A0" }),
      ],
      spacing: { before: 160, after: 60 },
    }));

    // For messages with blocks (execute mode), use blocks only to avoid duplication
    if (hasBlocks) {
      try {
        const blocks: ParsedBlock[] = JSON.parse(msg.blocks!);
        for (const block of blocks) {
          if (block.type === "text" && block.text) {
            children.push(...contentToParagraphs(block.text));
          } else if (block.type === "tool" && block.tool) {
            const statusIcon = block.tool.status === "done" ? "OK"
              : block.tool.status === "error" ? "ERR" : "...";

            children.push(new Paragraph({
              children: [new TextRun({
                text: `Tool: ${block.tool.name} [${statusIcon}]`,
                font: "Courier New",
                size: 18,
                bold: true,
                color: "A0A0A0",
              })],
              spacing: { before: 80, after: 40 },
              shading: { type: ShadingType.SOLID, fill: "F5F5F5" },
            }));

            const inputStr = JSON.stringify(block.tool.input);
            const truncInput = inputStr.length > 200 ? inputStr.slice(0, 200) + "..." : inputStr;
            children.push(new Paragraph({
              children: [
                new TextRun({ text: "Input: ", font: "Courier New", size: 16, color: "A0A0A0", bold: true }),
                new TextRun({ text: truncInput, font: "Courier New", size: 16, color: "A0A0A0" }),
              ],
              spacing: { after: 20 },
            }));

            if (block.tool.result) {
              const truncResult = block.tool.result.length > 300
                ? block.tool.result.slice(0, 300) + "..." : block.tool.result;
              children.push(new Paragraph({
                children: [
                  new TextRun({ text: "Result: ", font: "Courier New", size: 16, color: "A0A0A0", bold: true }),
                  new TextRun({ text: truncResult, font: "Courier New", size: 16, color: "A0A0A0" }),
                ],
                spacing: { after: 40 },
              }));
            }
          }
        }
      } catch { /* invalid blocks JSON, skip */ }
    } else if (msg.content) {
      children.push(...contentToParagraphs(msg.content));
    }

    // Separator
    children.push(new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: "E0E0E0" } },
      spacing: { before: 100, after: 100 },
    }));
  }

  if (messages.length === 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: "No messages in this session.", italics: true, color: "A0A0A0" })],
    }));
  }

  // Footer
  children.push(new Paragraph({
    children: [new TextRun({ text: "Exported from Strix", size: 16, color: "A0A0A0", italics: true })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 400 },
  }));

  const doc = new Document({
    sections: [{ children }],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
