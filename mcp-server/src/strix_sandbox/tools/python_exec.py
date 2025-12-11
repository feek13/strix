"""Python code execution tools using IPython."""

from typing import Any

from strix_sandbox.runtime.docker import docker_manager


async def _execute(sandbox_id: str, tool_name: str, **kwargs: Any) -> dict[str, Any]:
    """Execute a Python tool in the sandbox."""
    try:
        return await docker_manager.execute_in_sandbox(sandbox_id, tool_name, kwargs)
    except Exception as e:
        return {"success": False, "error": str(e)}


async def execute(
    sandbox_id: str,
    session_id: str,
    code: str,
    timeout: int = 30,
) -> dict[str, Any]:
    """Execute Python code in an IPython session."""
    return await _execute(
        sandbox_id,
        "python_execute",
        session_id=session_id,
        code=code,
        timeout=min(timeout, 60),  # Cap at 60 seconds
    )


async def manage_session(
    sandbox_id: str,
    action: str,
    session_id: str = "default",
) -> dict[str, Any]:
    """Manage Python sessions (new, list, close)."""
    return await _execute(
        sandbox_id,
        "python_session",
        action=action,
        session_id=session_id,
    )
