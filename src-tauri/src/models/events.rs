use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Internal events written to events.jsonl by hooks and read by EventReceiver.
/// Discriminated union using `type` field, matching TypeScript InternalEvent exactly.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum InternalEvent {
    #[serde(rename = "SCAN_STARTED")]
    ScanStarted {
        timestamp: String,
        #[serde(rename = "scanId")]
        scan_id: String,
        target: String,
        #[serde(rename = "targetType")]
        target_type: String,
        mode: String,
    },

    #[serde(rename = "AGENT_CREATING")]
    AgentCreating {
        timestamp: String,
        #[serde(rename = "scanId")]
        scan_id: String,
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "toolUseId")]
        tool_use_id: String,
        #[serde(rename = "taskInput")]
        task_input: Value,
    },

    #[serde(rename = "AGENT_STOPPED")]
    AgentStopped {
        timestamp: String,
        #[serde(rename = "sessionId")]
        session_id: String,
    },

    #[serde(rename = "TOOL_STARTED")]
    ToolStarted {
        timestamp: String,
        #[serde(rename = "scanId")]
        scan_id: String,
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "toolUseId")]
        tool_use_id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
        #[serde(rename = "toolInput")]
        tool_input: Value,
    },

    #[serde(rename = "TOOL_COMPLETED")]
    ToolCompleted {
        timestamp: String,
        #[serde(rename = "scanId")]
        scan_id: String,
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "toolUseId")]
        tool_use_id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
        #[serde(rename = "toolInput")]
        tool_input: Value,
        #[serde(rename = "toolOutput")]
        tool_output: Value,
    },

    #[serde(rename = "VULNERABILITY_FOUND")]
    VulnerabilityFound {
        timestamp: String,
        #[serde(rename = "scanId")]
        scan_id: String,
        #[serde(rename = "agentId")]
        agent_id: String,
        vulnerability: VulnerabilityInfo,
    },

    #[serde(rename = "SCAN_COMPLETED")]
    ScanCompleted {
        timestamp: String,
        #[serde(rename = "scanId")]
        scan_id: String,
        status: String,
    },
}

/// Partial vulnerability info emitted in VULNERABILITY_FOUND events.
/// Matches `Omit<Vulnerability, "id" | "scanId" | "agentId" | "discoveredAt">`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VulnerabilityInfo {
    pub title: String,
    pub severity: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub affected_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proof_of_concept: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub impact: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remediation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cvss: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub references: Option<Vec<String>>,
}
