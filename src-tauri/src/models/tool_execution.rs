use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, strum::AsRefStr, strum::EnumString)]
#[strum(serialize_all = "lowercase")]
#[serde(rename_all = "camelCase")]
pub enum ToolExecutionStatus {
    Running,
    Completed,
    Error,
}

impl ToolExecutionStatus {
    pub fn as_str(&self) -> &str { self.as_ref() }
    pub fn from_str(s: &str) -> Self { s.parse().unwrap_or(Self::Running) }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolExecution {
    pub id: String,
    pub scan_id: String,
    pub agent_id: String,
    pub session_id: String,
    pub tool_name: String,
    pub tool_input: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_output: Option<serde_json::Value>,
    pub status: ToolExecutionStatus,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
}
