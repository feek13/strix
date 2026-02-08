// Re-export shared types for frontend use
export type {
  Scan,
  ScanStatus,
  Agent,
  AgentStatus,
  ToolExecution,
  ToolExecutionStatus,
  Vulnerability,
  Severity,
  LogEntry,
  LogLevel,
  TruncatedOutput,
  WSMessage,
  WSClientMessage,
  ToolCategory,
  ChatSession,
  ChatMessageRecord,
} from "@shared/index";

export {
  isTruncatedOutput,
  TOOL_CATEGORIES,
  SKILL_CATEGORIES,
} from "@shared/index";
