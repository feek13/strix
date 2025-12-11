"""Terminal execution tools using tmux."""

from typing import Any

from strix_sandbox.runtime.docker import docker_manager


async def _execute(sandbox_id: str, tool_name: str, **kwargs: Any) -> dict[str, Any]:
    """Execute a terminal tool in the sandbox."""
    try:
        return await docker_manager.execute_in_sandbox(sandbox_id, tool_name, kwargs)
    except Exception as e:
        return {"success": False, "error": str(e)}


async def execute(
    sandbox_id: str,
    session_id: str,
    command: str,
    timeout: int = 60,
) -> dict[str, Any]:
    """Execute a command in the terminal."""
    return await _execute(
        sandbox_id,
        "terminal_execute",
        session_id=session_id,
        command=command,
        timeout=min(timeout, 60),  # Cap at 60 seconds
    )


async def send_input(
    sandbox_id: str,
    session_id: str,
    input_text: str,
) -> dict[str, Any]:
    """Send input to a running process in the terminal."""
    return await _execute(
        sandbox_id,
        "terminal_send_input",
        session_id=session_id,
        input_text=input_text,
    )
