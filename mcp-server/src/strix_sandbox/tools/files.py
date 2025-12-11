"""File operation tools for the sandbox workspace."""

from typing import Any

from strix_sandbox.runtime.docker import docker_manager


async def _execute(sandbox_id: str, tool_name: str, **kwargs: Any) -> dict[str, Any]:
    """Execute a file tool in the sandbox."""
    try:
        return await docker_manager.execute_in_sandbox(sandbox_id, tool_name, kwargs)
    except Exception as e:
        return {"success": False, "error": str(e)}


async def read(sandbox_id: str, path: str) -> dict[str, Any]:
    """Read a file from the sandbox workspace."""
    return await _execute(sandbox_id, "file_read", path=path)


async def write(sandbox_id: str, path: str, content: str) -> dict[str, Any]:
    """Write content to a file in the sandbox workspace."""
    return await _execute(sandbox_id, "file_write", path=path, content=content)


async def search(sandbox_id: str, pattern: str, path: str = ".") -> dict[str, Any]:
    """Search for files or content using ripgrep."""
    return await _execute(sandbox_id, "file_search", pattern=pattern, path=path)


async def str_replace(
    sandbox_id: str, path: str, old_str: str, new_str: str
) -> dict[str, Any]:
    """
    Replace an exact string in a file.

    The old_str must be unique in the file (appear exactly once).
    Include enough surrounding context to make the match unique.

    Args:
        sandbox_id: Sandbox ID
        path: File path relative to /workspace
        old_str: String to find (must be unique)
        new_str: Replacement string

    Returns:
        success, message, replacements
    """
    return await _execute(
        sandbox_id, "file_str_replace", path=path, old_str=old_str, new_str=new_str
    )


async def list_dir(
    sandbox_id: str, path: str = ".", recursive: bool = False
) -> dict[str, Any]:
    """
    List files and directories in the sandbox workspace.

    Args:
        sandbox_id: Sandbox ID
        path: Directory path relative to /workspace
        recursive: If True, include subdirectories recursively

    Returns:
        files, directories, total_files, total_dirs
    """
    return await _execute(
        sandbox_id, "file_list", path=path, recursive=recursive
    )


async def view(
    sandbox_id: str,
    path: str,
    start_line: int | None = None,
    end_line: int | None = None,
) -> dict[str, Any]:
    """
    View a file with optional line range.

    Lines are 1-indexed. Use -1 for end_line to read until the end.

    Args:
        sandbox_id: Sandbox ID
        path: File path relative to /workspace
        start_line: Starting line number (1-indexed, default: 1)
        end_line: Ending line number (inclusive, default: end of file)

    Returns:
        content (with line numbers), total_lines, viewed_range
    """
    return await _execute(
        sandbox_id,
        "file_view_range",
        path=path,
        start_line=start_line,
        end_line=end_line,
    )


async def insert_lines(
    sandbox_id: str, path: str, insert_line: int, new_str: str
) -> dict[str, Any]:
    """
    Insert text after a specified line number.

    Args:
        sandbox_id: Sandbox ID
        path: File path relative to /workspace
        insert_line: Line number to insert after (0 = at beginning, 1 = after first line)
        new_str: Text to insert

    Returns:
        success, message, new_total_lines
    """
    return await _execute(
        sandbox_id,
        "file_insert",
        path=path,
        insert_line=insert_line,
        new_str=new_str,
    )
