import Database from "better-sqlite3";
import { join } from "path";
import { homedir } from "os";
import { mkdirSync } from "fs";
import type { Scan, Agent, ToolExecution, Vulnerability, LogEntry, ChatSession, ChatMessageRecord } from "@strix-webui/shared";

const DATA_DIR = join(homedir(), ".strix-webui");
mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(join(DATA_DIR, "strix.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS scans (
    id TEXT PRIMARY KEY,
    target TEXT NOT NULL,
    target_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    mode TEXT NOT NULL DEFAULT 'auto',
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    findings INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    scan_id TEXT NOT NULL,
    name TEXT NOT NULL,
    parent_id TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    task TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    finished_at TEXT,
    FOREIGN KEY (scan_id) REFERENCES scans(id)
  );

  CREATE TABLE IF NOT EXISTS tool_executions (
    id TEXT PRIMARY KEY,
    scan_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    tool_input TEXT NOT NULL DEFAULT '{}',
    tool_output TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    started_at TEXT NOT NULL,
    completed_at TEXT,
    duration REAL,
    FOREIGN KEY (scan_id) REFERENCES scans(id)
  );

  CREATE TABLE IF NOT EXISTS vulnerabilities (
    id TEXT PRIMARY KEY,
    scan_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    title TEXT NOT NULL,
    severity TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    affected_url TEXT,
    proof_of_concept TEXT,
    impact TEXT,
    remediation TEXT,
    cvss REAL,
    references_json TEXT,
    discovered_at TEXT NOT NULL,
    FOREIGN KEY (scan_id) REFERENCES scans(id)
  );

  CREATE TABLE IF NOT EXISTS logs (
    id TEXT PRIMARY KEY,
    scan_id TEXT NOT NULL,
    agent_id TEXT,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    tool_name TEXT,
    timestamp TEXT NOT NULL,
    details TEXT,
    FOREIGN KEY (scan_id) REFERENCES scans(id)
  );

  CREATE INDEX IF NOT EXISTS idx_agents_scan ON agents(scan_id);
  CREATE INDEX IF NOT EXISTS idx_tools_scan ON tool_executions(scan_id);
  CREATE INDEX IF NOT EXISTS idx_vulns_scan ON vulnerabilities(scan_id);
  CREATE INDEX IF NOT EXISTS idx_logs_scan ON logs(scan_id);

  CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    scan_id TEXT,
    title TEXT NOT NULL DEFAULT 'New Chat',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    is_execute INTEGER NOT NULL DEFAULT 0,
    blocks TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
`);

// Migrations — add new columns idempotently
try { db.exec(`ALTER TABLE chat_sessions ADD COLUMN claude_session_id TEXT`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE chat_sessions ADD COLUMN cwd TEXT`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE chat_sessions ADD COLUMN claude_session_mode TEXT`); } catch { /* already exists */ }

const stmts = {
  insertScan: db.prepare(`INSERT INTO scans (id, target, target_type, status, mode, created_at, started_at, completed_at, findings) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  getScan: db.prepare(`SELECT * FROM scans WHERE id = ?`),
  getAllScans: db.prepare(`SELECT * FROM scans ORDER BY created_at DESC`),
  updateScanStatus: db.prepare(`UPDATE scans SET status = ?, completed_at = ? WHERE id = ?`),
  updateScanFindings: db.prepare(`UPDATE scans SET findings = ? WHERE id = ?`),

  insertAgent: db.prepare(`INSERT OR REPLACE INTO agents (id, scan_id, name, parent_id, status, task, created_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  getAgent: db.prepare(`SELECT * FROM agents WHERE id = ?`),
  getAgentsByScan: db.prepare(`SELECT * FROM agents WHERE scan_id = ? ORDER BY created_at`),
  getAllAgents: db.prepare(`SELECT * FROM agents ORDER BY created_at`),
  updateAgentStatus: db.prepare(`UPDATE agents SET status = ?, finished_at = ? WHERE id = ?`),

  insertToolExecution: db.prepare(`INSERT OR REPLACE INTO tool_executions (id, scan_id, agent_id, session_id, tool_name, tool_input, tool_output, status, started_at, completed_at, duration) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  getToolExecution: db.prepare(`SELECT * FROM tool_executions WHERE id = ?`),
  getToolsByScan: db.prepare(`SELECT * FROM tool_executions WHERE scan_id = ? ORDER BY started_at`),
  getAllToolExecutions: db.prepare(`SELECT * FROM tool_executions ORDER BY started_at`),
  updateToolExecution: db.prepare(`UPDATE tool_executions SET status = ?, tool_output = ?, completed_at = ?, duration = ? WHERE id = ?`),

  insertVulnerability: db.prepare(`INSERT INTO vulnerabilities (id, scan_id, agent_id, title, severity, description, affected_url, proof_of_concept, impact, remediation, cvss, references_json, discovered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  getVulnsByScan: db.prepare(`SELECT * FROM vulnerabilities WHERE scan_id = ? ORDER BY discovered_at`),

  insertLog: db.prepare(`INSERT INTO logs (id, scan_id, agent_id, level, message, tool_name, timestamp, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  getLogsByScan: db.prepare(`SELECT * FROM logs WHERE scan_id = ? ORDER BY timestamp`),
  getRecentLogs: db.prepare(`SELECT * FROM logs WHERE scan_id = ? ORDER BY timestamp DESC LIMIT ?`),

  insertChatSession: db.prepare(`INSERT INTO chat_sessions (id, user_id, scan_id, claude_session_id, cwd, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  getChatSession: db.prepare(`SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?`),
  getChatSessionsByUser: db.prepare(`SELECT * FROM chat_sessions WHERE user_id = ? ORDER BY updated_at DESC`),
  updateChatSessionTitle: db.prepare(`UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?`),
  updateChatSessionTimestamp: db.prepare(`UPDATE chat_sessions SET updated_at = ? WHERE id = ?`),
  updateChatSessionClaudeId: db.prepare(`UPDATE chat_sessions SET claude_session_id = ?, claude_session_mode = ?, updated_at = ? WHERE id = ? AND user_id = ?`),
  getChatSessionById: db.prepare(`SELECT * FROM chat_sessions WHERE id = ?`),
  deleteChatSession: db.prepare(`DELETE FROM chat_sessions WHERE id = ? AND user_id = ?`),
  deleteChatMessages: db.prepare(`DELETE FROM chat_messages WHERE session_id = ?`),

  insertChatMessage: db.prepare(`INSERT INTO chat_messages (id, session_id, role, content, is_execute, blocks, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`),
  getChatMessages: db.prepare(`SELECT cm.* FROM chat_messages cm JOIN chat_sessions cs ON cm.session_id = cs.id WHERE cm.session_id = ? AND cs.user_id = ? ORDER BY cm.created_at`),
};

function rowToScan(row: Record<string, unknown>): Scan {
  return {
    id: row.id as string,
    target: row.target as string,
    targetType: row.target_type as Scan["targetType"],
    status: row.status as Scan["status"],
    mode: row.mode as string,
    createdAt: row.created_at as string,
    startedAt: row.started_at as string | null,
    completedAt: row.completed_at as string | null,
    findings: row.findings as number,
  };
}

function rowToAgent(row: Record<string, unknown>): Agent {
  return {
    id: row.id as string,
    scanId: row.scan_id as string,
    name: row.name as string,
    parentId: row.parent_id as string | null,
    status: row.status as Agent["status"],
    task: row.task as string,
    createdAt: row.created_at as string,
    finishedAt: row.finished_at as string | null,
  };
}

function rowToToolExecution(row: Record<string, unknown>): ToolExecution {
  return {
    id: row.id as string,
    scanId: row.scan_id as string,
    agentId: row.agent_id as string,
    sessionId: row.session_id as string,
    toolName: row.tool_name as string,
    toolInput: JSON.parse((row.tool_input as string) || "{}"),
    toolOutput: row.tool_output ? JSON.parse(row.tool_output as string) : undefined,
    status: row.status as ToolExecution["status"],
    startedAt: row.started_at as string,
    completedAt: row.completed_at as string | undefined,
    duration: row.duration as number | undefined,
  };
}

function rowToVulnerability(row: Record<string, unknown>): Vulnerability {
  return {
    id: row.id as string,
    scanId: row.scan_id as string,
    agentId: row.agent_id as string,
    title: row.title as string,
    severity: row.severity as Vulnerability["severity"],
    description: row.description as string,
    affectedUrl: row.affected_url as string | undefined,
    proofOfConcept: row.proof_of_concept as string | undefined,
    impact: row.impact as string | undefined,
    remediation: row.remediation as string | undefined,
    cvss: row.cvss as number | undefined,
    references: row.references_json ? JSON.parse(row.references_json as string) : undefined,
    discoveredAt: row.discovered_at as string,
  };
}

function rowToLog(row: Record<string, unknown>): LogEntry {
  return {
    id: row.id as string,
    scanId: row.scan_id as string,
    agentId: row.agent_id as string | undefined,
    level: row.level as LogEntry["level"],
    message: row.message as string,
    toolName: row.tool_name as string | undefined,
    timestamp: row.timestamp as string,
    details: row.details ? JSON.parse(row.details as string) : undefined,
  };
}

function rowToChatSession(row: Record<string, unknown>): ChatSession {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    scanId: row.scan_id as string | null,
    claudeSessionId: (row.claude_session_id as string) || null,
    claudeSessionMode: (row.claude_session_mode as string) || null,
    cwd: (row.cwd as string) || null,
    title: row.title as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function rowToChatMessage(row: Record<string, unknown>): ChatMessageRecord {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    role: row.role as "user" | "assistant",
    content: row.content as string,
    isExecute: (row.is_execute as number) === 1 ? true : undefined,
    blocks: row.blocks as string | undefined,
    createdAt: row.created_at as string,
  };
}

export const store = {
  saveScan(scan: Scan): void {
    stmts.insertScan.run(scan.id, scan.target, scan.targetType, scan.status, scan.mode, scan.createdAt, scan.startedAt, scan.completedAt, scan.findings);
  },
  getScan(id: string): Scan | undefined {
    const row = stmts.getScan.get(id) as Record<string, unknown> | undefined;
    return row ? rowToScan(row) : undefined;
  },
  getAllScans(): Scan[] {
    return (stmts.getAllScans.all() as Record<string, unknown>[]).map(rowToScan);
  },
  updateScanStatus(id: string, status: Scan["status"], completedAt?: string): void {
    stmts.updateScanStatus.run(status, completedAt || null, id);
  },
  updateScanFindings(id: string, count: number): void {
    stmts.updateScanFindings.run(count, id);
  },

  saveAgent(agent: Agent): void {
    stmts.insertAgent.run(agent.id, agent.scanId, agent.name, agent.parentId, agent.status, agent.task, agent.createdAt, agent.finishedAt);
  },
  getAgent(id: string): Agent | undefined {
    const row = stmts.getAgent.get(id) as Record<string, unknown> | undefined;
    return row ? rowToAgent(row) : undefined;
  },
  getAgentsByScan(scanId: string): Agent[] {
    return (stmts.getAgentsByScan.all(scanId) as Record<string, unknown>[]).map(rowToAgent);
  },
  getAllAgents(): Agent[] {
    return (stmts.getAllAgents.all() as Record<string, unknown>[]).map(rowToAgent);
  },
  updateAgentStatus(id: string, status: Agent["status"], finishedAt?: string): void {
    stmts.updateAgentStatus.run(status, finishedAt || null, id);
  },

  saveToolExecution(te: ToolExecution): void {
    stmts.insertToolExecution.run(te.id, te.scanId, te.agentId, te.sessionId, te.toolName, JSON.stringify(te.toolInput), te.toolOutput ? JSON.stringify(te.toolOutput) : null, te.status, te.startedAt, te.completedAt || null, te.duration || null);
  },
  getToolExecution(id: string): ToolExecution | undefined {
    const row = stmts.getToolExecution.get(id) as Record<string, unknown> | undefined;
    return row ? rowToToolExecution(row) : undefined;
  },
  getToolsByScan(scanId: string): ToolExecution[] {
    return (stmts.getToolsByScan.all(scanId) as Record<string, unknown>[]).map(rowToToolExecution);
  },
  getAllToolExecutions(): ToolExecution[] {
    return (stmts.getAllToolExecutions.all() as Record<string, unknown>[]).map(rowToToolExecution);
  },
  updateToolExecution(id: string, updates: Partial<ToolExecution>): void {
    const existing = store.getToolExecution(id);
    if (!existing) return;
    const duration = updates.completedAt && existing.startedAt
      ? new Date(updates.completedAt).getTime() - new Date(existing.startedAt).getTime()
      : null;
    stmts.updateToolExecution.run(
      updates.status || existing.status,
      updates.toolOutput !== undefined ? JSON.stringify(updates.toolOutput) : (existing.toolOutput ? JSON.stringify(existing.toolOutput) : null),
      updates.completedAt || existing.completedAt || null,
      duration,
      id
    );
  },

  saveVulnerability(v: Vulnerability): void {
    stmts.insertVulnerability.run(v.id, v.scanId, v.agentId, v.title, v.severity, v.description, v.affectedUrl || null, v.proofOfConcept || null, v.impact || null, v.remediation || null, v.cvss || null, v.references ? JSON.stringify(v.references) : null, v.discoveredAt);
  },
  getVulnsByScan(scanId: string): Vulnerability[] {
    return (stmts.getVulnsByScan.all(scanId) as Record<string, unknown>[]).map(rowToVulnerability);
  },

  saveLog(log: LogEntry): void {
    stmts.insertLog.run(log.id, log.scanId, log.agentId || null, log.level, log.message, log.toolName || null, log.timestamp, log.details ? JSON.stringify(log.details) : null);
  },
  getLogsByScan(scanId: string): LogEntry[] {
    return (stmts.getLogsByScan.all(scanId) as Record<string, unknown>[]).map(rowToLog);
  },
  getRecentLogs(scanId: string, limit: number = 100): LogEntry[] {
    return (stmts.getRecentLogs.all(scanId, limit) as Record<string, unknown>[]).map(rowToLog).reverse();
  },

  clearAll(): void {
    db.exec("DELETE FROM logs; DELETE FROM vulnerabilities; DELETE FROM tool_executions; DELETE FROM agents; DELETE FROM scans;");
  },

  // Chat sessions
  createChatSession(session: ChatSession): void {
    stmts.insertChatSession.run(session.id, session.userId, session.scanId, session.claudeSessionId, session.cwd, session.title, session.createdAt, session.updatedAt);
  },
  getChatSession(id: string, userId: string): ChatSession | undefined {
    const row = stmts.getChatSession.get(id, userId) as Record<string, unknown> | undefined;
    return row ? rowToChatSession(row) : undefined;
  },
  getChatSessionsByUser(userId: string): ChatSession[] {
    return (stmts.getChatSessionsByUser.all(userId) as Record<string, unknown>[]).map(rowToChatSession);
  },
  updateChatSessionTitle(id: string, userId: string, title: string): void {
    stmts.updateChatSessionTitle.run(title, new Date().toISOString(), id, userId);
  },
  deleteChatSession(id: string, userId: string): void {
    stmts.deleteChatMessages.run(id);
    stmts.deleteChatSession.run(id, userId);
  },
  updateChatSessionClaudeId(id: string, userId: string, claudeSessionId: string, mode?: string): void {
    stmts.updateChatSessionClaudeId.run(claudeSessionId, mode || null, new Date().toISOString(), id, userId);
  },
  getChatSessionById(id: string): ChatSession | undefined {
    const row = stmts.getChatSessionById.get(id) as Record<string, unknown> | undefined;
    return row ? rowToChatSession(row) : undefined;
  },
  addChatMessage(message: ChatMessageRecord): void {
    stmts.insertChatMessage.run(message.id, message.sessionId, message.role, message.content, message.isExecute ? 1 : 0, message.blocks || null, message.createdAt);
    stmts.updateChatSessionTimestamp.run(message.createdAt, message.sessionId);
  },
  getChatMessages(sessionId: string, userId: string): ChatMessageRecord[] {
    return (stmts.getChatMessages.all(sessionId, userId) as Record<string, unknown>[]).map(rowToChatMessage);
  },
};
