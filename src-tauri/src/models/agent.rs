use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, strum::AsRefStr, strum::EnumString)]
#[strum(serialize_all = "lowercase")]
#[serde(rename_all = "camelCase")]
pub enum AgentStatus {
    Running,
    Waiting,
    Completed,
    Failed,
    Stopped,
}

impl AgentStatus {
    pub fn as_str(&self) -> &str { self.as_ref() }
    pub fn from_str(s: &str) -> Self { s.parse().unwrap_or(Self::Running) }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub id: String,
    pub scan_id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub status: AgentStatus,
    pub task: String,
    pub created_at: String,
    pub finished_at: Option<String>,
}
