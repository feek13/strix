"""Data models for multi-agent coordination system."""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any
import uuid


class AgentStatus(str, Enum):
    """Status of an agent in the system."""

    PENDING = "pending"
    RUNNING = "running"
    WAITING = "waiting"
    COMPLETED = "completed"
    FAILED = "failed"
    STOPPED = "stopped"
    ERROR = "error"


@dataclass
class Agent:
    """Represents an agent in the multi-agent system."""

    agent_id: str = field(default_factory=lambda: f"agent_{uuid.uuid4().hex[:8]}")
    name: str = ""
    task: str = ""
    status: AgentStatus = AgentStatus.PENDING
    parent_id: str | None = None
    sandbox_id: str = "default"

    # Configuration
    prompt_modules: list[str] = field(default_factory=list)
    inherit_context: bool = True
    max_iterations: int = 300

    # Execution state
    iteration: int = 0
    waiting_reason: str = ""

    # Timestamps
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    started_at: datetime | None = None
    finished_at: datetime | None = None

    # Results
    result: dict[str, Any] | None = None
    error: str | None = None

    # Conversation history key (for separate storage)
    messages_key: str = field(default_factory=lambda: f"messages_{uuid.uuid4().hex[:8]}")

    def to_dict(self) -> dict[str, Any]:
        """Convert agent to dictionary representation."""
        return {
            "agent_id": self.agent_id,
            "name": self.name,
            "task": self.task,
            "status": self.status.value,
            "parent_id": self.parent_id,
            "sandbox_id": self.sandbox_id,
            "prompt_modules": self.prompt_modules,
            "inherit_context": self.inherit_context,
            "max_iterations": self.max_iterations,
            "iteration": self.iteration,
            "waiting_reason": self.waiting_reason,
            "created_at": self.created_at.isoformat(),
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
            "result": self.result,
            "error": self.error,
        }


@dataclass
class Message:
    """Inter-agent message."""

    message_id: str = field(default_factory=lambda: f"msg_{uuid.uuid4().hex[:8]}")
    from_agent_id: str = ""
    to_agent_id: str = ""
    content: str = ""
    message_type: str = "information"  # query, instruction, information
    priority: str = "normal"  # low, normal, high, urgent
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    delivered: bool = False
    read: bool = False

    def to_dict(self) -> dict[str, Any]:
        """Convert message to dictionary representation."""
        return {
            "message_id": self.message_id,
            "from_agent_id": self.from_agent_id,
            "to_agent_id": self.to_agent_id,
            "content": self.content,
            "message_type": self.message_type,
            "priority": self.priority,
            "timestamp": self.timestamp.isoformat(),
            "delivered": self.delivered,
            "read": self.read,
        }

    def to_xml(self, sender_name: str = "Unknown") -> str:
        """Convert message to XML format for LLM consumption."""
        return f"""<inter_agent_message>
    <delivery_notice>You have received a message from another agent</delivery_notice>
    <sender>
        <agent_name>{sender_name}</agent_name>
        <agent_id>{self.from_agent_id}</agent_id>
    </sender>
    <message_metadata>
        <type>{self.message_type}</type>
        <priority>{self.priority}</priority>
        <timestamp>{self.timestamp.isoformat()}</timestamp>
    </message_metadata>
    <content>{self.content}</content>
</inter_agent_message>"""


@dataclass
class AgentEdge:
    """Edge in the agent graph (delegation or message relationship)."""

    from_agent_id: str
    to_agent_id: str
    edge_type: str  # "delegation" or "message"
    message_id: str | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> dict[str, Any]:
        """Convert edge to dictionary representation."""
        return {
            "from_agent_id": self.from_agent_id,
            "to_agent_id": self.to_agent_id,
            "edge_type": self.edge_type,
            "message_id": self.message_id,
            "created_at": self.created_at.isoformat(),
        }


@dataclass
class AgentGraphSummary:
    """Summary statistics for the agent graph."""

    total_agents: int = 0
    pending: int = 0
    running: int = 0
    waiting: int = 0
    completed: int = 0
    failed: int = 0
    stopped: int = 0
    error: int = 0

    def to_dict(self) -> dict[str, int]:
        """Convert summary to dictionary representation."""
        return {
            "total_agents": self.total_agents,
            "pending": self.pending,
            "running": self.running,
            "waiting": self.waiting,
            "completed": self.completed,
            "failed": self.failed,
            "stopped": self.stopped,
            "error": self.error,
        }
