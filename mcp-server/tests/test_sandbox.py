"""Tests for sandbox management tools."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestSandboxCreate:
    """Tests for sandbox_create tool."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_create_default_sandbox(self, mock_sandbox_id: str) -> None:
        """Test creating a sandbox with default parameters."""
        with patch("strix_sandbox.tools.sandbox.create") as mock_create:
            mock_create.return_value = {
                "sandbox_id": mock_sandbox_id,
                "status": "running",
                "proxy_port": 8080,
                "workspace_path": "/workspace",
            }

            from strix_sandbox.server import sandbox_create

            result = await sandbox_create()

            assert result["status"] == "running"
            assert "sandbox_id" in result
            assert "proxy_port" in result
            mock_create.assert_called_once_with("default", True, True)

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_create_sandbox_without_proxy(self, mock_sandbox_id: str) -> None:
        """Test creating a sandbox without proxy."""
        with patch("strix_sandbox.tools.sandbox.create") as mock_create:
            mock_create.return_value = {
                "sandbox_id": mock_sandbox_id,
                "status": "running",
                "proxy_port": None,
                "workspace_path": "/workspace",
            }

            from strix_sandbox.server import sandbox_create

            result = await sandbox_create(name="test", with_proxy=False)

            mock_create.assert_called_once_with("test", False, True)
            assert result["proxy_port"] is None

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_create_sandbox_custom_name(self) -> None:
        """Test creating a sandbox with custom name."""
        with patch("strix_sandbox.tools.sandbox.create") as mock_create:
            mock_create.return_value = {
                "sandbox_id": "custom-sandbox",
                "status": "running",
            }

            from strix_sandbox.server import sandbox_create

            result = await sandbox_create(name="custom-sandbox")

            mock_create.assert_called_once_with("custom-sandbox", True, True)


class TestSandboxDestroy:
    """Tests for sandbox_destroy tool."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_destroy_sandbox(self, mock_sandbox_id: str) -> None:
        """Test destroying a sandbox."""
        with patch("strix_sandbox.tools.sandbox.destroy") as mock_destroy:
            mock_destroy.return_value = {"success": True, "message": "Sandbox destroyed"}

            from strix_sandbox.server import sandbox_destroy

            result = await sandbox_destroy(mock_sandbox_id)

            assert result["success"] is True
            mock_destroy.assert_called_once_with(mock_sandbox_id)

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_destroy_nonexistent_sandbox(self) -> None:
        """Test destroying a non-existent sandbox."""
        with patch("strix_sandbox.tools.sandbox.destroy") as mock_destroy:
            mock_destroy.return_value = {
                "success": False,
                "error": "Sandbox not found",
            }

            from strix_sandbox.server import sandbox_destroy

            result = await sandbox_destroy("nonexistent")

            assert result["success"] is False
            assert "error" in result


class TestSandboxStatus:
    """Tests for sandbox_status tool."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_get_sandbox_status(self, mock_sandbox_id: str) -> None:
        """Test getting sandbox status."""
        with patch("strix_sandbox.tools.sandbox.status") as mock_status:
            mock_status.return_value = {
                "status": "running",
                "uptime": 3600,
                "cpu_percent": 5.0,
                "memory_mb": 256,
                "active_tools": ["browser", "proxy"],
            }

            from strix_sandbox.server import sandbox_status

            result = await sandbox_status(mock_sandbox_id)

            assert result["status"] == "running"
            assert result["uptime"] == 3600
            assert "cpu_percent" in result
            assert "memory_mb" in result
            mock_status.assert_called_once_with(mock_sandbox_id)

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_get_default_sandbox_status(self) -> None:
        """Test getting status of default sandbox."""
        with patch("strix_sandbox.tools.sandbox.status") as mock_status:
            mock_status.return_value = {"status": "running"}

            from strix_sandbox.server import sandbox_status

            await sandbox_status()

            mock_status.assert_called_once_with("default")

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_sandbox_status_not_running(self) -> None:
        """Test status of a stopped sandbox."""
        with patch("strix_sandbox.tools.sandbox.status") as mock_status:
            mock_status.return_value = {
                "status": "stopped",
                "uptime": 0,
                "cpu_percent": 0,
                "memory_mb": 0,
            }

            from strix_sandbox.server import sandbox_status

            result = await sandbox_status("stopped-sandbox")

            assert result["status"] == "stopped"
            assert result["uptime"] == 0


class TestSandboxLifecycle:
    """Integration-style tests for sandbox lifecycle."""

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_full_sandbox_lifecycle(self, mock_sandbox_id: str) -> None:
        """Test complete sandbox lifecycle: create, status, destroy."""
        with (
            patch("strix_sandbox.tools.sandbox.create") as mock_create,
            patch("strix_sandbox.tools.sandbox.status") as mock_status,
            patch("strix_sandbox.tools.sandbox.destroy") as mock_destroy,
        ):
            mock_create.return_value = {
                "sandbox_id": mock_sandbox_id,
                "status": "running",
            }
            mock_status.return_value = {"status": "running"}
            mock_destroy.return_value = {"success": True}

            from strix_sandbox.server import (
                sandbox_create,
                sandbox_destroy,
                sandbox_status,
            )

            # Create
            create_result = await sandbox_create(name="lifecycle-test")
            assert create_result["status"] == "running"

            # Status
            status_result = await sandbox_status(mock_sandbox_id)
            assert status_result["status"] == "running"

            # Destroy
            destroy_result = await sandbox_destroy(mock_sandbox_id)
            assert destroy_result["success"] is True
