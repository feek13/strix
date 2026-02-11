use serde::{Deserialize, Serialize};

use super::{Agent, AgentStatus, LogEntry, Scan, ToolExecution, Vulnerability};

/// Server → Client WebSocket messages.
/// Discriminated union using `type` field, matching TypeScript WSMessage exactly.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WSMessage {
    #[serde(rename = "INIT_STATE")]
    InitState { payload: InitStatePayload },

    #[serde(rename = "SCAN_STARTED")]
    ScanStarted { payload: Scan },

    #[serde(rename = "SCAN_UPDATED")]
    ScanUpdated { payload: ScanUpdatePayload },

    #[serde(rename = "AGENT_CREATED")]
    AgentCreated { payload: Agent },

    #[serde(rename = "AGENT_STATUS_CHANGED")]
    AgentStatusChanged { payload: AgentStatusPayload },

    #[serde(rename = "TOOL_STARTED")]
    ToolStarted { payload: ToolExecution },

    #[serde(rename = "TOOL_COMPLETED")]
    ToolCompleted { payload: ToolExecution },

    #[serde(rename = "VULNERABILITY_FOUND")]
    VulnerabilityFound { payload: Vulnerability },

    #[serde(rename = "LOG_ENTRY")]
    LogEntry { payload: LogEntry },

    #[serde(rename = "PONG")]
    Pong { payload: PongPayload },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitStatePayload {
    pub scan: Option<Scan>,
    pub agents: Vec<Agent>,
    pub tool_executions: Vec<ToolExecution>,
    pub vulnerabilities: Vec<Vulnerability>,
    pub logs: Vec<LogEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanUpdatePayload {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<super::ScanStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub findings: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatusPayload {
    pub id: String,
    pub status: AgentStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PongPayload {
    pub timestamp: String,
}

/// Client → Server WebSocket messages.
/// Discriminated union using `type` field, matching TypeScript WSClientMessage exactly.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WSClientMessage {
    #[serde(rename = "PING")]
    Ping,

    #[serde(rename = "CLEAR_ALL")]
    ClearAll,

    #[serde(rename = "SUBSCRIBE_SCAN")]
    SubscribeScan { payload: SubscribeScanPayload },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscribeScanPayload {
    pub scan_id: String,
}
