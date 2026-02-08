interface ToolBlock {
  name: string;
  status: string;
  input: Record<string, unknown>;
  result?: string;
}

interface StreamBlock {
  type: "text" | "tool";
  text?: string;
  tool?: ToolBlock;
}

export interface ExportMessage {
  role: "user" | "assistant";
  content: string;
  isExecute?: boolean;
  blocks?: StreamBlock[];
  createdAt?: string;
}

function formatDate(iso?: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/**
 * Normalize content that may have lost its newlines.
 * Inserts line breaks before markdown block markers that appear mid-line.
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

export function generateChatMarkdown(
  sessionTitle: string,
  messages: ExportMessage[],
  sessionCreatedAt?: string,
): string {
  const lines: string[] = [];

  lines.push(`# ${sessionTitle}`);
  const exportDate = new Date().toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
  const meta = [`*Exported from Strix on ${exportDate}`];
  if (sessionCreatedAt) {
    meta.push(` | Session created: ${formatDate(sessionCreatedAt)}`);
  }
  meta.push("*");
  lines.push(meta.join(""));
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const msg of messages) {
    const roleLabel = msg.role === "user" ? "User" : "Assistant";
    const timestamp = msg.createdAt ? ` — ${formatDate(msg.createdAt)}` : "";
    lines.push(`### **${roleLabel}**${timestamp}`);
    lines.push("");

    const hasBlocks = msg.blocks && msg.blocks.length > 0;

    // For messages with blocks (execute mode), use blocks only to avoid
    // duplicating text (content is a concatenation of all text blocks)
    if (hasBlocks) {
      for (const block of msg.blocks!) {
        if (block.type === "text" && block.text) {
          lines.push(normalizeContent(block.text));
          lines.push("");
        } else if (block.type === "tool" && block.tool) {
          const statusLabel = block.tool.status === "done" ? "done"
            : block.tool.status === "error" ? "error" : "running";

          lines.push(`> **Tool: ${block.tool.name}** (${statusLabel})`);
          lines.push(">");

          const inputStr = JSON.stringify(block.tool.input);
          const truncInput = inputStr.length > 200 ? inputStr.slice(0, 200) + "..." : inputStr;
          lines.push(`> Input: \`${truncInput}\``);

          if (block.tool.result) {
            const truncResult = block.tool.result.length > 300
              ? block.tool.result.slice(0, 300) + "..." : block.tool.result;
            lines.push(">");
            lines.push(`> Result: \`${truncResult}\``);
          }
          lines.push("");
        }
      }
    } else if (msg.content) {
      lines.push(normalizeContent(msg.content));
      lines.push("");
    }

    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}
