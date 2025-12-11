"""HTTP proxy tools using mitmproxy."""

from typing import Any

from strix_sandbox.runtime.docker import docker_manager


async def _execute(sandbox_id: str, tool_name: str, **kwargs: Any) -> dict[str, Any]:
    """Execute a proxy tool in the sandbox."""
    try:
        return await docker_manager.execute_in_sandbox(sandbox_id, tool_name, kwargs)
    except Exception as e:
        return {"success": False, "error": str(e)}


async def start(sandbox_id: str = "default") -> dict[str, Any]:
    """Start the mitmproxy in the sandbox."""
    return await _execute(sandbox_id, "proxy_start")


async def list_requests(
    sandbox_id: str,
    filter_expr: str | None = None,
    limit: int = 50,
    sort_by: str = "timestamp",
    sort_order: str = "desc",
) -> dict[str, Any]:
    """List captured HTTP requests."""
    return await _execute(
        sandbox_id,
        "proxy_list_requests",
        filter=filter_expr,
        limit=limit,
        sort_by=sort_by,
        sort_order=sort_order,
    )


async def view_request(
    sandbox_id: str,
    request_id: str,
    part: str = "request",
) -> dict[str, Any]:
    """View details of a captured request."""
    return await _execute(
        sandbox_id,
        "proxy_view_request",
        request_id=request_id,
        part=part,
    )


async def send_request(
    sandbox_id: str,
    method: str,
    url: str,
    headers: dict[str, str] | None = None,
    body: str = "",
    timeout: int = 30,
) -> dict[str, Any]:
    """Send an HTTP request through the proxy."""
    return await _execute(
        sandbox_id,
        "proxy_send_request",
        method=method,
        url=url,
        headers=headers or {},
        body=body,
        timeout=timeout,
    )


async def repeat_request(
    sandbox_id: str,
    request_id: str,
    modifications: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Repeat a captured request with optional modifications."""
    return await _execute(
        sandbox_id,
        "proxy_repeat_request",
        request_id=request_id,
        modifications=modifications or {},
    )


async def set_scope(
    sandbox_id: str,
    allowlist: list[str] | None = None,
    denylist: list[str] | None = None,
) -> dict[str, Any]:
    """Set the proxy interception scope."""
    return await _execute(
        sandbox_id,
        "proxy_set_scope",
        allowlist=allowlist or [],
        denylist=denylist or [],
    )


async def get_sitemap(sandbox_id: str = "default") -> dict[str, Any]:
    """Get the discovered sitemap from captured requests."""
    return await _execute(sandbox_id, "proxy_get_sitemap")
