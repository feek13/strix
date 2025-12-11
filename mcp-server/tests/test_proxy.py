"""Tests for HTTP proxy tools."""

from unittest.mock import patch

import pytest


class TestProxyStart:
    """Tests for proxy_start tool."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_start_proxy(self, mock_sandbox_id: str) -> None:
        """Test starting proxy."""
        with patch("strix_sandbox.tools.proxy.start") as mock_start:
            mock_start.return_value = {
                "proxy_port": 8080,
                "status": "running",
            }

            from strix_sandbox.server import proxy_start

            result = await proxy_start(sandbox_id=mock_sandbox_id)

            assert result["status"] == "running"
            assert result["proxy_port"] == 8080
            mock_start.assert_called_once_with(mock_sandbox_id)

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_start_proxy_default_sandbox(self) -> None:
        """Test starting proxy in default sandbox."""
        with patch("strix_sandbox.tools.proxy.start") as mock_start:
            mock_start.return_value = {"proxy_port": 8080, "status": "running"}

            from strix_sandbox.server import proxy_start

            await proxy_start()

            mock_start.assert_called_once_with("default")


class TestProxyListRequests:
    """Tests for proxy_list_requests tool."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_list_requests(
        self, mock_sandbox_id: str, mock_proxy_requests: list[dict]
    ) -> None:
        """Test listing captured requests."""
        with patch("strix_sandbox.tools.proxy.list_requests") as mock_list:
            mock_list.return_value = {
                "requests": mock_proxy_requests,
                "total_count": len(mock_proxy_requests),
            }

            from strix_sandbox.server import proxy_list_requests

            result = await proxy_list_requests(sandbox_id=mock_sandbox_id)

            assert result["total_count"] == 3
            assert len(result["requests"]) == 3
            mock_list.assert_called_once_with(mock_sandbox_id, None, 50, "timestamp", "desc")

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_list_requests_with_filter(self, mock_sandbox_id: str) -> None:
        """Test listing requests with filter."""
        with patch("strix_sandbox.tools.proxy.list_requests") as mock_list:
            mock_list.return_value = {"requests": [], "total_count": 0}

            from strix_sandbox.server import proxy_list_requests

            await proxy_list_requests(
                filter="method = POST",
                limit=10,
                sandbox_id=mock_sandbox_id,
            )

            mock_list.assert_called_once_with(
                mock_sandbox_id, "method = POST", 10, "timestamp", "desc"
            )

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_list_requests_sorted(self, mock_sandbox_id: str) -> None:
        """Test listing requests with custom sort."""
        with patch("strix_sandbox.tools.proxy.list_requests") as mock_list:
            mock_list.return_value = {"requests": [], "total_count": 0}

            from strix_sandbox.server import proxy_list_requests

            await proxy_list_requests(
                sort_by="status_code",
                sort_order="asc",
                sandbox_id=mock_sandbox_id,
            )

            mock_list.assert_called_once_with(
                mock_sandbox_id, None, 50, "status_code", "asc"
            )


class TestProxyViewRequest:
    """Tests for proxy_view_request tool."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_view_request(
        self, mock_sandbox_id: str, sample_http_request: dict
    ) -> None:
        """Test viewing request details."""
        with patch("strix_sandbox.tools.proxy.view_request") as mock_view:
            mock_view.return_value = {
                "headers": sample_http_request["headers"],
                "body": sample_http_request["body"],
                "metadata": {"method": "POST", "url": sample_http_request["url"]},
            }

            from strix_sandbox.server import proxy_view_request

            result = await proxy_view_request(
                request_id="req-001",
                part="request",
                sandbox_id=mock_sandbox_id,
            )

            assert "headers" in result
            assert "body" in result
            mock_view.assert_called_once_with(mock_sandbox_id, "req-001", "request")

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_view_response(
        self, mock_sandbox_id: str, sample_http_response: dict
    ) -> None:
        """Test viewing response details."""
        with patch("strix_sandbox.tools.proxy.view_request") as mock_view:
            mock_view.return_value = {
                "headers": sample_http_response["headers"],
                "body": sample_http_response["body"],
                "metadata": {"status_code": 200},
            }

            from strix_sandbox.server import proxy_view_request

            result = await proxy_view_request(
                request_id="req-001",
                part="response",
                sandbox_id=mock_sandbox_id,
            )

            assert result["metadata"]["status_code"] == 200


class TestProxySendRequest:
    """Tests for proxy_send_request tool."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_send_get_request(
        self, mock_sandbox_id: str, sample_http_response: dict
    ) -> None:
        """Test sending GET request."""
        with patch("strix_sandbox.tools.proxy.send_request") as mock_send:
            mock_send.return_value = sample_http_response

            from strix_sandbox.server import proxy_send_request

            result = await proxy_send_request(
                method="GET",
                url="https://example.com/api",
                sandbox_id=mock_sandbox_id,
            )

            assert result["status_code"] == 200
            mock_send.assert_called_once_with(
                mock_sandbox_id, "GET", "https://example.com/api", None, "", 30
            )

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_send_post_request(self, mock_sandbox_id: str) -> None:
        """Test sending POST request with body."""
        with patch("strix_sandbox.tools.proxy.send_request") as mock_send:
            mock_send.return_value = {"status_code": 201}

            from strix_sandbox.server import proxy_send_request

            await proxy_send_request(
                method="POST",
                url="https://example.com/api",
                headers={"Content-Type": "application/json"},
                body='{"key": "value"}',
                sandbox_id=mock_sandbox_id,
            )

            mock_send.assert_called_once_with(
                mock_sandbox_id,
                "POST",
                "https://example.com/api",
                {"Content-Type": "application/json"},
                '{"key": "value"}',
                30,
            )


class TestProxyRepeatRequest:
    """Tests for proxy_repeat_request tool."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_repeat_request(self, mock_sandbox_id: str) -> None:
        """Test repeating a captured request."""
        with patch("strix_sandbox.tools.proxy.repeat_request") as mock_repeat:
            mock_repeat.return_value = {"status_code": 200}

            from strix_sandbox.server import proxy_repeat_request

            result = await proxy_repeat_request(
                request_id="req-001",
                sandbox_id=mock_sandbox_id,
            )

            assert result["status_code"] == 200
            mock_repeat.assert_called_once_with(mock_sandbox_id, "req-001", None)

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_repeat_request_with_modifications(self, mock_sandbox_id: str) -> None:
        """Test repeating request with modifications."""
        with patch("strix_sandbox.tools.proxy.repeat_request") as mock_repeat:
            mock_repeat.return_value = {"status_code": 200}

            from strix_sandbox.server import proxy_repeat_request

            modifications = {"headers": {"X-Custom": "value"}}
            await proxy_repeat_request(
                request_id="req-001",
                modifications=modifications,
                sandbox_id=mock_sandbox_id,
            )

            mock_repeat.assert_called_once_with(mock_sandbox_id, "req-001", modifications)


class TestProxySetScope:
    """Tests for proxy_set_scope tool."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_set_scope_allowlist(self, mock_sandbox_id: str) -> None:
        """Test setting proxy scope with allowlist."""
        with patch("strix_sandbox.tools.proxy.set_scope") as mock_scope:
            mock_scope.return_value = {
                "scope_config": {
                    "allowlist": ["*.example.com"],
                    "denylist": [],
                }
            }

            from strix_sandbox.server import proxy_set_scope

            result = await proxy_set_scope(
                allowlist=["*.example.com"],
                sandbox_id=mock_sandbox_id,
            )

            assert "scope_config" in result
            mock_scope.assert_called_once_with(
                mock_sandbox_id, ["*.example.com"], None
            )

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_set_scope_denylist(self, mock_sandbox_id: str) -> None:
        """Test setting proxy scope with denylist."""
        with patch("strix_sandbox.tools.proxy.set_scope") as mock_scope:
            mock_scope.return_value = {"scope_config": {}}

            from strix_sandbox.server import proxy_set_scope

            await proxy_set_scope(
                denylist=["*.google.com", "*.facebook.com"],
                sandbox_id=mock_sandbox_id,
            )

            mock_scope.assert_called_once_with(
                mock_sandbox_id, None, ["*.google.com", "*.facebook.com"]
            )


class TestProxyGetSitemap:
    """Tests for proxy_get_sitemap tool."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_get_sitemap(self, mock_sandbox_id: str) -> None:
        """Test getting discovered sitemap."""
        with patch("strix_sandbox.tools.proxy.get_sitemap") as mock_sitemap:
            mock_sitemap.return_value = {
                "sitemap": {
                    "example.com": {
                        "/": ["GET"],
                        "/api/users": ["GET", "POST"],
                        "/api/data": ["GET", "PUT", "DELETE"],
                    }
                }
            }

            from strix_sandbox.server import proxy_get_sitemap

            result = await proxy_get_sitemap(sandbox_id=mock_sandbox_id)

            assert "sitemap" in result
            assert "example.com" in result["sitemap"]
            mock_sitemap.assert_called_once_with(mock_sandbox_id)
