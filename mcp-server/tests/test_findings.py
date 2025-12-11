"""Tests for security findings tracking tools."""

from unittest.mock import patch

import pytest


class TestFindingCreate:
    """Tests for finding_create tool."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_create_finding(
        self, mock_sandbox_id: str, sample_finding: dict
    ) -> None:
        """Test creating a security finding."""
        with patch("strix_sandbox.tools.findings.create") as mock_create:
            mock_create.return_value = {
                "finding_id": "finding-001",
                "created_at": "2025-01-01T12:00:00Z",
            }

            from strix_sandbox.server import finding_create

            result = await finding_create(
                title=sample_finding["title"],
                severity=sample_finding["severity"],
                description=sample_finding["description"],
                evidence=sample_finding["evidence"],
                remediation=sample_finding["remediation"],
                sandbox_id=mock_sandbox_id,
            )

            assert "finding_id" in result
            assert "created_at" in result
            mock_create.assert_called_once_with(
                mock_sandbox_id,
                sample_finding["title"],
                sample_finding["severity"],
                sample_finding["description"],
                sample_finding["evidence"],
                sample_finding["remediation"],
            )

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_create_finding_minimal(self, mock_sandbox_id: str) -> None:
        """Test creating finding with minimal fields."""
        with patch("strix_sandbox.tools.findings.create") as mock_create:
            mock_create.return_value = {
                "finding_id": "finding-002",
                "created_at": "2025-01-01T12:00:00Z",
            }

            from strix_sandbox.server import finding_create

            await finding_create(
                title="XSS Vulnerability",
                severity="medium",
                description="Reflected XSS in search parameter",
                sandbox_id=mock_sandbox_id,
            )

            mock_create.assert_called_once_with(
                mock_sandbox_id,
                "XSS Vulnerability",
                "medium",
                "Reflected XSS in search parameter",
                "",
                "",
            )

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_create_critical_finding(self, mock_sandbox_id: str) -> None:
        """Test creating a critical severity finding."""
        with patch("strix_sandbox.tools.findings.create") as mock_create:
            mock_create.return_value = {"finding_id": "finding-003"}

            from strix_sandbox.server import finding_create

            await finding_create(
                title="Remote Code Execution",
                severity="critical",
                description="Unauthenticated RCE via deserialization",
                evidence="curl -X POST -d 'payload' http://target/api",
                sandbox_id=mock_sandbox_id,
            )

            call_args = mock_create.call_args
            assert call_args[0][2] == "critical"  # severity arg


class TestFindingList:
    """Tests for finding_list tool."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_list_all_findings(self, mock_sandbox_id: str) -> None:
        """Test listing all findings."""
        with patch("strix_sandbox.tools.findings.list_findings") as mock_list:
            mock_list.return_value = {
                "findings": [
                    {"id": "finding-001", "title": "SQL Injection", "severity": "high"},
                    {"id": "finding-002", "title": "XSS", "severity": "medium"},
                ],
                "total_count": 2,
            }

            from strix_sandbox.server import finding_list

            result = await finding_list(sandbox_id=mock_sandbox_id)

            assert result["total_count"] == 2
            assert len(result["findings"]) == 2
            mock_list.assert_called_once_with(mock_sandbox_id, None, None)

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_list_findings_by_severity(self, mock_sandbox_id: str) -> None:
        """Test filtering findings by severity."""
        with patch("strix_sandbox.tools.findings.list_findings") as mock_list:
            mock_list.return_value = {
                "findings": [
                    {"id": "finding-001", "title": "SQL Injection", "severity": "high"},
                ],
                "total_count": 1,
            }

            from strix_sandbox.server import finding_list

            result = await finding_list(severity="high", sandbox_id=mock_sandbox_id)

            assert result["total_count"] == 1
            mock_list.assert_called_once_with(mock_sandbox_id, "high", None)

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_list_findings_with_search(self, mock_sandbox_id: str) -> None:
        """Test searching findings."""
        with patch("strix_sandbox.tools.findings.list_findings") as mock_list:
            mock_list.return_value = {"findings": [], "total_count": 0}

            from strix_sandbox.server import finding_list

            await finding_list(search="injection", sandbox_id=mock_sandbox_id)

            mock_list.assert_called_once_with(mock_sandbox_id, None, "injection")


class TestFindingUpdate:
    """Tests for finding_update tool."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_update_finding(self, mock_sandbox_id: str) -> None:
        """Test updating a finding."""
        with patch("strix_sandbox.tools.findings.update") as mock_update:
            mock_update.return_value = {
                "success": True,
                "updated_at": "2025-01-01T13:00:00Z",
            }

            from strix_sandbox.server import finding_update

            result = await finding_update(
                finding_id="finding-001",
                severity="critical",
                description="Updated description with more details",
                sandbox_id=mock_sandbox_id,
            )

            assert result["success"] is True
            mock_update.assert_called_once_with(
                mock_sandbox_id,
                "finding-001",
                None,  # title
                "critical",  # severity
                "Updated description with more details",  # description
                None,  # evidence
                None,  # remediation
            )

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_update_finding_title(self, mock_sandbox_id: str) -> None:
        """Test updating only finding title."""
        with patch("strix_sandbox.tools.findings.update") as mock_update:
            mock_update.return_value = {"success": True}

            from strix_sandbox.server import finding_update

            await finding_update(
                finding_id="finding-001",
                title="Updated SQL Injection Finding",
                sandbox_id=mock_sandbox_id,
            )

            mock_update.assert_called_once()
            call_args = mock_update.call_args[0]
            assert call_args[2] == "Updated SQL Injection Finding"


class TestFindingDelete:
    """Tests for finding_delete tool."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_delete_finding(self, mock_sandbox_id: str) -> None:
        """Test deleting a finding."""
        with patch("strix_sandbox.tools.findings.delete") as mock_delete:
            mock_delete.return_value = {"success": True}

            from strix_sandbox.server import finding_delete

            result = await finding_delete(
                finding_id="finding-001",
                sandbox_id=mock_sandbox_id,
            )

            assert result["success"] is True
            mock_delete.assert_called_once_with(mock_sandbox_id, "finding-001")

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_delete_nonexistent_finding(self, mock_sandbox_id: str) -> None:
        """Test deleting non-existent finding."""
        with patch("strix_sandbox.tools.findings.delete") as mock_delete:
            mock_delete.return_value = {
                "success": False,
                "error": "Finding not found",
            }

            from strix_sandbox.server import finding_delete

            result = await finding_delete(
                finding_id="nonexistent",
                sandbox_id=mock_sandbox_id,
            )

            assert result["success"] is False


class TestFindingExport:
    """Tests for finding_export tool."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_export_markdown(self, mock_sandbox_id: str) -> None:
        """Test exporting findings as markdown."""
        with patch("strix_sandbox.tools.findings.export") as mock_export:
            mock_export.return_value = {
                "report_content": "# Security Report\n\n## Findings\n...",
                "filename": "security_report.md",
                "finding_count": 5,
            }

            from strix_sandbox.server import finding_export

            result = await finding_export(format="markdown", sandbox_id=mock_sandbox_id)

            assert result["finding_count"] == 5
            assert result["filename"].endswith(".md")
            mock_export.assert_called_once_with(mock_sandbox_id, "markdown")

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_export_json(self, mock_sandbox_id: str) -> None:
        """Test exporting findings as JSON."""
        with patch("strix_sandbox.tools.findings.export") as mock_export:
            mock_export.return_value = {
                "report_content": '{"findings": [...]}',
                "filename": "security_report.json",
                "finding_count": 3,
            }

            from strix_sandbox.server import finding_export

            result = await finding_export(format="json", sandbox_id=mock_sandbox_id)

            assert result["filename"].endswith(".json")
            mock_export.assert_called_once_with(mock_sandbox_id, "json")

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_export_html(self, mock_sandbox_id: str) -> None:
        """Test exporting findings as HTML."""
        with patch("strix_sandbox.tools.findings.export") as mock_export:
            mock_export.return_value = {
                "report_content": "<html>...</html>",
                "filename": "security_report.html",
                "finding_count": 2,
            }

            from strix_sandbox.server import finding_export

            result = await finding_export(format="html", sandbox_id=mock_sandbox_id)

            assert result["filename"].endswith(".html")
            mock_export.assert_called_once_with(mock_sandbox_id, "html")

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_export_default_format(self, mock_sandbox_id: str) -> None:
        """Test export uses markdown as default format."""
        with patch("strix_sandbox.tools.findings.export") as mock_export:
            mock_export.return_value = {
                "report_content": "# Report",
                "filename": "report.md",
                "finding_count": 1,
            }

            from strix_sandbox.server import finding_export

            await finding_export(sandbox_id=mock_sandbox_id)

            mock_export.assert_called_once_with(mock_sandbox_id, "markdown")


class TestFindingsWorkflow:
    """Integration-style tests for findings workflow."""

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_complete_findings_workflow(
        self, mock_sandbox_id: str, sample_finding: dict
    ) -> None:
        """Test complete workflow: create, list, update, export, delete."""
        with (
            patch("strix_sandbox.tools.findings.create") as mock_create,
            patch("strix_sandbox.tools.findings.list_findings") as mock_list,
            patch("strix_sandbox.tools.findings.update") as mock_update,
            patch("strix_sandbox.tools.findings.export") as mock_export,
            patch("strix_sandbox.tools.findings.delete") as mock_delete,
        ):
            mock_create.return_value = {"finding_id": "finding-001"}
            mock_list.return_value = {"findings": [{"id": "finding-001"}], "total_count": 1}
            mock_update.return_value = {"success": True}
            mock_export.return_value = {"report_content": "...", "finding_count": 1}
            mock_delete.return_value = {"success": True}

            from strix_sandbox.server import (
                finding_create,
                finding_delete,
                finding_export,
                finding_list,
                finding_update,
            )

            # Create
            create_result = await finding_create(
                title=sample_finding["title"],
                severity=sample_finding["severity"],
                description=sample_finding["description"],
                sandbox_id=mock_sandbox_id,
            )
            finding_id = create_result["finding_id"]

            # List
            list_result = await finding_list(sandbox_id=mock_sandbox_id)
            assert list_result["total_count"] == 1

            # Update
            update_result = await finding_update(
                finding_id=finding_id,
                severity="critical",
                sandbox_id=mock_sandbox_id,
            )
            assert update_result["success"] is True

            # Export
            export_result = await finding_export(sandbox_id=mock_sandbox_id)
            assert export_result["finding_count"] == 1

            # Delete
            delete_result = await finding_delete(
                finding_id=finding_id,
                sandbox_id=mock_sandbox_id,
            )
            assert delete_result["success"] is True
