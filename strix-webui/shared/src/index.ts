// ============================================================
// Strix WebUI Shared Types
// Used by both backend and frontend
// ============================================================

// ==================== Scan ====================

export type ScanStatus = "pending" | "running" | "completed" | "failed" | "stopped";

export interface Scan {
  id: string;
  target: string;
  targetType: "url" | "github" | "local";
  status: ScanStatus;
  mode: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  findings: number;
}

// ==================== Agent ====================

export type AgentStatus = "running" | "waiting" | "completed" | "failed" | "stopped";

export interface Agent {
  id: string;
  scanId: string;
  name: string;
  parentId: string | null;
  status: AgentStatus;
  task: string;
  createdAt: string;
  finishedAt: string | null;
}

// ==================== Tool Execution ====================

export type ToolExecutionStatus = "running" | "completed" | "error";

export interface ToolExecution {
  id: string;
  scanId: string;
  agentId: string;
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolOutput?: unknown;
  status: ToolExecutionStatus;
  startedAt: string;
  completedAt?: string;
  duration?: number;
}

// ==================== Vulnerability ====================

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface Vulnerability {
  id: string;
  scanId: string;
  agentId: string;
  title: string;
  severity: Severity;
  description: string;
  affectedUrl?: string;
  proofOfConcept?: string;
  impact?: string;
  remediation?: string;
  cvss?: number;
  references?: string[];
  discoveredAt: string;
}

// ==================== Log Entry ====================

export type LogLevel = "info" | "success" | "warning" | "error" | "debug";

export interface LogEntry {
  id: string;
  scanId: string;
  agentId?: string;
  level: LogLevel;
  message: string;
  toolName?: string;
  timestamp: string;
  details?: unknown;
}

// ==================== Truncated Output ====================

export interface TruncatedOutput {
  __truncated: true;
  __contentId: string;
  __originalSize: number;
  __preview: string;
}

export function isTruncatedOutput(value: unknown): value is TruncatedOutput {
  return (
    typeof value === "object" &&
    value !== null &&
    "__truncated" in value &&
    (value as Record<string, unknown>).__truncated === true
  );
}

// ==================== Hook Input ====================

export interface HookInput {
  hook_event_name: string;
  session_id: string;
  transcript_path: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_use_id?: string;
  tool_response?: unknown;
  cwd?: string;
}

// ==================== Internal Events (JSONL) ====================

export type InternalEvent =
  | { type: "SCAN_STARTED"; timestamp: string; scanId: string; target: string; targetType: string; mode: string }
  | { type: "AGENT_CREATING"; timestamp: string; scanId: string; sessionId: string; toolUseId: string; taskInput: Record<string, unknown> }
  | { type: "AGENT_STOPPED"; timestamp: string; sessionId: string }
  | { type: "TOOL_STARTED"; timestamp: string; scanId: string; sessionId: string; toolUseId: string; toolName: string; toolInput: Record<string, unknown> }
  | { type: "TOOL_COMPLETED"; timestamp: string; scanId: string; sessionId: string; toolUseId: string; toolName: string; toolInput: Record<string, unknown>; toolOutput: unknown }
  | { type: "VULNERABILITY_FOUND"; timestamp: string; scanId: string; agentId: string; vulnerability: Omit<Vulnerability, "id" | "scanId" | "agentId" | "discoveredAt"> }
  | { type: "SCAN_COMPLETED"; timestamp: string; scanId: string; status: ScanStatus };

// ==================== WebSocket Messages ====================

export type WSMessage =
  | { type: "INIT_STATE"; payload: { scan: Scan | null; agents: Agent[]; toolExecutions: ToolExecution[]; vulnerabilities: Vulnerability[]; logs: LogEntry[] } }
  | { type: "SCAN_STARTED"; payload: Scan }
  | { type: "SCAN_UPDATED"; payload: Partial<Scan> & { id: string } }
  | { type: "AGENT_CREATED"; payload: Agent }
  | { type: "AGENT_STATUS_CHANGED"; payload: { id: string; status: AgentStatus; finishedAt?: string } }
  | { type: "TOOL_STARTED"; payload: ToolExecution }
  | { type: "TOOL_COMPLETED"; payload: ToolExecution }
  | { type: "VULNERABILITY_FOUND"; payload: Vulnerability }
  | { type: "LOG_ENTRY"; payload: LogEntry }
  | { type: "PONG"; payload: { timestamp: string } };

export type WSClientMessage =
  | { type: "PING" }
  | { type: "CLEAR_ALL" }
  | { type: "SUBSCRIBE_SCAN"; payload: { scanId: string } };

// ==================== Tool Categories ====================

export interface ToolCategory {
  id: string;
  label: string;
  icon: string;
  tools: string[];
}

export const TOOL_CATEGORIES: ToolCategory[] = [
  {
    id: "browser",
    label: "Browser",
    icon: "globe",
    tools: ["browser_action"],
  },
  {
    id: "proxy",
    label: "HTTP Proxy",
    icon: "network",
    tools: [
      "proxy_start", "proxy_list_requests", "proxy_view_request",
      "proxy_send_request", "proxy_repeat_request", "proxy_set_scope", "proxy_get_sitemap",
    ],
  },
  {
    id: "terminal",
    label: "Terminal",
    icon: "terminal",
    tools: ["terminal_execute"],
  },
  {
    id: "python",
    label: "Python",
    icon: "code",
    tools: ["python_action"],
  },
  {
    id: "files",
    label: "File Editor",
    icon: "file-edit",
    tools: ["str_replace_editor", "list_files", "search_files"],
  },
  {
    id: "findings",
    label: "Findings",
    icon: "shield-alert",
    tools: ["create_vulnerability_report"],
  },
  {
    id: "notes",
    label: "Notes",
    icon: "sticky-note",
    tools: ["create_note", "list_notes", "update_note", "delete_note"],
  },
  {
    id: "agents",
    label: "Agents",
    icon: "users",
    tools: [
      "create_agent", "send_message_to_agent", "wait_for_message",
      "view_agent_graph", "agent_finish", "finish_scan",
    ],
  },
  {
    id: "sandbox",
    label: "Sandbox",
    icon: "box",
    tools: ["sandbox_create", "sandbox_destroy", "sandbox_status"],
  },
  {
    id: "thinking",
    label: "Thinking",
    icon: "brain",
    tools: ["think"],
  },
];

export const SKILL_CATEGORIES = [
  { id: "recon", label: "Recon", icon: "search", skill: "security-recon" },
  { id: "injection", label: "Injection Testing", icon: "syringe", skill: "injection-testing" },
  { id: "auth", label: "Auth Testing", icon: "lock", skill: "auth-testing" },
  { id: "logic", label: "Logic Testing", icon: "workflow", skill: "logic-testing" },
  { id: "platform", label: "Platform Testing", icon: "server", skill: "platform-testing" },
  { id: "redteam", label: "Red Team Ops", icon: "target", skill: "red-team-operations" },
];

// ==================== Chat Sessions ====================

export interface ChatSession {
  id: string;
  userId: string;
  scanId: string | null;
  claudeSessionId: string | null;  // maps to Claude CLI --session-id UUID
  claudeSessionMode: string | null; // mode the CLI session was created with ("ask" | "execute")
  cwd: string | null;              // working directory for this session
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessageRecord {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  isExecute?: boolean;
  blocks?: string; // JSON-serialized StreamBlock[]
  createdAt: string;
}
