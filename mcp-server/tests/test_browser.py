"""Tests for browser automation tools."""

import base64
from unittest.mock import AsyncMock, patch

import pytest


class TestBrowserLaunch:
    """Tests for browser_launch tool."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_launch_browser(self, mock_sandbox_id: str) -> None:
        """Test launching browser in sandbox."""
        with patch("strix_sandbox.tools.browser.launch") as mock_launch:
            mock_launch.return_value = {
                "browser_id": "browser-001",
                "status": "running",
            }

            from strix_sandbox.server import browser_launch

            result = await browser_launch(mock_sandbox_id)

            assert result["status"] == "running"
            assert "browser_id" in result
            mock_launch.assert_called_once_with(mock_sandbox_id)

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_launch_browser_default_sandbox(self) -> None:
        """Test launching browser in default sandbox."""
        with patch("strix_sandbox.tools.browser.launch") as mock_launch:
            mock_launch.return_value = {"browser_id": "browser-001", "status": "running"}

            from strix_sandbox.server import browser_launch

            await browser_launch()

            mock_launch.assert_called_once_with("default")


class TestBrowserGoto:
    """Tests for browser_goto tool."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_navigate_to_url(self, mock_sandbox_id: str) -> None:
        """Test navigating to a URL."""
        screenshot_data = base64.b64encode(b"fake-image").decode()
        with patch("strix_sandbox.tools.browser.goto") as mock_goto:
            mock_goto.return_value = {
                "current_url": "https://example.com",
                "title": "Example Domain",
                "screenshot": screenshot_data,
            }

            from strix_sandbox.server import browser_goto

            result = await browser_goto(
                url="https://example.com",
                sandbox_id=mock_sandbox_id,
            )

            assert result["current_url"] == "https://example.com"
            assert result["title"] == "Example Domain"
            assert "screenshot" in result
            mock_goto.assert_called_once_with(
                mock_sandbox_id, "https://example.com", "domcontentloaded"
            )

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_navigate_with_networkidle(self) -> None:
        """Test navigating with networkidle wait condition."""
        with patch("strix_sandbox.tools.browser.goto") as mock_goto:
            mock_goto.return_value = {"current_url": "https://example.com"}

            from strix_sandbox.server import browser_goto

            await browser_goto(
                url="https://example.com",
                wait_until="networkidle",
            )

            mock_goto.assert_called_once_with(
                "default", "https://example.com", "networkidle"
            )


class TestBrowserClick:
    """Tests for browser_click tool."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_click_coordinates(self, mock_sandbox_id: str) -> None:
        """Test clicking at specific coordinates."""
        with patch("strix_sandbox.tools.browser.click") as mock_click:
            mock_click.return_value = {"success": True, "screenshot": "base64..."}

            from strix_sandbox.server import browser_click

            result = await browser_click(
                coordinate="100,200",
                sandbox_id=mock_sandbox_id,
            )

            assert result["success"] is True
            mock_click.assert_called_once_with(mock_sandbox_id, "100,200")


class TestBrowserType:
    """Tests for browser_type tool."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_type_text(self, mock_sandbox_id: str) -> None:
        """Test typing text into focused element."""
        with patch("strix_sandbox.tools.browser.type_text") as mock_type:
            mock_type.return_value = {"success": True, "screenshot": "base64..."}

            from strix_sandbox.server import browser_type

            result = await browser_type(
                text="hello world",
                sandbox_id=mock_sandbox_id,
            )

            assert result["success"] is True
            mock_type.assert_called_once_with(mock_sandbox_id, "hello world")


class TestBrowserScroll:
    """Tests for browser_scroll tool."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_scroll_down(self, mock_sandbox_id: str) -> None:
        """Test scrolling down."""
        with patch("strix_sandbox.tools.browser.scroll") as mock_scroll:
            mock_scroll.return_value = {"success": True}

            from strix_sandbox.server import browser_scroll

            result = await browser_scroll(direction="down", sandbox_id=mock_sandbox_id)

            assert result["success"] is True
            mock_scroll.assert_called_once_with(mock_sandbox_id, "down")

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_scroll_up(self, mock_sandbox_id: str) -> None:
        """Test scrolling up."""
        with patch("strix_sandbox.tools.browser.scroll") as mock_scroll:
            mock_scroll.return_value = {"success": True}

            from strix_sandbox.server import browser_scroll

            await browser_scroll(direction="up", sandbox_id=mock_sandbox_id)

            mock_scroll.assert_called_once_with(mock_sandbox_id, "up")


class TestBrowserScreenshot:
    """Tests for browser_screenshot tool."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_take_screenshot(self, mock_sandbox_id: str) -> None:
        """Test taking a screenshot."""
        screenshot_data = base64.b64encode(b"png-data").decode()
        with patch("strix_sandbox.tools.browser.screenshot") as mock_screenshot:
            mock_screenshot.return_value = {
                "screenshot": screenshot_data,
                "url": "https://example.com",
                "title": "Example",
            }

            from strix_sandbox.server import browser_screenshot

            result = await browser_screenshot(sandbox_id=mock_sandbox_id)

            assert "screenshot" in result
            assert result["url"] == "https://example.com"
            mock_screenshot.assert_called_once_with(mock_sandbox_id)


class TestBrowserExecuteJs:
    """Tests for browser_execute_js tool."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_execute_javascript(self, mock_sandbox_id: str) -> None:
        """Test executing JavaScript in browser."""
        with patch("strix_sandbox.tools.browser.execute_js") as mock_exec:
            mock_exec.return_value = {
                "result": "document-title",
                "console_output": [],
                "screenshot": "base64...",
            }

            from strix_sandbox.server import browser_execute_js

            result = await browser_execute_js(
                code="document.title",
                sandbox_id=mock_sandbox_id,
            )

            assert result["result"] == "document-title"
            mock_exec.assert_called_once_with(mock_sandbox_id, "document.title")


class TestBrowserTabs:
    """Tests for browser tab management tools."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_new_tab(self, mock_sandbox_id: str) -> None:
        """Test opening new tab."""
        with patch("strix_sandbox.tools.browser.new_tab") as mock_new_tab:
            mock_new_tab.return_value = {
                "tab_id": "tab-001",
                "url": "https://example.com",
            }

            from strix_sandbox.server import browser_new_tab

            result = await browser_new_tab(
                url="https://example.com",
                sandbox_id=mock_sandbox_id,
            )

            assert result["tab_id"] == "tab-001"
            mock_new_tab.assert_called_once_with(mock_sandbox_id, "https://example.com")

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_switch_tab(self, mock_sandbox_id: str) -> None:
        """Test switching tabs."""
        with patch("strix_sandbox.tools.browser.switch_tab") as mock_switch:
            mock_switch.return_value = {
                "success": True,
                "current_tab_id": "tab-002",
            }

            from strix_sandbox.server import browser_switch_tab

            result = await browser_switch_tab(
                tab_id="tab-002",
                sandbox_id=mock_sandbox_id,
            )

            assert result["success"] is True
            assert result["current_tab_id"] == "tab-002"

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_close_tab(self, mock_sandbox_id: str) -> None:
        """Test closing tab."""
        with patch("strix_sandbox.tools.browser.close_tab") as mock_close:
            mock_close.return_value = {
                "success": True,
                "remaining_tabs": ["tab-001"],
            }

            from strix_sandbox.server import browser_close_tab

            result = await browser_close_tab(
                tab_id="tab-002",
                sandbox_id=mock_sandbox_id,
            )

            assert result["success"] is True
            assert "remaining_tabs" in result


class TestBrowserGetSource:
    """Tests for browser_get_source tool."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_get_page_source(self, mock_sandbox_id: str) -> None:
        """Test getting page HTML source."""
        with patch("strix_sandbox.tools.browser.get_source") as mock_source:
            mock_source.return_value = {
                "html": "<html><body>Test</body></html>",
                "url": "https://example.com",
                "title": "Test Page",
            }

            from strix_sandbox.server import browser_get_source

            result = await browser_get_source(sandbox_id=mock_sandbox_id)

            assert "html" in result
            assert "<html>" in result["html"]


class TestBrowserClose:
    """Tests for browser_close tool."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_close_browser(self, mock_sandbox_id: str) -> None:
        """Test closing browser."""
        with patch("strix_sandbox.tools.browser.close") as mock_close:
            mock_close.return_value = {"success": True}

            from strix_sandbox.server import browser_close

            result = await browser_close(sandbox_id=mock_sandbox_id)

            assert result["success"] is True
            mock_close.assert_called_once_with(mock_sandbox_id)
