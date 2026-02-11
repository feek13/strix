use rusqlite::{params, OptionalExtension};

use super::AppDb;
use crate::models::{Agent, AgentStatus};

impl AppDb {
    pub fn save_agent(&self, agent: &Agent) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO agents (id, scan_id, name, parent_id, status, task, created_at, finished_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                agent.id,
                agent.scan_id,
                agent.name,
                agent.parent_id,
                agent.status.as_str(),
                agent.task,
                agent.created_at,
                agent.finished_at,
            ],
        )?;
        Ok(())
    }

    pub fn get_agent(&self, id: &str) -> anyhow::Result<Option<Agent>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT * FROM agents WHERE id = ?1")?;
        let result = stmt.query_row(params![id], |row| Ok(row_to_agent(row))).optional()?;
        Ok(result)
    }

    pub fn get_agents_by_scan(&self, scan_id: &str) -> anyhow::Result<Vec<Agent>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT * FROM agents WHERE scan_id = ?1 ORDER BY created_at")?;
        let agents = stmt.query_map(params![scan_id], |row| Ok(row_to_agent(row)))?.collect::<Result<Vec<_>, _>>()?;
        Ok(agents)
    }

    pub fn get_all_agents(&self) -> anyhow::Result<Vec<Agent>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT * FROM agents ORDER BY created_at")?;
        let agents = stmt.query_map([], |row| Ok(row_to_agent(row)))?.collect::<Result<Vec<_>, _>>()?;
        Ok(agents)
    }

    pub fn update_agent_status(&self, id: &str, status: &AgentStatus, finished_at: Option<&str>) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE agents SET status = ?1, finished_at = ?2 WHERE id = ?3",
            params![status.as_str(), finished_at, id],
        )?;
        Ok(())
    }
}

fn row_to_agent(row: &rusqlite::Row) -> Agent {
    Agent {
        id: row.get_unwrap("id"),
        scan_id: row.get_unwrap("scan_id"),
        name: row.get_unwrap("name"),
        parent_id: row.get_unwrap("parent_id"),
        status: AgentStatus::from_str(&row.get_unwrap::<_, String>("status")),
        task: row.get_unwrap("task"),
        created_at: row.get_unwrap("created_at"),
        finished_at: row.get_unwrap("finished_at"),
    }
}
