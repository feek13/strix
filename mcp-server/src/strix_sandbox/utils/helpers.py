"""Utility helper functions."""

import base64
from typing import Any


def truncate_output(output: str, max_length: int = 20000) -> str:
    """Truncate output to a maximum length with indication."""
    if len(output) <= max_length:
        return output
    return output[:max_length] + f"\n... [truncated, {len(output) - max_length} more bytes]"


def encode_base64(data: bytes) -> str:
    """Encode bytes to base64 string."""
    return base64.b64encode(data).decode("utf-8")


def decode_base64(data: str) -> bytes:
    """Decode base64 string to bytes."""
    return base64.b64decode(data.encode("utf-8"))


def sanitize_path(path: str) -> str:
    """Sanitize a file path to prevent directory traversal."""
    import os

    # Remove leading slashes and normalize
    path = os.path.normpath(path)
    # Remove any leading path separators
    while path.startswith(os.sep):
        path = path[1:]
    # Prevent directory traversal
    if ".." in path.split(os.sep):
        raise ValueError("Path traversal detected")
    return path


def format_response(success: bool, data: dict[str, Any] | None = None, error: str | None = None) -> dict[str, Any]:
    """Format a standard response."""
    response: dict[str, Any] = {"success": success}
    if data:
        response.update(data)
    if error:
        response["error"] = error
    return response
