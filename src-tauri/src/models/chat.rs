use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSession {
    pub id: String,
    pub user_id: String,
    pub scan_id: Option<String>,
    pub claude_session_id: Option<String>,
    pub claude_session_mode: Option<String>,
    pub cwd: Option<String>,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageRecord {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_execute: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocks: Option<String>,
    pub created_at: String,
}
