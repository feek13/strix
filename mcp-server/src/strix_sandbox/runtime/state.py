"""Sandbox state management."""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass
class SandboxState:
    """State for a single sandbox instance."""

    sandbox_id: str
    container_id: str | None = None
    status: str = "pending"  # pending, running, stopped, error
    created_at: datetime = field(default_factory=datetime.utcnow)
    proxy_port: int | None = None
    tool_server_port: int = 9999
    tool_server_token: str = ""
    workspace_path: str = ""
    browser_launched: bool = False
    active_terminal_sessions: list[str] = field(default_factory=list)
    active_python_sessions: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Convert state to dictionary."""
        return {
            "sandbox_id": self.sandbox_id,
            "container_id": self.container_id,
            "status": self.status,
            "created_at": self.created_at.isoformat(),
            "proxy_port": self.proxy_port,
            "tool_server_port": self.tool_server_port,
            "workspace_path": self.workspace_path,
            "browser_launched": self.browser_launched,
            "active_terminal_sessions": self.active_terminal_sessions,
            "active_python_sessions": self.active_python_sessions,
        }


class SandboxStateManager:
    """Manages state for multiple sandbox instances."""

    def __init__(self) -> None:
        self._sandboxes: dict[str, SandboxState] = {}

    def create(self, sandbox_id: str) -> SandboxState:
        """Create a new sandbox state."""
        if sandbox_id in self._sandboxes:
            raise ValueError(f"Sandbox {sandbox_id} already exists")
        state = SandboxState(sandbox_id=sandbox_id)
        self._sandboxes[sandbox_id] = state
        return state

    def get(self, sandbox_id: str) -> SandboxState | None:
        """Get sandbox state by ID."""
        return self._sandboxes.get(sandbox_id)

    def get_or_raise(self, sandbox_id: str) -> SandboxState:
        """Get sandbox state or raise error if not found."""
        state = self.get(sandbox_id)
        if state is None:
            raise ValueError(f"Sandbox {sandbox_id} not found")
        return state

    def delete(self, sandbox_id: str) -> bool:
        """Delete sandbox state."""
        if sandbox_id in self._sandboxes:
            del self._sandboxes[sandbox_id]
            return True
        return False

    def list_all(self) -> list[SandboxState]:
        """List all sandbox states."""
        return list(self._sandboxes.values())


# Global state manager instance
state_manager = SandboxStateManager()
