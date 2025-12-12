"""Multi-agent coordination system for strix-sandbox-mcp."""

from .message_bus import message_bus
from .models import Agent, AgentEdge, AgentGraphSummary, AgentStatus, Message
from .state_store import agent_store
from .tools import (
    agent_finish,
    create_agent,
    finish_scan,
    send_message_to_agent,
    view_agent_graph,
    wait_for_message,
)

__all__ = [
    # Models
    "Agent",
    "AgentStatus",
    "Message",
    "AgentEdge",
    "AgentGraphSummary",
    # Stores
    "agent_store",
    "message_bus",
    # Tools
    "create_agent",
    "send_message_to_agent",
    "agent_finish",
    "wait_for_message",
    "view_agent_graph",
    "finish_scan",
]
