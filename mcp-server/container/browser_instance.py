"""Browser automation using Playwright - Container implementation."""

import asyncio
import base64
import logging
from typing import Any

from playwright.async_api import Browser, BrowserContext, Page, Playwright, async_playwright


logger = logging.getLogger(__name__)

MAX_PAGE_SOURCE_LENGTH = 20_000
MAX_CONSOLE_LOG_LENGTH = 30_000
MAX_INDIVIDUAL_LOG_LENGTH = 1_000
MAX_CONSOLE_LOGS_COUNT = 200
MAX_JS_RESULT_LENGTH = 5_000


class BrowserInstance:
    """Manages a Playwright browser instance with multi-tab support."""

    def __init__(self) -> None:
        self.playwright: Playwright | None = None
        self.browser: Browser | None = None
        self.context: BrowserContext | None = None
        self.pages: dict[str, Page] = {}
        self.current_page_id: str | None = None
        self._next_tab_id = 1
        self.console_logs: dict[str, list[dict[str, Any]]] = {}

    async def _setup_console_logging(self, page: Page, tab_id: str) -> None:
        """Set up console log capturing for a page."""
        self.console_logs[tab_id] = []

        def handle_console(msg: Any) -> None:
            text = msg.text
            if len(text) > MAX_INDIVIDUAL_LOG_LENGTH:
                text = text[:MAX_INDIVIDUAL_LOG_LENGTH] + "... [TRUNCATED]"

            log_entry = {
                "type": msg.type,
                "text": text,
                "location": msg.location,
            }
            self.console_logs[tab_id].append(log_entry)

            if len(self.console_logs[tab_id]) > MAX_CONSOLE_LOGS_COUNT:
                self.console_logs[tab_id] = self.console_logs[tab_id][-MAX_CONSOLE_LOGS_COUNT:]

        page.on("console", handle_console)

    async def launch(self, url: str | None = None) -> dict[str, Any]:
        """Launch the browser."""
        if self.browser is not None:
            return {"success": False, "error": "Browser is already launched"}

        self.playwright = await async_playwright().start()

        self.browser = await self.playwright.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--disable-web-security",
                "--disable-features=VizDisplayCompositor",
            ],
        )

        self.context = await self.browser.new_context(
            viewport={"width": 1280, "height": 720},
            user_agent=(
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
            # Configure proxy if mitmproxy is running
            proxy={"server": "http://localhost:8080"} if True else None,
            ignore_https_errors=True,
        )

        page = await self.context.new_page()
        tab_id = f"tab_{self._next_tab_id}"
        self._next_tab_id += 1
        self.pages[tab_id] = page
        self.current_page_id = tab_id

        await self._setup_console_logging(page, tab_id)

        if url:
            await page.goto(url, wait_until="domcontentloaded")

        return await self._get_page_state(tab_id)

    async def _get_page_state(self, tab_id: str | None = None) -> dict[str, Any]:
        """Get current state of a page including screenshot."""
        if not tab_id:
            tab_id = self.current_page_id

        if not tab_id or tab_id not in self.pages:
            return {"success": False, "error": f"Tab '{tab_id}' not found"}

        page = self.pages[tab_id]

        await asyncio.sleep(0.5)  # Brief wait for rendering

        screenshot_bytes = await page.screenshot(type="png", full_page=False)
        screenshot_b64 = base64.b64encode(screenshot_bytes).decode("utf-8")

        url = page.url
        title = await page.title()
        viewport = page.viewport_size

        all_tabs = {}
        for tid, tab_page in self.pages.items():
            all_tabs[tid] = {
                "url": tab_page.url,
                "title": await tab_page.title() if not tab_page.is_closed() else "Closed",
            }

        return {
            "success": True,
            "screenshot": screenshot_b64,
            "url": url,
            "title": title,
            "viewport": viewport,
            "tab_id": tab_id,
            "all_tabs": all_tabs,
        }

    async def goto(self, url: str, wait_until: str = "domcontentloaded", tab_id: str | None = None) -> dict[str, Any]:
        """Navigate to a URL."""
        if not tab_id:
            tab_id = self.current_page_id

        if not tab_id or tab_id not in self.pages:
            return {"success": False, "error": f"Tab '{tab_id}' not found"}

        page = self.pages[tab_id]
        await page.goto(url, wait_until=wait_until)

        return await self._get_page_state(tab_id)

    async def click(self, coordinate: str, tab_id: str | None = None) -> dict[str, Any]:
        """Click at coordinates."""
        if not tab_id:
            tab_id = self.current_page_id

        if not tab_id or tab_id not in self.pages:
            return {"success": False, "error": f"Tab '{tab_id}' not found"}

        try:
            x, y = map(int, coordinate.split(","))
        except ValueError:
            return {"success": False, "error": f"Invalid coordinate format: {coordinate}. Use 'x,y'"}

        page = self.pages[tab_id]
        await page.mouse.click(x, y)

        return await self._get_page_state(tab_id)

    async def type_text(self, text: str, tab_id: str | None = None) -> dict[str, Any]:
        """Type text into focused element."""
        if not tab_id:
            tab_id = self.current_page_id

        if not tab_id or tab_id not in self.pages:
            return {"success": False, "error": f"Tab '{tab_id}' not found"}

        page = self.pages[tab_id]
        await page.keyboard.type(text)

        return await self._get_page_state(tab_id)

    async def scroll(self, direction: str, tab_id: str | None = None) -> dict[str, Any]:
        """Scroll page up or down."""
        if not tab_id:
            tab_id = self.current_page_id

        if not tab_id or tab_id not in self.pages:
            return {"success": False, "error": f"Tab '{tab_id}' not found"}

        page = self.pages[tab_id]

        if direction == "down":
            await page.keyboard.press("PageDown")
        elif direction == "up":
            await page.keyboard.press("PageUp")
        else:
            return {"success": False, "error": f"Invalid scroll direction: {direction}"}

        return await self._get_page_state(tab_id)

    async def execute_js(self, code: str, tab_id: str | None = None) -> dict[str, Any]:
        """Execute JavaScript code."""
        if not tab_id:
            tab_id = self.current_page_id

        if not tab_id or tab_id not in self.pages:
            return {"success": False, "error": f"Tab '{tab_id}' not found"}

        page = self.pages[tab_id]

        try:
            result = await page.evaluate(code)
        except Exception as e:
            result = {"error": True, "error_type": type(e).__name__, "error_message": str(e)}

        result_str = str(result)
        if len(result_str) > MAX_JS_RESULT_LENGTH:
            result = result_str[:MAX_JS_RESULT_LENGTH] + "... [JS result truncated]"

        state = await self._get_page_state(tab_id)
        state["js_result"] = result
        state["console_logs"] = self.console_logs.get(tab_id, [])[-20:]
        return state

    async def new_tab(self, url: str | None = None) -> dict[str, Any]:
        """Open a new tab."""
        if not self.context:
            return {"success": False, "error": "Browser not launched"}

        page = await self.context.new_page()
        tab_id = f"tab_{self._next_tab_id}"
        self._next_tab_id += 1
        self.pages[tab_id] = page
        self.current_page_id = tab_id

        await self._setup_console_logging(page, tab_id)

        if url:
            await page.goto(url, wait_until="domcontentloaded")

        return await self._get_page_state(tab_id)

    async def switch_tab(self, tab_id: str) -> dict[str, Any]:
        """Switch to a different tab."""
        if tab_id not in self.pages:
            return {"success": False, "error": f"Tab '{tab_id}' not found"}

        self.current_page_id = tab_id
        return await self._get_page_state(tab_id)

    async def close_tab(self, tab_id: str) -> dict[str, Any]:
        """Close a tab."""
        if tab_id not in self.pages:
            return {"success": False, "error": f"Tab '{tab_id}' not found"}

        if len(self.pages) == 1:
            return {"success": False, "error": "Cannot close the last tab"}

        page = self.pages.pop(tab_id)
        await page.close()

        if tab_id in self.console_logs:
            del self.console_logs[tab_id]

        if self.current_page_id == tab_id:
            self.current_page_id = next(iter(self.pages.keys()))

        return await self._get_page_state(self.current_page_id)

    async def view_source(self, tab_id: str | None = None) -> dict[str, Any]:
        """Get page HTML source."""
        if not tab_id:
            tab_id = self.current_page_id

        if not tab_id or tab_id not in self.pages:
            return {"success": False, "error": f"Tab '{tab_id}' not found"}

        page = self.pages[tab_id]
        source = await page.content()
        original_length = len(source)

        if original_length > MAX_PAGE_SOURCE_LENGTH:
            truncation_message = f"\n\n<!-- [TRUNCATED: {original_length - MAX_PAGE_SOURCE_LENGTH} characters removed] -->\n\n"
            available_space = MAX_PAGE_SOURCE_LENGTH - len(truncation_message)
            truncate_point = available_space // 2
            source = source[:truncate_point] + truncation_message + source[-truncate_point:]

        state = await self._get_page_state(tab_id)
        state["page_source"] = source
        return state

    async def screenshot(self, tab_id: str | None = None) -> dict[str, Any]:
        """Take a screenshot."""
        return await self._get_page_state(tab_id)

    async def close(self) -> dict[str, Any]:
        """Close the browser."""
        try:
            if self.browser:
                await self.browser.close()
            if self.playwright:
                await self.playwright.stop()
            self.browser = None
            self.playwright = None
            self.context = None
            self.pages = {}
            self.current_page_id = None
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def is_alive(self) -> bool:
        """Check if browser is still running."""
        return self.browser is not None and self.browser.is_connected()


# Global browser instance
_browser: BrowserInstance | None = None


def get_browser() -> BrowserInstance:
    """Get or create the global browser instance."""
    global _browser
    if _browser is None:
        _browser = BrowserInstance()
    return _browser
