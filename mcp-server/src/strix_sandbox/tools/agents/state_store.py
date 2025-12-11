"""SQLite persistence for agent state."""

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import aiosqlite

from .models import Agent, AgentEdge, AgentGraphSummary, AgentStatus, Message


DB_PATH = Path.home() / ".strix" / "agents.db"


class AgentStateStore:
    """Persistent storage for agent state using SQLite."""

    _instance: "AgentStateStore | None" = None

    def __init__(self) -> None:
        self._db: aiosqlite.Connection | None = None
        self._initialized = False

    @classmethod
    def get_instance(cls) -> "AgentStateStore":
        """Get singleton instance of the state store."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    async def _get_db(self) -> aiosqlite.Connection:
        """Get database connection, creating tables if needed."""
        if self._db is None:
            DB_PATH.parent.mkdir(parents=True, exist_ok=True)
            self._db = await aiosqlite.connect(str(DB_PATH))
            self._db.row_factory = aiosqlite.Row
            if not self._initialized:
                await self._create_tables()
                self._initialized = True
        return self._db

    async def _create_tables(self) -> None:
        """Create database tables if they don't exist."""
        db = await self._get_db()

        # Agents table
        await db.execute("""
            CREATE TABLE IF NOT EXISTS agents (
                agent_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                task TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                parent_id TEXT,
                sandbox_id TEXT NOT NULL DEFAULT 'default',
                prompt_modules TEXT DEFAULT '[]',
                inherit_context INTEGER DEFAULT 1,
                max_iterations INTEGER DEFAULT 300,
                iteration INTEGER DEFAULT 0,
                waiting_reason TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                started_at TEXT,
                finished_at TEXT,
                result TEXT,
                error TEXT,
                messages_key TEXT NOT NULL,
                FOREIGN KEY (parent_id) REFERENCES agents(agent_id)
            )
        """)

        # Messages table
        await db.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                message_id TEXT PRIMARY KEY,
                from_agent_id TEXT NOT NULL,
                to_agent_id TEXT NOT NULL,
                content TEXT NOT NULL,
                message_type TEXT DEFAULT 'information',
                priority TEXT DEFAULT 'normal',
                timestamp TEXT NOT NULL,
                delivered INTEGER DEFAULT 0,
                read INTEGER DEFAULT 0
            )
        """)

        # Edges table (delegation and message relationships)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS edges (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                from_agent_id TEXT NOT NULL,
                to_agent_id TEXT NOT NULL,
                edge_type TEXT NOT NULL,
                message_id TEXT,
                created_at TEXT NOT NULL
            )
        """)

        # Conversation history (separate table for large data)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS conversation_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                FOREIGN KEY (agent_id) REFERENCES agents(agent_id)
            )
        """)

        # Graph metadata (root agent tracking, etc.)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS graph_metadata (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        """)

        # Create indexes for common queries
        await db.execute("""
            CREATE INDEX IF NOT EXISTS idx_agents_sandbox
            ON agents(sandbox_id)
        """)
        await db.execute("""
            CREATE INDEX IF NOT EXISTS idx_agents_parent
            ON agents(parent_id)
        """)
        await db.execute("""
            CREATE INDEX IF NOT EXISTS idx_messages_to_agent
            ON messages(to_agent_id, read)
        """)
        await db.execute("""
            CREATE INDEX IF NOT EXISTS idx_edges_from
            ON edges(from_agent_id, edge_type)
        """)

        await db.commit()

    # ============== Agent Operations ==============

    async def create_agent(self, agent: Agent) -> Agent:
        """Create a new agent in the database."""
        db = await self._get_db()
        await db.execute(
            """
            INSERT INTO agents (
                agent_id, name, task, status, parent_id, sandbox_id,
                prompt_modules, inherit_context, max_iterations, iteration,
                waiting_reason, created_at, started_at, finished_at,
                result, error, messages_key
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
            (
                agent.agent_id,
                agent.name,
                agent.task,
                agent.status.value,
                agent.parent_id,
                agent.sandbox_id,
                json.dumps(agent.prompt_modules),
                int(agent.inherit_context),
                agent.max_iterations,
                agent.iteration,
                agent.waiting_reason,
                agent.created_at.isoformat(),
                agent.started_at.isoformat() if agent.started_at else None,
                agent.finished_at.isoformat() if agent.finished_at else None,
                json.dumps(agent.result) if agent.result else None,
                agent.error,
                agent.messages_key,
            ),
        )
        await db.commit()
        return agent

    async def get_agent(self, agent_id: str) -> Agent | None:
        """Get an agent by ID."""
        db = await self._get_db()
        async with db.execute(
            "SELECT * FROM agents WHERE agent_id = ?", (agent_id,)
        ) as cursor:
            row = await cursor.fetchone()
            if row:
                return self._row_to_agent(row)
        return None

    async def update_agent(self, agent: Agent) -> None:
        """Update an existing agent."""
        db = await self._get_db()
        await db.execute(
            """
            UPDATE agents SET
                name = ?, task = ?, status = ?, parent_id = ?,
                sandbox_id = ?, prompt_modules = ?, iteration = ?,
                waiting_reason = ?, started_at = ?, finished_at = ?,
                result = ?, error = ?
            WHERE agent_id = ?
        """,
            (
                agent.name,
                agent.task,
                agent.status.value,
                agent.parent_id,
                agent.sandbox_id,
                json.dumps(agent.prompt_modules),
                agent.iteration,
                agent.waiting_reason,
                agent.started_at.isoformat() if agent.started_at else None,
                agent.finished_at.isoformat() if agent.finished_at else None,
                json.dumps(agent.result) if agent.result else None,
                agent.error,
                agent.agent_id,
            ),
        )
        await db.commit()

    async def delete_agent(self, agent_id: str) -> bool:
        """Delete an agent and its related data."""
        db = await self._get_db()

        # Delete conversation history
        await db.execute(
            "DELETE FROM conversation_history WHERE agent_id = ?", (agent_id,)
        )

        # Delete messages to/from this agent
        await db.execute(
            "DELETE FROM messages WHERE from_agent_id = ? OR to_agent_id = ?",
            (agent_id, agent_id),
        )

        # Delete edges
        await db.execute(
            "DELETE FROM edges WHERE from_agent_id = ? OR to_agent_id = ?",
            (agent_id, agent_id),
        )

        # Delete agent
        await db.execute("DELETE FROM agents WHERE agent_id = ?", (agent_id,))

        await db.commit()
        return True

    async def list_agents(self, sandbox_id: str | None = None) -> list[Agent]:
        """List all agents, optionally filtered by sandbox."""
        db = await self._get_db()
        query = "SELECT * FROM agents"
        params: list[Any] = []
        if sandbox_id:
            query += " WHERE sandbox_id = ?"
            params.append(sandbox_id)
        query += " ORDER BY created_at"

        async with db.execute(query, params) as cursor:
            rows = await cursor.fetchall()
            return [self._row_to_agent(row) for row in rows]

    # ============== Message Operations ==============

    async def create_message(self, message: Message) -> Message:
        """Create a new message."""
        db = await self._get_db()
        await db.execute(
            """
            INSERT INTO messages (
                message_id, from_agent_id, to_agent_id, content,
                message_type, priority, timestamp, delivered, read
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
            (
                message.message_id,
                message.from_agent_id,
                message.to_agent_id,
                message.content,
                message.message_type,
                message.priority,
                message.timestamp.isoformat(),
                int(message.delivered),
                int(message.read),
            ),
        )
        await db.commit()
        return message

    async def get_unread_messages(self, agent_id: str) -> list[Message]:
        """Get all unread messages for an agent."""
        db = await self._get_db()
        async with db.execute(
            """
            SELECT * FROM messages
            WHERE to_agent_id = ? AND read = 0
            ORDER BY timestamp
        """,
            (agent_id,),
        ) as cursor:
            rows = await cursor.fetchall()
            return [self._row_to_message(row) for row in rows]

    async def mark_message_read(self, message_id: str) -> None:
        """Mark a message as read."""
        db = await self._get_db()
        await db.execute(
            "UPDATE messages SET read = 1 WHERE message_id = ?", (message_id,)
        )
        await db.commit()

    async def mark_message_delivered(self, message_id: str) -> None:
        """Mark a message as delivered."""
        db = await self._get_db()
        await db.execute(
            "UPDATE messages SET delivered = 1 WHERE message_id = ?", (message_id,)
        )
        await db.commit()

    # ============== Edge Operations ==============

    async def create_edge(self, edge: AgentEdge) -> None:
        """Create a new edge in the agent graph."""
        db = await self._get_db()
        await db.execute(
            """
            INSERT INTO edges (from_agent_id, to_agent_id, edge_type, message_id, created_at)
            VALUES (?, ?, ?, ?, ?)
        """,
            (
                edge.from_agent_id,
                edge.to_agent_id,
                edge.edge_type,
                edge.message_id,
                edge.created_at.isoformat(),
            ),
        )
        await db.commit()

    async def get_children(self, agent_id: str) -> list[str]:
        """Get child agent IDs (delegation edges)."""
        db = await self._get_db()
        async with db.execute(
            """
            SELECT to_agent_id FROM edges
            WHERE from_agent_id = ? AND edge_type = 'delegation'
        """,
            (agent_id,),
        ) as cursor:
            rows = await cursor.fetchall()
            return [row["to_agent_id"] for row in rows]

    # ============== Graph Operations ==============

    async def get_root_agent_id(self, sandbox_id: str = "default") -> str | None:
        """Get the root agent ID for a sandbox."""
        db = await self._get_db()
        key = f"root_agent_id_{sandbox_id}"
        async with db.execute(
            "SELECT value FROM graph_metadata WHERE key = ?", (key,)
        ) as cursor:
            row = await cursor.fetchone()
            return row["value"] if row else None

    async def set_root_agent_id(self, agent_id: str, sandbox_id: str = "default") -> None:
        """Set the root agent ID for a sandbox."""
        db = await self._get_db()
        key = f"root_agent_id_{sandbox_id}"
        await db.execute(
            """
            INSERT OR REPLACE INTO graph_metadata (key, value) VALUES (?, ?)
        """,
            (key, agent_id),
        )
        await db.commit()

    async def get_graph_summary(
        self, sandbox_id: str | None = None
    ) -> AgentGraphSummary:
        """Get summary statistics for the agent graph."""
        agents = await self.list_agents(sandbox_id)
        summary = AgentGraphSummary(total_agents=len(agents))

        for agent in agents:
            if agent.status == AgentStatus.PENDING:
                summary.pending += 1
            elif agent.status == AgentStatus.RUNNING:
                summary.running += 1
            elif agent.status == AgentStatus.WAITING:
                summary.waiting += 1
            elif agent.status == AgentStatus.COMPLETED:
                summary.completed += 1
            elif agent.status == AgentStatus.FAILED:
                summary.failed += 1
            elif agent.status == AgentStatus.STOPPED:
                summary.stopped += 1
            elif agent.status == AgentStatus.ERROR:
                summary.error += 1

        return summary

    # ============== Conversation History ==============

    async def add_message_to_history(
        self, agent_id: str, role: str, content: str
    ) -> None:
        """Add a message to an agent's conversation history."""
        db = await self._get_db()
        await db.execute(
            """
            INSERT INTO conversation_history (agent_id, role, content, timestamp)
            VALUES (?, ?, ?, ?)
        """,
            (agent_id, role, content, datetime.now(timezone.utc).isoformat()),
        )
        await db.commit()

    async def get_conversation_history(self, agent_id: str) -> list[dict[str, str]]:
        """Get an agent's conversation history."""
        db = await self._get_db()
        async with db.execute(
            """
            SELECT role, content FROM conversation_history
            WHERE agent_id = ? ORDER BY id
        """,
            (agent_id,),
        ) as cursor:
            rows = await cursor.fetchall()
            return [{"role": row["role"], "content": row["content"]} for row in rows]

    async def clear_conversation_history(self, agent_id: str) -> None:
        """Clear an agent's conversation history."""
        db = await self._get_db()
        await db.execute(
            "DELETE FROM conversation_history WHERE agent_id = ?", (agent_id,)
        )
        await db.commit()

    # ============== Scan Result Operations ==============

    async def set_scan_result(self, sandbox_id: str, result: dict) -> None:
        """
        Store the final scan result.

        Args:
            sandbox_id: Sandbox ID
            result: Scan result dictionary to store
        """
        db = await self._get_db()
        key = f"scan_result_{sandbox_id}"
        await db.execute(
            "INSERT OR REPLACE INTO graph_metadata (key, value) VALUES (?, ?)",
            (key, json.dumps(result)),
        )
        await db.commit()

    async def get_scan_result(self, sandbox_id: str) -> dict | None:
        """
        Get the stored scan result.

        Args:
            sandbox_id: Sandbox ID

        Returns:
            Scan result dictionary or None if not found
        """
        db = await self._get_db()
        key = f"scan_result_{sandbox_id}"
        async with db.execute(
            "SELECT value FROM graph_metadata WHERE key = ?", (key,)
        ) as cursor:
            row = await cursor.fetchone()
            if row:
                return json.loads(row["value"])
        return None

    # ============== Cleanup Operations ==============

    async def clear_sandbox(self, sandbox_id: str) -> int:
        """Clear all agents and related data for a sandbox."""
        agents = await self.list_agents(sandbox_id)
        for agent in agents:
            await self.delete_agent(agent.agent_id)

        # Clear sandbox metadata (root_agent_id and scan_result)
        db = await self._get_db()
        root_key = f"root_agent_id_{sandbox_id}"
        scan_key = f"scan_result_{sandbox_id}"
        await db.execute(
            "DELETE FROM graph_metadata WHERE key IN (?, ?)",
            (root_key, scan_key),
        )
        await db.commit()

        return len(agents)

    async def close(self) -> None:
        """Close the database connection."""
        if self._db:
            await self._db.close()
            self._db = None
            self._initialized = False

    # ============== Helper Methods ==============

    def _row_to_agent(self, row: aiosqlite.Row) -> Agent:
        """Convert a database row to an Agent object."""
        return Agent(
            agent_id=row["agent_id"],
            name=row["name"],
            task=row["task"],
            status=AgentStatus(row["status"]),
            parent_id=row["parent_id"],
            sandbox_id=row["sandbox_id"],
            prompt_modules=json.loads(row["prompt_modules"]) if row["prompt_modules"] else [],
            inherit_context=bool(row["inherit_context"]),
            max_iterations=row["max_iterations"],
            iteration=row["iteration"],
            waiting_reason=row["waiting_reason"] or "",
            created_at=datetime.fromisoformat(row["created_at"]),
            started_at=datetime.fromisoformat(row["started_at"]) if row["started_at"] else None,
            finished_at=datetime.fromisoformat(row["finished_at"]) if row["finished_at"] else None,
            result=json.loads(row["result"]) if row["result"] else None,
            error=row["error"],
            messages_key=row["messages_key"],
        )

    def _row_to_message(self, row: aiosqlite.Row) -> Message:
        """Convert a database row to a Message object."""
        return Message(
            message_id=row["message_id"],
            from_agent_id=row["from_agent_id"],
            to_agent_id=row["to_agent_id"],
            content=row["content"],
            message_type=row["message_type"],
            priority=row["priority"],
            timestamp=datetime.fromisoformat(row["timestamp"]),
            delivered=bool(row["delivered"]),
            read=bool(row["read"]),
        )


# Global singleton instance
agent_store = AgentStateStore.get_instance()
