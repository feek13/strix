use rusqlite::{params, OptionalExtension};

use super::AppDb;
use crate::models::{ToolExecution, ToolExecutionStatus};

impl AppDb {
    pub fn save_tool_execution(&self, te: &ToolExecution) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO tool_executions (id, scan_id, agent_id, session_id, tool_name, tool_input, tool_output, status, started_at, completed_at, duration)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                te.id,
                te.scan_id,
                te.agent_id,
                te.session_id,
                te.tool_name,
                serde_json::to_string(&te.tool_input).unwrap_or_default(),
                te.tool_output.as_ref().map(|v| serde_json::to_string(v).unwrap_or_default()),
                te.status.as_str(),
                te.started_at,
                te.completed_at,
                te.duration,
            ],
        )?;
        Ok(())
    }

    pub fn get_tool_execution(&self, id: &str) -> anyhow::Result<Option<ToolExecution>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT * FROM tool_executions WHERE id = ?1")?;
        let result = stmt.query_row(params![id], row_to_tool_execution).optional()?;
        Ok(result)
    }

    pub fn get_tools_by_scan(&self, scan_id: &str) -> anyhow::Result<Vec<ToolExecution>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT * FROM tool_executions WHERE scan_id = ?1 ORDER BY started_at")?;
        let tools = stmt.query_map(params![scan_id], row_to_tool_execution)?.collect::<Result<Vec<_>, _>>()?;
        Ok(tools)
    }

    pub fn get_all_tool_executions(&self) -> anyhow::Result<Vec<ToolExecution>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT * FROM tool_executions ORDER BY started_at")?;
        let tools = stmt.query_map([], row_to_tool_execution)?.collect::<Result<Vec<_>, _>>()?;
        Ok(tools)
    }

    /// Update a tool execution. Auto-calculates duration if completedAt is provided.
    pub fn update_tool_execution(
        &self,
        id: &str,
        status: Option<&ToolExecutionStatus>,
        tool_output: Option<&serde_json::Value>,
        completed_at: Option<&str>,
    ) -> anyhow::Result<()> {
        let existing = self.get_tool_execution(id)?;
        let Some(existing) = existing else {
            return Ok(());
        };

        let final_status = status.map(|s| s.as_str()).unwrap_or(existing.status.as_str());
        let final_output = tool_output
            .map(|v| serde_json::to_string(v).unwrap_or_default())
            .or_else(|| existing.tool_output.as_ref().map(|v| serde_json::to_string(v).unwrap_or_default()));
        let final_completed = completed_at
            .map(|s| s.to_string())
            .or(existing.completed_at.clone());

        // Auto-calculate duration
        let duration: Option<f64> = if let Some(ref ca) = final_completed {
            if let (Ok(start), Ok(end)) = (
                chrono::DateTime::parse_from_rfc3339(&existing.started_at),
                chrono::DateTime::parse_from_rfc3339(ca),
            ) {
                Some((end - start).num_milliseconds() as f64)
            } else {
                None
            }
        } else {
            None
        };

        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE tool_executions SET status = ?1, tool_output = ?2, completed_at = ?3, duration = ?4 WHERE id = ?5",
            params![final_status, final_output, final_completed, duration, id],
        )?;
        Ok(())
    }
}

fn row_to_tool_execution(row: &rusqlite::Row) -> rusqlite::Result<ToolExecution> {
    let tool_input_str: String = row.get("tool_input")?;
    let tool_output_str: Option<String> = row.get("tool_output")?;

    Ok(ToolExecution {
        id: row.get("id")?,
        scan_id: row.get("scan_id")?,
        agent_id: row.get("agent_id")?,
        session_id: row.get("session_id")?,
        tool_name: row.get("tool_name")?,
        tool_input: serde_json::from_str(&tool_input_str).unwrap_or(serde_json::Value::Object(Default::default())),
        tool_output: tool_output_str.and_then(|s| serde_json::from_str(&s).ok()),
        status: ToolExecutionStatus::from_str(&row.get::<_, String>("status")?),
        started_at: row.get("started_at")?,
        completed_at: row.get("completed_at")?,
        duration: row.get("duration")?,
    })
}
