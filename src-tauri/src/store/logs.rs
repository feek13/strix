use rusqlite::params;

use super::AppDb;
use crate::models::{LogEntry, LogLevel};

impl AppDb {
    pub fn save_log(&self, log: &LogEntry) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO logs (id, scan_id, agent_id, level, message, tool_name, timestamp, details)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                log.id,
                log.scan_id,
                log.agent_id,
                log.level.as_str(),
                log.message,
                log.tool_name,
                log.timestamp,
                log.details.as_ref().map(|d| serde_json::to_string(d).unwrap_or_default()),
            ],
        )?;
        Ok(())
    }

    pub fn get_logs_by_scan(&self, scan_id: &str) -> anyhow::Result<Vec<LogEntry>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT * FROM logs WHERE scan_id = ?1 ORDER BY timestamp")?;
        let logs = stmt.query_map(params![scan_id], |row| Ok(row_to_log(row)))?.collect::<Result<Vec<_>, _>>()?;
        Ok(logs)
    }

    pub fn get_recent_logs(&self, scan_id: &str, limit: i64) -> anyhow::Result<Vec<LogEntry>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT * FROM logs WHERE scan_id = ?1 ORDER BY timestamp DESC LIMIT ?2")?;
        let mut logs: Vec<LogEntry> = stmt.query_map(params![scan_id, limit], |row| Ok(row_to_log(row)))?.collect::<Result<Vec<_>, _>>()?;
        logs.reverse();
        Ok(logs)
    }

    pub fn clear_all(&self) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "DELETE FROM logs; DELETE FROM vulnerabilities; DELETE FROM tool_executions; DELETE FROM agents; DELETE FROM scans;"
        )?;
        Ok(())
    }
}

fn row_to_log(row: &rusqlite::Row) -> LogEntry {
    let details_str: Option<String> = row.get_unwrap("details");
    LogEntry {
        id: row.get_unwrap("id"),
        scan_id: row.get_unwrap("scan_id"),
        agent_id: row.get_unwrap("agent_id"),
        level: LogLevel::from_str(&row.get_unwrap::<_, String>("level")),
        message: row.get_unwrap("message"),
        tool_name: row.get_unwrap("tool_name"),
        timestamp: row.get_unwrap("timestamp"),
        details: details_str.and_then(|s| serde_json::from_str(&s).ok()),
    }
}
