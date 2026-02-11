use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ScanStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Stopped,
}

impl ScanStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Stopped => "stopped",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "pending" => Self::Pending,
            "running" => Self::Running,
            "completed" => Self::Completed,
            "failed" => Self::Failed,
            "stopped" => Self::Stopped,
            _ => Self::Pending,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum TargetType {
    Url,
    Github,
    Local,
}

impl TargetType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Url => "url",
            Self::Github => "github",
            Self::Local => "local",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "url" => Self::Url,
            "github" => Self::Github,
            "local" => Self::Local,
            _ => Self::Url,
        }
    }
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
