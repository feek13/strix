use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, strum::AsRefStr, strum::EnumString)]
#[strum(serialize_all = "lowercase")]
#[serde(rename_all = "camelCase")]
pub enum ScanStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Stopped,
}

impl ScanStatus {
    pub fn as_str(&self) -> &str { self.as_ref() }
    pub fn from_str(s: &str) -> Self { s.parse().unwrap_or(Self::Pending) }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, strum::AsRefStr, strum::EnumString)]
#[strum(serialize_all = "lowercase")]
#[serde(rename_all = "camelCase")]
pub enum TargetType {
    Url,
    Github,
    Local,
}

impl TargetType {
    pub fn as_str(&self) -> &str { self.as_ref() }
    pub fn from_str(s: &str) -> Self { s.parse().unwrap_or(Self::Url) }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scan {
    pub id: String,
    pub target: String,
    pub target_type: TargetType,
    pub status: ScanStatus,
    pub mode: String,
    pub created_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub findings: i64,
    pub claude_session_id: Option<String>,
}
