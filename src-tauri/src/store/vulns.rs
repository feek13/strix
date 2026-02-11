use rusqlite::params;

use super::AppDb;
use crate::models::{Severity, Vulnerability};

impl AppDb {
    pub fn save_vulnerability(&self, v: &Vulnerability) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO vulnerabilities (id, scan_id, agent_id, title, severity, description, affected_url, proof_of_concept, impact, remediation, cvss, references_json, discovered_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                v.id,
                v.scan_id,
                v.agent_id,
                v.title,
                v.severity.as_str(),
                v.description,
                v.affected_url,
                v.proof_of_concept,
                v.impact,
                v.remediation,
                v.cvss,
                v.references.as_ref().map(|r| serde_json::to_string(r).unwrap_or_default()),
                v.discovered_at,
            ],
        )?;
        Ok(())
    }

    pub fn get_vulns_by_scan(&self, scan_id: &str) -> anyhow::Result<Vec<Vulnerability>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT * FROM vulnerabilities WHERE scan_id = ?1 ORDER BY discovered_at")?;
        let vulns = stmt.query_map(params![scan_id], row_to_vulnerability)?.collect::<Result<Vec<_>, _>>()?;
        Ok(vulns)
    }
}

fn row_to_vulnerability(row: &rusqlite::Row) -> rusqlite::Result<Vulnerability> {
    let refs_json: Option<String> = row.get("references_json")?;
    Ok(Vulnerability {
        id: row.get("id")?,
        scan_id: row.get("scan_id")?,
        agent_id: row.get("agent_id")?,
        title: row.get("title")?,
        severity: Severity::from_str(&row.get::<_, String>("severity")?),
        description: row.get("description")?,
        affected_url: row.get("affected_url")?,
        proof_of_concept: row.get("proof_of_concept")?,
        impact: row.get("impact")?,
        remediation: row.get("remediation")?,
        cvss: row.get("cvss")?,
        references: refs_json.and_then(|s| serde_json::from_str(&s).ok()),
        discovered_at: row.get("discovered_at")?,
    })
}
