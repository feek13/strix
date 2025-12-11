"""Sandbox lifecycle management tools."""

from typing import Any

from strix_sandbox.runtime.docker import docker_manager
from strix_sandbox.runtime.state import state_manager


async def create(
    name: str = "default",
    with_proxy: bool = True,
    with_browser: bool = True,
    workspace_path: str | None = None,
) -> dict[str, Any]:
    """Create a new sandbox environment."""
    try:
        state = await docker_manager.create_sandbox(
            sandbox_id=name,
            with_proxy=with_proxy,
            with_browser=with_browser,
            workspace_path=workspace_path,
        )
        return {
            "success": True,
            "sandbox_id": state.sandbox_id,
            "status": state.status,
            "proxy_port": state.proxy_port,
            "tool_server_port": state.tool_server_port,
            "workspace_path": state.workspace_path,
        }
    except ValueError as e:
        # Sandbox already exists
        return {"success": False, "error": str(e)}
    except Exception as e:
        return {"success": False, "error": f"Failed to create sandbox: {e}"}


async def destroy(sandbox_id: str) -> dict[str, Any]:
    """Destroy a sandbox environment."""
    try:
        success = await docker_manager.destroy_sandbox(sandbox_id)
        if success:
            return {"success": True, "message": f"Sandbox {sandbox_id} destroyed"}
        return {"success": False, "error": f"Sandbox {sandbox_id} not found"}
    except Exception as e:
        return {"success": False, "error": f"Failed to destroy sandbox: {e}"}


async def status(sandbox_id: str = "default") -> dict[str, Any]:
    """Get status of a sandbox environment."""
    try:
        status_info = await docker_manager.get_sandbox_status(sandbox_id)
        return {"success": True, **status_info}
    except Exception as e:
        return {"success": False, "error": f"Failed to get status: {e}"}


async def list_sandboxes() -> dict[str, Any]:
    """List all sandboxes."""
    sandboxes = state_manager.list_all()
    return {
        "success": True,
        "sandboxes": [s.to_dict() for s in sandboxes],
        "count": len(sandboxes),
    }
