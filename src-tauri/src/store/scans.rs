use rusqlite::{params, OptionalExtension};

use super::AppDb;
use crate::models::{Scan, ScanStatus, TargetType};

impl AppDb {
    pub fn save_scan(&self, scan: &Scan) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO scans (id, target, target_type, status, mode, created_at, started_at, completed_at, findings, claude_session_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                scan.id,
                scan.target,
                scan.target_type.as_str(),
                scan.status.as_str(),
                scan.mode,
                scan.created_at,
                scan.started_at,
                scan.completed_at,
                scan.findings,
                scan.claude_session_id,
            ],
        )?;
        Ok(())
    }

    pub fn get_scan(&self, id: &str) -> anyhow::Result<Option<Scan>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT * FROM scans WHERE id = ?1")?;
        let result = stmt.query_row(params![id], row_to_scan).optional()?;
        Ok(result)
    }

    pub fn get_all_scans(&self) -> anyhow::Result<Vec<Scan>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT * FROM scans ORDER BY created_at DESC")?;
        let scans = stmt.query_map([], row_to_scan)?.collect::<Result<Vec<_>, _>>()?;
        Ok(scans)
    }

    pub fn update_scan_status(&self, id: &str, status: &ScanStatus, completed_at: Option<&str>) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE scans SET status = ?1, completed_at = ?2 WHERE id = ?3",
            params![status.as_str(), completed_at, id],
        )?;
        Ok(())
    }

    pub fn update_scan_findings(&self, id: &str, count: i64) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE scans SET findings = ?1 WHERE id = ?2",
            params![count, id],
        )?;
        Ok(())
    }

    pub fn update_scan_claude_session_id(&self, id: &str, claude_session_id: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE scans SET claude_session_id = ?1 WHERE id = ?2",
            params![claude_session_id, id],
        )?;
        Ok(())
    }
}

fn row_to_scan(row: &rusqlite::Row) -> rusqlite::Result<Scan> {
    Ok(Scan {
        id: row.get("id")?,
        target: row.get("target")?,
        target_type: TargetType::from_str(&row.get::<_, String>("target_type")?),
        status: ScanStatus::from_str(&row.get::<_, String>("status")?),
        mode: row.get("mode")?,
        created_at: row.get("created_at")?,
        started_at: row.get("started_at")?,
        completed_at: row.get("completed_at")?,
        findings: row.get("findings")?,
        claude_session_id: row.get("claude_session_id")?,
    })
}
