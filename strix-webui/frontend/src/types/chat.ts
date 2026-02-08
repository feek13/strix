/** Shared chat types used across AskAI, ReportPreview, and export */

export interface ToolBlock {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: "running" | "done" | "error";
  result?: string;
}

export interface StreamBlock {
  type: "text" | "tool";
  text?: string;
  tool?: ToolBlock;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  isExecute?: boolean;
  blocks?: StreamBlock[];
  createdAt?: string;
}
