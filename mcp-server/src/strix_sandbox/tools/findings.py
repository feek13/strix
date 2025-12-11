"""Security findings tracking with SQLite persistence."""

import aiosqlite
from datetime import datetime
from pathlib import Path
from typing import Any
import uuid
import json


# Database path - can be overridden for testing
DB_PATH = Path.home() / ".strix" / "findings.db"


async def _get_db() -> aiosqlite.Connection:
    """Get database connection, creating tables if needed."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = await aiosqlite.connect(str(DB_PATH))
    await db.execute("""
        CREATE TABLE IF NOT EXISTS findings (
            id TEXT PRIMARY KEY,
            sandbox_id TEXT NOT NULL,
            title TEXT NOT NULL,
            severity TEXT NOT NULL,
            description TEXT NOT NULL,
            evidence TEXT,
            remediation TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    await db.commit()
    return db


async def create(
    sandbox_id: str,
    title: str,
    severity: str,
    description: str,
    evidence: str = "",
    remediation: str = "",
) -> dict[str, Any]:
    """Record a security finding."""
    # Validate severity
    valid_severities = ["critical", "high", "medium", "low", "info"]
    if severity.lower() not in valid_severities:
        return {"success": False, "error": f"Invalid severity. Must be one of: {valid_severities}"}

    finding_id = str(uuid.uuid4())[:8]
    now = datetime.utcnow().isoformat()

    try:
        db = await _get_db()
        await db.execute(
            """
            INSERT INTO findings (id, sandbox_id, title, severity, description, evidence, remediation, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (finding_id, sandbox_id, title, severity.lower(), description, evidence, remediation, now, now),
        )
        await db.commit()
        await db.close()

        return {
            "success": True,
            "finding_id": finding_id,
            "created_at": now,
        }
    except Exception as e:
        return {"success": False, "error": f"Failed to create finding: {e}"}


async def list_findings(
    sandbox_id: str,
    severity: str | None = None,
    search: str | None = None,
) -> dict[str, Any]:
    """List recorded findings."""
    try:
        db = await _get_db()

        query = "SELECT * FROM findings WHERE sandbox_id = ?"
        params: list[Any] = [sandbox_id]

        if severity:
            query += " AND severity = ?"
            params.append(severity.lower())

        if search:
            query += " AND (title LIKE ? OR description LIKE ?)"
            search_pattern = f"%{search}%"
            params.extend([search_pattern, search_pattern])

        query += " ORDER BY created_at DESC"

        async with db.execute(query, params) as cursor:
            rows = await cursor.fetchall()

        await db.close()

        findings = []
        for row in rows:
            findings.append({
                "id": row[0],
                "sandbox_id": row[1],
                "title": row[2],
                "severity": row[3],
                "description": row[4],
                "evidence": row[5],
                "remediation": row[6],
                "created_at": row[7],
                "updated_at": row[8],
            })

        return {
            "success": True,
            "findings": findings,
            "total_count": len(findings),
        }
    except Exception as e:
        return {"success": False, "error": f"Failed to list findings: {e}"}


async def update(
    sandbox_id: str,
    finding_id: str,
    title: str | None = None,
    severity: str | None = None,
    description: str | None = None,
    evidence: str | None = None,
    remediation: str | None = None,
) -> dict[str, Any]:
    """Update an existing finding."""
    try:
        db = await _get_db()

        # Build update query dynamically
        updates = []
        params: list[Any] = []

        if title is not None:
            updates.append("title = ?")
            params.append(title)
        if severity is not None:
            updates.append("severity = ?")
            params.append(severity.lower())
        if description is not None:
            updates.append("description = ?")
            params.append(description)
        if evidence is not None:
            updates.append("evidence = ?")
            params.append(evidence)
        if remediation is not None:
            updates.append("remediation = ?")
            params.append(remediation)

        if not updates:
            return {"success": False, "error": "No fields to update"}

        updates.append("updated_at = ?")
        now = datetime.utcnow().isoformat()
        params.append(now)

        params.extend([finding_id, sandbox_id])

        query = f"UPDATE findings SET {', '.join(updates)} WHERE id = ? AND sandbox_id = ?"
        result = await db.execute(query, params)
        await db.commit()
        await db.close()

        if result.rowcount == 0:
            return {"success": False, "error": "Finding not found"}

        return {"success": True, "updated_at": now}
    except Exception as e:
        return {"success": False, "error": f"Failed to update finding: {e}"}


async def delete(sandbox_id: str, finding_id: str) -> dict[str, Any]:
    """Delete a finding."""
    try:
        db = await _get_db()
        result = await db.execute(
            "DELETE FROM findings WHERE id = ? AND sandbox_id = ?",
            (finding_id, sandbox_id),
        )
        await db.commit()
        await db.close()

        if result.rowcount == 0:
            return {"success": False, "error": "Finding not found"}

        return {"success": True}
    except Exception as e:
        return {"success": False, "error": f"Failed to delete finding: {e}"}


async def export(sandbox_id: str, format: str = "markdown") -> dict[str, Any]:
    """Export all findings as a report."""
    try:
        result = await list_findings(sandbox_id)
        if not result["success"]:
            return result

        findings = result["findings"]

        if format == "json":
            content = json.dumps(findings, indent=2)
            filename = f"findings_{sandbox_id}.json"
        elif format == "html":
            content = _generate_html_report(findings, sandbox_id)
            filename = f"findings_{sandbox_id}.html"
        else:  # markdown
            content = _generate_markdown_report(findings, sandbox_id)
            filename = f"findings_{sandbox_id}.md"

        return {
            "success": True,
            "report_content": content,
            "filename": filename,
            "finding_count": len(findings),
        }
    except Exception as e:
        return {"success": False, "error": f"Failed to export findings: {e}"}


def _generate_markdown_report(findings: list[dict], sandbox_id: str) -> str:
    """Generate a Markdown report."""
    lines = [
        f"# Security Assessment Report",
        f"",
        f"**Sandbox:** {sandbox_id}",
        f"**Generated:** {datetime.utcnow().isoformat()}",
        f"",
        f"## Summary",
        f"",
    ]

    # Count by severity
    severity_counts = {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}
    for f in findings:
        severity_counts[f["severity"]] = severity_counts.get(f["severity"], 0) + 1

    lines.append("| Severity | Count |")
    lines.append("|----------|-------|")
    for sev, count in severity_counts.items():
        lines.append(f"| {sev.capitalize()} | {count} |")

    lines.extend(["", "## Findings", ""])

    for f in findings:
        lines.extend([
            f"### [{f['severity'].upper()}] {f['title']}",
            f"",
            f"**ID:** {f['id']}",
            f"",
            f"**Description:**",
            f"{f['description']}",
            f"",
        ])
        if f["evidence"]:
            lines.extend([
                f"**Evidence:**",
                f"```",
                f"{f['evidence']}",
                f"```",
                f"",
            ])
        if f["remediation"]:
            lines.extend([
                f"**Remediation:**",
                f"{f['remediation']}",
                f"",
            ])
        lines.append("---")
        lines.append("")

    return "\n".join(lines)


def _generate_html_report(findings: list[dict], sandbox_id: str) -> str:
    """Generate an HTML report."""
    severity_colors = {
        "critical": "#dc3545",
        "high": "#fd7e14",
        "medium": "#ffc107",
        "low": "#17a2b8",
        "info": "#6c757d",
    }

    findings_html = ""
    for f in findings:
        color = severity_colors.get(f["severity"], "#6c757d")
        evidence_html = f"<h4>Evidence</h4><pre>{f['evidence']}</pre>" if f["evidence"] else ""
        remediation_html = f"<h4>Remediation</h4><p>{f['remediation']}</p>" if f["remediation"] else ""

        findings_html += f"""
        <div class="finding">
            <h3><span class="severity" style="background-color: {color}">{f['severity'].upper()}</span> {f['title']}</h3>
            <p><small>ID: {f['id']}</small></p>
            <h4>Description</h4>
            <p>{f['description']}</p>
            {evidence_html}
            {remediation_html}
        </div>
        """

    return f"""<!DOCTYPE html>
<html>
<head>
    <title>Security Assessment Report - {sandbox_id}</title>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; }}
        .severity {{ color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px; }}
        .finding {{ border: 1px solid #ddd; border-radius: 8px; padding: 16px; margin: 16px 0; }}
        pre {{ background: #f5f5f5; padding: 12px; border-radius: 4px; overflow-x: auto; }}
        h1 {{ border-bottom: 2px solid #333; padding-bottom: 10px; }}
    </style>
</head>
<body>
    <h1>Security Assessment Report</h1>
    <p><strong>Sandbox:</strong> {sandbox_id}</p>
    <p><strong>Generated:</strong> {datetime.utcnow().isoformat()}</p>
    <h2>Findings ({len(findings)} total)</h2>
    {findings_html}
</body>
</html>"""
