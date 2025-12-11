"""Inter-agent messaging with event-driven wake-up."""

import asyncio
import logging
from typing import Any

from .models import AgentEdge, Message
from .state_store import agent_store


logger = logging.getLogger(__name__)


class MessageBus:
    """Handles inter-agent messaging with event signaling."""

    _instance: "MessageBus | None" = None

    def __init__(self) -> None:
        self._events: dict[str, asyncio.Event] = {}
        self._lock = asyncio.Lock()

    @classmethod
    def get_instance(cls) -> "MessageBus":
        """Get singleton instance of the message bus."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    async def _get_event(self, agent_id: str) -> asyncio.Event:
        """Get or create an event for an agent."""
        async with self._lock:
            if agent_id not in self._events:
                self._events[agent_id] = asyncio.Event()
            return self._events[agent_id]

    async def _remove_event(self, agent_id: str) -> None:
        """Remove an event for an agent (cleanup)."""
        async with self._lock:
            self._events.pop(agent_id, None)

    async def send_message(
        self,
        from_agent_id: str,
        to_agent_id: str,
        content: str,
        message_type: str = "information",
        priority: str = "normal",
    ) -> Message:
        """
        Send a message to another agent.

        Args:
            from_agent_id: Sender agent ID
            to_agent_id: Recipient agent ID
            content: Message content
            message_type: Type of message (query, instruction, information)
            priority: Priority level (low, normal, high, urgent)

        Returns:
            The created Message object

        Raises:
            ValueError: If target agent not found
        """
        # Verify target exists
        target = await agent_store.get_agent(to_agent_id)
        if not target:
            raise ValueError(f"Target agent '{to_agent_id}' not found")

        # Create message
        message = Message(
            from_agent_id=from_agent_id,
            to_agent_id=to_agent_id,
            content=content,
            message_type=message_type,
            priority=priority,
            delivered=True,
        )
        await agent_store.create_message(message)

        # Create message edge in graph
        edge = AgentEdge(
            from_agent_id=from_agent_id,
            to_agent_id=to_agent_id,
            edge_type="message",
            message_id=message.message_id,
        )
        await agent_store.create_edge(edge)

        # Signal the target agent to wake up
        event = await self._get_event(to_agent_id)
        event.set()

        logger.debug(
            f"Message {message.message_id} sent from {from_agent_id} to {to_agent_id}"
        )

        return message

    async def wait_for_message(
        self,
        agent_id: str,
        timeout: float = 600.0,
    ) -> list[Message]:
        """
        Wait for messages to arrive for an agent.

        Args:
            agent_id: Agent ID to wait for messages
            timeout: Maximum wait time in seconds (default: 600)

        Returns:
            List of unread messages
        """
        event = await self._get_event(agent_id)
        event.clear()  # Reset event for fresh wait

        # Check if there are already unread messages
        existing_messages = await agent_store.get_unread_messages(agent_id)
        if existing_messages:
            logger.debug(
                f"Agent {agent_id} has {len(existing_messages)} existing unread messages"
            )
            return existing_messages

        try:
            # Wait with timeout for new messages
            logger.debug(f"Agent {agent_id} waiting for messages (timeout: {timeout}s)")
            await asyncio.wait_for(event.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            logger.debug(f"Agent {agent_id} wait timed out after {timeout}s")

        # Get unread messages after wait
        messages = await agent_store.get_unread_messages(agent_id)
        return messages

    async def get_pending_messages(self, agent_id: str) -> list[Message]:
        """
        Get unread messages without waiting.

        Args:
            agent_id: Agent ID to check messages for

        Returns:
            List of unread messages
        """
        return await agent_store.get_unread_messages(agent_id)

    async def mark_read(self, message_id: str) -> None:
        """
        Mark a message as read.

        Args:
            message_id: Message ID to mark as read
        """
        await agent_store.mark_message_read(message_id)

    async def mark_all_read(self, agent_id: str) -> int:
        """
        Mark all messages for an agent as read.

        Args:
            agent_id: Agent ID to mark messages for

        Returns:
            Number of messages marked as read
        """
        messages = await agent_store.get_unread_messages(agent_id)
        for msg in messages:
            await agent_store.mark_message_read(msg.message_id)
        return len(messages)

    async def notify_agent(self, agent_id: str) -> None:
        """
        Notify an agent (wake up from waiting).

        Args:
            agent_id: Agent ID to notify
        """
        event = await self._get_event(agent_id)
        event.set()
        logger.debug(f"Agent {agent_id} notified")

    async def cleanup_agent(self, agent_id: str) -> None:
        """
        Clean up resources for an agent (call when agent finishes).

        Args:
            agent_id: Agent ID to cleanup
        """
        await self._remove_event(agent_id)
        logger.debug(f"Cleaned up resources for agent {agent_id}")

    def get_waiting_agents(self) -> list[str]:
        """
        Get list of agent IDs that have events registered.

        Returns:
            List of agent IDs with registered events
        """
        return list(self._events.keys())


# Global singleton instance
message_bus = MessageBus.get_instance()
