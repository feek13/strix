use rusqlite::{params, OptionalExtension};

use super::AppDb;
use crate::models::{ChatMessageRecord, ChatSession};

impl AppDb {
    pub fn create_chat_session(&self, session: &ChatSession) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO chat_sessions (id, user_id, scan_id, claude_session_id, cwd, title, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                session.id,
                session.user_id,
                session.scan_id,
                session.claude_session_id,
                session.cwd,
                session.title,
                session.created_at,
                session.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn get_chat_session(&self, id: &str, user_id: &str) -> anyhow::Result<Option<ChatSession>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT * FROM chat_sessions WHERE id = ?1 AND user_id = ?2")?;
        let result = stmt.query_row(params![id, user_id], |row| Ok(row_to_chat_session(row))).optional()?;
        Ok(result)
    }

    pub fn get_chat_sessions_by_user(&self, user_id: &str) -> anyhow::Result<Vec<ChatSession>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT * FROM chat_sessions WHERE user_id = ?1 ORDER BY updated_at DESC")?;
        let sessions = stmt.query_map(params![user_id], |row| Ok(row_to_chat_session(row)))?.collect::<Result<Vec<_>, _>>()?;
        Ok(sessions)
    }

    pub fn update_chat_session_title(&self, id: &str, user_id: &str, title: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE chat_sessions SET title = ?1, updated_at = ?2 WHERE id = ?3 AND user_id = ?4",
            params![title, now, id, user_id],
        )?;
        Ok(())
    }

    pub fn delete_chat_session(&self, id: &str, user_id: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM chat_messages WHERE session_id = ?1", params![id])?;
        conn.execute("DELETE FROM chat_sessions WHERE id = ?1 AND user_id = ?2", params![id, user_id])?;
        Ok(())
    }

    pub fn update_chat_session_claude_id(
        &self,
        id: &str,
        user_id: &str,
        claude_session_id: &str,
        mode: Option<&str>,
    ) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE chat_sessions SET claude_session_id = ?1, claude_session_mode = ?2, updated_at = ?3 WHERE id = ?4 AND user_id = ?5",
            params![claude_session_id, mode, now, id, user_id],
        )?;
        Ok(())
    }

    pub fn get_chat_session_by_id(&self, id: &str) -> anyhow::Result<Option<ChatSession>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT * FROM chat_sessions WHERE id = ?1")?;
        let result = stmt.query_row(params![id], |row| Ok(row_to_chat_session(row))).optional()?;
        Ok(result)
    }

    pub fn add_chat_message(&self, message: &ChatMessageRecord) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO chat_messages (id, session_id, role, content, is_execute, blocks, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                message.id,
                message.session_id,
                message.role,
                message.content,
                if message.is_execute.unwrap_or(false) { 1 } else { 0 },
                message.blocks,
                message.created_at,
            ],
        )?;
        // Update session timestamp
        conn.execute(
            "UPDATE chat_sessions SET updated_at = ?1 WHERE id = ?2",
            params![message.created_at, message.session_id],
        )?;
        Ok(())
    }

    pub fn get_chat_messages(&self, session_id: &str, user_id: &str) -> anyhow::Result<Vec<ChatMessageRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT cm.* FROM chat_messages cm
             JOIN chat_sessions cs ON cm.session_id = cs.id
             WHERE cm.session_id = ?1 AND cs.user_id = ?2
             ORDER BY cm.created_at"
        )?;
        let messages = stmt.query_map(params![session_id, user_id], |row| Ok(row_to_chat_message(row)))?.collect::<Result<Vec<_>, _>>()?;
        Ok(messages)
    }
}

fn row_to_chat_session(row: &rusqlite::Row) -> ChatSession {
    ChatSession {
        id: row.get_unwrap("id"),
        user_id: row.get_unwrap("user_id"),
        scan_id: row.get_unwrap("scan_id"),
        claude_session_id: row.get_unwrap("claude_session_id"),
        claude_session_mode: row.get_unwrap("claude_session_mode"),
        cwd: row.get_unwrap("cwd"),
        title: row.get_unwrap("title"),
        created_at: row.get_unwrap("created_at"),
        updated_at: row.get_unwrap("updated_at"),
    }
}

fn row_to_chat_message(row: &rusqlite::Row) -> ChatMessageRecord {
    let is_execute_int: i32 = row.get_unwrap("is_execute");
    ChatMessageRecord {
        id: row.get_unwrap("id"),
        session_id: row.get_unwrap("session_id"),
        role: row.get_unwrap("role"),
        content: row.get_unwrap("content"),
        is_execute: if is_execute_int == 1 { Some(true) } else { None },
        blocks: row.get_unwrap("blocks"),
        created_at: row.get_unwrap("created_at"),
    }
}
