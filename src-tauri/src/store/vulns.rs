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
        let vulns = stmt.query_map(params![scan_id], |row| Ok(row_to_vulnerability(row)))?.collect::<Result<Vec<_>, _>>()?;
        Ok(vulns)
    }
}

fn row_to_vulnerability(row: &rusqlite::Row) -> Vulnerability {
    let refs_json: Option<String> = row.get_unwrap("references_json");
    Vulnerability {
        id: row.get_unwrap("id"),
        scan_id: row.get_unwrap("scan_id"),
        agent_id: row.get_unwrap("agent_id"),
        title: row.get_unwrap("title"),
        severity: Severity::from_str(&row.get_unwrap::<_, String>("severity")),
        description: row.get_unwrap("description"),
        affected_url: row.get_unwrap("affected_url"),
        proof_of_concept: row.get_unwrap("proof_of_concept"),
        impact: row.get_unwrap("impact"),
        remediation: row.get_unwrap("remediation"),
        cvss: row.get_unwrap("cvss"),
        references: refs_json.and_then(|s| serde_json::from_str(&s).ok()),
        discovered_at: row.get_unwrap("discovered_at"),
    }
}
