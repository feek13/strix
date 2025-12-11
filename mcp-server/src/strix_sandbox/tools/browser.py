"""Browser automation tools using Playwright."""

from typing import Any

from strix_sandbox.runtime.docker import docker_manager


async def _execute(sandbox_id: str, tool_name: str, **kwargs: Any) -> dict[str, Any]:
    """Execute a browser tool in the sandbox."""
    try:
        return await docker_manager.execute_in_sandbox(sandbox_id, tool_name, kwargs)
    except Exception as e:
        return {"success": False, "error": str(e)}


async def launch(sandbox_id: str = "default") -> dict[str, Any]:
    """Launch a browser in the sandbox."""
    return await _execute(sandbox_id, "browser_launch")


async def goto(
    sandbox_id: str, url: str, wait_until: str = "domcontentloaded"
) -> dict[str, Any]:
    """Navigate browser to a URL."""
    return await _execute(sandbox_id, "browser_goto", url=url, wait_until=wait_until)


async def click(sandbox_id: str, coordinate: str) -> dict[str, Any]:
    """Click at coordinates on the page."""
    return await _execute(sandbox_id, "browser_click", coordinate=coordinate)


async def type_text(sandbox_id: str, text: str) -> dict[str, Any]:
    """Type text into the focused element."""
    return await _execute(sandbox_id, "browser_type", text=text)


async def scroll(sandbox_id: str, direction: str = "down") -> dict[str, Any]:
    """Scroll the page up or down."""
    return await _execute(sandbox_id, "browser_scroll", direction=direction)


async def screenshot(sandbox_id: str = "default") -> dict[str, Any]:
    """Take a screenshot of the current page."""
    return await _execute(sandbox_id, "browser_screenshot")


async def execute_js(sandbox_id: str, code: str) -> dict[str, Any]:
    """Execute JavaScript code in the browser context."""
    return await _execute(sandbox_id, "browser_execute_js", code=code)


async def new_tab(sandbox_id: str, url: str | None = None) -> dict[str, Any]:
    """Open a new browser tab."""
    return await _execute(sandbox_id, "browser_new_tab", url=url)


async def switch_tab(sandbox_id: str, tab_id: str) -> dict[str, Any]:
    """Switch to a different browser tab."""
    return await _execute(sandbox_id, "browser_switch_tab", tab_id=tab_id)


async def close_tab(sandbox_id: str, tab_id: str) -> dict[str, Any]:
    """Close a browser tab."""
    return await _execute(sandbox_id, "browser_close_tab", tab_id=tab_id)


async def get_source(sandbox_id: str = "default") -> dict[str, Any]:
    """Get the HTML source of the current page."""
    return await _execute(sandbox_id, "browser_get_source")


async def close(sandbox_id: str = "default") -> dict[str, Any]:
    """Close the browser."""
    return await _execute(sandbox_id, "browser_close")
