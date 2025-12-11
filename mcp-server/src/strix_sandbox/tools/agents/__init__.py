"""Multi-agent coordination system for strix-sandbox-mcp."""

from .models import Agent, AgentStatus, Message, AgentEdge, AgentGraphSummary
from .state_store import agent_store
from .message_bus import message_bus
from .tools import (
    create_agent,
    send_message_to_agent,
    agent_finish,
    wait_for_message,
    view_agent_graph,
    finish_scan,
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
