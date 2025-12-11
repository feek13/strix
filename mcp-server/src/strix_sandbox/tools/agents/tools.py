"""MCP tool implementations for multi-agent coordination."""

import logging
from datetime import datetime, timezone
from typing import Any

from strix_sandbox import prompts

from .message_bus import message_bus
from .models import Agent, AgentEdge, AgentStatus
from .state_store import agent_store


logger = logging.getLogger(__name__)


async def create_agent(
    caller_agent_id: str,
    task: str,
    name: str,
    sandbox_id: str = "default",
    inherit_context: bool = True,
    prompt_modules: str = "",
) -> dict[str, Any]:
    """
    Create and spawn a new agent to handle a specific subtask.

    Args:
        caller_agent_id: ID of the agent creating this subagent
        task: The specific task for the new agent
        name: Human-readable name for tracking
        sandbox_id: Sandbox to run in
        inherit_context: Whether to inherit parent's conversation history
        prompt_modules: Comma-separated list of prompt modules (max 5)

    Returns:
        dict with agent_id, success, message, agent_info
    """
    try:
        # Parse and validate prompt modules
        module_list: list[str] = []
        loaded_modules: dict[str, str] = {}

        if prompt_modules:
            module_list = [m.strip() for m in prompt_modules.split(",") if m.strip()]
            if len(module_list) > 5:
                return {
                    "success": False,
                    "error": "Cannot specify more than 5 prompt modules",
                    "agent_id": None,
                }

            # Validate module names exist
            validation = prompts.validate_module_names(module_list)
            if validation["invalid"]:
                available = prompts.get_all_module_names()
                return {
                    "success": False,
                    "error": f"Invalid prompt modules: {validation['invalid']}",
                    "available_modules": sorted(available),
                    "agent_id": None,
                }

            # Load module content
            loaded_modules = prompts.load_prompt_modules(module_list)

        # Verify caller agent exists (if provided)
        parent_agent = None
        if caller_agent_id:
            parent_agent = await agent_store.get_agent(caller_agent_id)
            if not parent_agent:
                return {
                    "success": False,
                    "error": f"Caller agent '{caller_agent_id}' not found",
                    "agent_id": None,
                }

        # Create new agent
        agent = Agent(
            name=name,
            task=task,
            parent_id=caller_agent_id if caller_agent_id else None,
            sandbox_id=sandbox_id,
            prompt_modules=module_list,
            inherit_context=inherit_context,
            status=AgentStatus.RUNNING,
            started_at=datetime.now(timezone.utc),
        )
        await agent_store.create_agent(agent)

        # Create delegation edge if there's a parent
        if caller_agent_id:
            edge = AgentEdge(
                from_agent_id=caller_agent_id,
                to_agent_id=agent.agent_id,
                edge_type="delegation",
            )
            await agent_store.create_edge(edge)

        # Set root agent if this is the first agent without a parent
        if not caller_agent_id:
            root_id = await agent_store.get_root_agent_id(sandbox_id)
            if not root_id:
                await agent_store.set_root_agent_id(agent.agent_id, sandbox_id)
        elif parent_agent and parent_agent.parent_id is None:
            # Parent is root, ensure it's set
            root_id = await agent_store.get_root_agent_id(sandbox_id)
            if not root_id:
                await agent_store.set_root_agent_id(caller_agent_id, sandbox_id)

        # Copy inherited conversation history if requested
        if inherit_context and caller_agent_id:
            history = await agent_store.get_conversation_history(caller_agent_id)
            if history:
                await agent_store.add_message_to_history(
                    agent.agent_id, "user", "<inherited_context_from_parent>"
                )
                for msg in history:
                    await agent_store.add_message_to_history(
                        agent.agent_id, msg["role"], msg["content"]
                    )
                await agent_store.add_message_to_history(
                    agent.agent_id, "user", "</inherited_context_from_parent>"
                )

        logger.info(f"Created agent '{name}' ({agent.agent_id}) with task: {task}")

        return {
            "success": True,
            "agent_id": agent.agent_id,
            "message": f"Agent '{name}' created and started",
            "agent_info": {
                "id": agent.agent_id,
                "name": name,
                "status": "running",
                "parent_id": caller_agent_id if caller_agent_id else None,
                "task": task,
                "prompt_modules": module_list,
            },
            "loaded_modules": list(loaded_modules.keys()),
            "module_content": loaded_modules,
        }

    except Exception as e:
        logger.exception(f"Failed to create agent: {e}")
        return {
            "success": False,
            "error": f"Failed to create agent: {e}",
            "agent_id": None,
        }


async def send_message_to_agent(
    caller_agent_id: str,
    target_agent_id: str,
    message: str,
    message_type: str = "information",
    priority: str = "normal",
) -> dict[str, Any]:
    """
    Send a message to another agent for coordination.

    Args:
        caller_agent_id: ID of the sending agent
        target_agent_id: ID of the receiving agent
        message: Message content
        message_type: Type of message (query, instruction, information)
        priority: Priority level (low, normal, high, urgent)

    Returns:
        dict with success, message_id, delivery_status, target_agent
    """
    try:
        # Validate message type
        valid_types = {"query", "instruction", "information"}
        if message_type not in valid_types:
            return {
                "success": False,
                "error": f"Invalid message_type. Must be one of: {', '.join(valid_types)}",
                "message_id": None,
            }

        # Validate priority
        valid_priorities = {"low", "normal", "high", "urgent"}
        if priority not in valid_priorities:
            return {
                "success": False,
                "error": f"Invalid priority. Must be one of: {', '.join(valid_priorities)}",
                "message_id": None,
            }

        # Get sender info (optional - can send from "user" or external)
        sender = None
        sender_name = "External"
        if caller_agent_id:
            sender = await agent_store.get_agent(caller_agent_id)
            if sender:
                sender_name = sender.name

        # Get target info
        target = await agent_store.get_agent(target_agent_id)
        if not target:
            return {
                "success": False,
                "error": f"Target agent '{target_agent_id}' not found",
                "message_id": None,
            }

        # Send message via bus
        msg = await message_bus.send_message(
            from_agent_id=caller_agent_id if caller_agent_id else "external",
            to_agent_id=target_agent_id,
            content=message,
            message_type=message_type,
            priority=priority,
        )

        logger.info(
            f"Message {msg.message_id} sent from '{sender_name}' to '{target.name}'"
        )

        return {
            "success": True,
            "message_id": msg.message_id,
            "message": f"Message sent from '{sender_name}' to '{target.name}'",
            "delivery_status": "delivered",
            "target_agent": {
                "id": target_agent_id,
                "name": target.name,
                "status": target.status.value,
            },
        }

    except ValueError as e:
        return {
            "success": False,
            "error": str(e),
            "message_id": None,
        }
    except Exception as e:
        logger.exception(f"Failed to send message: {e}")
        return {
            "success": False,
            "error": f"Failed to send message: {e}",
            "message_id": None,
        }


async def agent_finish(
    caller_agent_id: str,
    result_summary: str,
    findings: list[str] | None = None,
    success: bool = True,
    report_to_parent: bool = True,
    final_recommendations: list[str] | None = None,
) -> dict[str, Any]:
    """
    Mark a subagent's task as completed and report to parent.

    Args:
        caller_agent_id: ID of the finishing agent
        result_summary: Summary of accomplishments
        findings: List of findings/discoveries
        success: Whether task completed successfully
        report_to_parent: Whether to notify parent agent
        final_recommendations: Recommendations for next steps

    Returns:
        dict with agent_completed, parent_notified, completion_summary
    """
    try:
        agent = await agent_store.get_agent(caller_agent_id)
        if not agent:
            return {
                "agent_completed": False,
                "error": f"Agent '{caller_agent_id}' not found",
                "parent_notified": False,
            }

        if not agent.parent_id:
            return {
                "agent_completed": False,
                "error": "Only subagents can use agent_finish. Root agents must use a different completion method.",
                "parent_notified": False,
            }

        # Update agent status
        agent.status = AgentStatus.COMPLETED if success else AgentStatus.FAILED
        agent.finished_at = datetime.now(timezone.utc)
        agent.result = {
            "summary": result_summary,
            "findings": findings or [],
            "success": success,
            "recommendations": final_recommendations or [],
        }
        await agent_store.update_agent(agent)

        # Clean up agent resources
        await message_bus.cleanup_agent(caller_agent_id)

        # Report to parent if requested
        parent_notified = False
        if report_to_parent and agent.parent_id:
            findings_xml = "\n".join(
                f"        <finding>{f}</finding>" for f in (findings or [])
            )
            recommendations_xml = "\n".join(
                f"        <recommendation>{r}</recommendation>"
                for r in (final_recommendations or [])
            )

            report_message = f"""<agent_completion_report>
    <agent_info>
        <agent_name>{agent.name}</agent_name>
        <agent_id>{agent.agent_id}</agent_id>
        <task>{agent.task}</task>
        <status>{"SUCCESS" if success else "FAILED"}</status>
        <completion_time>{agent.finished_at.isoformat()}</completion_time>
    </agent_info>
    <results>
        <summary>{result_summary}</summary>
        <findings>
{findings_xml}
        </findings>
        <recommendations>
{recommendations_xml}
        </recommendations>
    </results>
</agent_completion_report>"""

            await message_bus.send_message(
                from_agent_id=agent.agent_id,
                to_agent_id=agent.parent_id,
                content=report_message,
                message_type="information",
                priority="high",
            )
            parent_notified = True

        logger.info(
            f"Agent '{agent.name}' ({agent.agent_id}) finished with status: "
            f"{'SUCCESS' if success else 'FAILED'}"
        )

        return {
            "agent_completed": True,
            "parent_notified": parent_notified,
            "completion_summary": {
                "agent_id": agent.agent_id,
                "agent_name": agent.name,
                "task": agent.task,
                "success": success,
                "findings_count": len(findings or []),
                "has_recommendations": bool(final_recommendations),
                "finished_at": agent.finished_at.isoformat(),
            },
        }

    except Exception as e:
        logger.exception(f"Failed to complete agent: {e}")
        return {
            "agent_completed": False,
            "error": f"Failed to complete agent: {e}",
            "parent_notified": False,
        }


async def wait_for_message(
    caller_agent_id: str,
    reason: str = "Waiting for messages from other agents",
    timeout: int = 600,
) -> dict[str, Any]:
    """
    Pause agent execution until receiving a message.

    Args:
        caller_agent_id: ID of the waiting agent
        reason: Explanation for waiting
        timeout: Maximum wait time in seconds

    Returns:
        dict with success, status, messages, agent_info
    """
    try:
        agent = await agent_store.get_agent(caller_agent_id)
        if not agent:
            return {
                "success": False,
                "error": f"Agent '{caller_agent_id}' not found",
                "status": "error",
            }

        # Update agent status to waiting
        agent.status = AgentStatus.WAITING
        agent.waiting_reason = reason
        await agent_store.update_agent(agent)

        logger.info(f"Agent '{agent.name}' ({agent.agent_id}) waiting: {reason}")

        # Wait for messages
        messages = await message_bus.wait_for_message(
            agent_id=caller_agent_id,
            timeout=float(timeout),
        )

        # Process received messages
        received_messages = []
        for msg in messages:
            await message_bus.mark_read(msg.message_id)

            # Get sender name for better context
            sender_name = "External"
            if msg.from_agent_id and msg.from_agent_id != "external":
                sender = await agent_store.get_agent(msg.from_agent_id)
                if sender:
                    sender_name = sender.name

            received_messages.append({
                **msg.to_dict(),
                "sender_name": sender_name,
            })

        # Update agent status back to running
        agent.status = AgentStatus.RUNNING
        agent.waiting_reason = ""
        await agent_store.update_agent(agent)

        logger.info(
            f"Agent '{agent.name}' ({agent.agent_id}) resumed with "
            f"{len(received_messages)} message(s)"
        )

        return {
            "success": True,
            "status": "resumed",
            "messages_received": len(received_messages),
            "messages": received_messages,
            "agent_info": {
                "id": agent.agent_id,
                "name": agent.name,
                "status": "running",
            },
        }

    except Exception as e:
        logger.exception(f"Failed to wait for message: {e}")
        return {
            "success": False,
            "error": f"Failed to wait for message: {e}",
            "status": "error",
        }


async def view_agent_graph(
    caller_agent_id: str = "",
    sandbox_id: str = "default",
) -> dict[str, Any]:
    """
    View the current agent graph with all agents and their relationships.

    Args:
        caller_agent_id: ID of the viewing agent (for "you are here" marker)
        sandbox_id: Sandbox to view graph for

    Returns:
        dict with graph_structure, summary
    """
    try:
        agents = await agent_store.list_agents(sandbox_id)
        summary = await agent_store.get_graph_summary(sandbox_id)
        root_id = await agent_store.get_root_agent_id(sandbox_id)

        # Build agents lookup
        agents_by_id = {a.agent_id: a for a in agents}

        def build_tree(agent_id: str, depth: int = 0) -> list[str]:
            """Recursively build tree structure."""
            lines: list[str] = []
            agent = agents_by_id.get(agent_id)
            if not agent:
                return lines

            indent = "  " * depth
            you_indicator = " <- This is you" if agent_id == caller_agent_id else ""

            lines.append(f"{indent}* {agent.name} ({agent_id}){you_indicator}")
            lines.append(f"{indent}  Task: {agent.task}")
            lines.append(f"{indent}  Status: {agent.status.value}")

            if agent.waiting_reason:
                lines.append(f"{indent}  Waiting: {agent.waiting_reason}")

            # Find children (agents with this agent as parent)
            children = [a for a in agents if a.parent_id == agent_id]

            if children:
                lines.append(f"{indent}  Children:")
                for child in children:
                    lines.extend(build_tree(child.agent_id, depth + 2))

            return lines

        # Build structure starting from root
        structure_lines = ["=== AGENT GRAPH STRUCTURE ==="]

        if root_id and root_id in agents_by_id:
            structure_lines.extend(build_tree(root_id))
        elif agents:
            # Fall back to agents without parents
            root_agents = [a for a in agents if a.parent_id is None]
            if root_agents:
                for root_agent in root_agents:
                    structure_lines.extend(build_tree(root_agent.agent_id))
            else:
                # Just list all agents
                structure_lines.append("(No clear hierarchy detected)")
                for agent in agents:
                    structure_lines.append(f"* {agent.name} ({agent.agent_id})")
                    structure_lines.append(f"  Task: {agent.task}")
                    structure_lines.append(f"  Status: {agent.status.value}")
        else:
            structure_lines.append("No agents in the graph yet")

        return {
            "graph_structure": "\n".join(structure_lines),
            "summary": summary.to_dict(),
        }

    except Exception as e:
        logger.exception(f"Failed to view agent graph: {e}")
        return {
            "error": f"Failed to view agent graph: {e}",
            "graph_structure": "Error retrieving graph structure",
        }


# ============== Additional Utility Functions ==============


async def stop_agent(agent_id: str) -> dict[str, Any]:
    """
    Stop a running agent.

    Args:
        agent_id: ID of the agent to stop

    Returns:
        dict with success, message
    """
    try:
        agent = await agent_store.get_agent(agent_id)
        if not agent:
            return {
                "success": False,
                "error": f"Agent '{agent_id}' not found",
            }

        if agent.status in {AgentStatus.COMPLETED, AgentStatus.FAILED, AgentStatus.STOPPED}:
            return {
                "success": True,
                "message": f"Agent '{agent.name}' was already in terminal state: {agent.status.value}",
            }

        # Update status
        agent.status = AgentStatus.STOPPED
        agent.finished_at = datetime.now(timezone.utc)
        agent.result = {
            "summary": "Agent stopped by user request",
            "success": False,
            "stopped_by_user": True,
        }
        await agent_store.update_agent(agent)

        # Cleanup
        await message_bus.cleanup_agent(agent_id)

        # Notify the agent (wake from waiting)
        await message_bus.notify_agent(agent_id)

        logger.info(f"Agent '{agent.name}' ({agent_id}) stopped")

        return {
            "success": True,
            "message": f"Agent '{agent.name}' stopped",
            "agent_id": agent_id,
        }

    except Exception as e:
        logger.exception(f"Failed to stop agent: {e}")
        return {
            "success": False,
            "error": f"Failed to stop agent: {e}",
        }


async def get_agent_status(agent_id: str) -> dict[str, Any]:
    """
    Get detailed status of an agent.

    Args:
        agent_id: ID of the agent

    Returns:
        dict with agent details
    """
    try:
        agent = await agent_store.get_agent(agent_id)
        if not agent:
            return {
                "success": False,
                "error": f"Agent '{agent_id}' not found",
            }

        # Get pending messages count
        pending_messages = await message_bus.get_pending_messages(agent_id)

        return {
            "success": True,
            "agent": agent.to_dict(),
            "pending_messages": len(pending_messages),
        }

    except Exception as e:
        logger.exception(f"Failed to get agent status: {e}")
        return {
            "success": False,
            "error": f"Failed to get agent status: {e}",
        }


async def clear_agent_graph(sandbox_id: str = "default") -> dict[str, Any]:
    """
    Clear all agents for a sandbox.

    Args:
        sandbox_id: Sandbox to clear

    Returns:
        dict with success, count
    """
    try:
        count = await agent_store.clear_sandbox(sandbox_id)

        logger.info(f"Cleared {count} agents from sandbox '{sandbox_id}'")

        return {
            "success": True,
            "message": f"Cleared {count} agents from sandbox '{sandbox_id}'",
            "count": count,
        }

    except Exception as e:
        logger.exception(f"Failed to clear agent graph: {e}")
        return {
            "success": False,
            "error": f"Failed to clear agent graph: {e}",
        }


# ============== Scan Completion (Root Agent Only) ==============


async def _validate_root_agent(caller_agent_id: str) -> dict[str, Any] | None:
    """
    Validate that the caller is a root agent (not a subagent).

    Args:
        caller_agent_id: ID of the calling agent

    Returns:
        Error dict if validation fails, None if valid
    """
    if not caller_agent_id:
        return None  # External call (no agent identity), allow

    agent = await agent_store.get_agent(caller_agent_id)
    if agent and agent.parent_id is not None:
        return {
            "success": False,
            "message": (
                "This tool can only be used by the root/main agent. "
                "Subagents must use agent_finish instead."
            ),
        }
    return None


def _validate_content(content: str) -> dict[str, Any] | None:
    """
    Validate that scan content is not empty.

    Args:
        content: Scan report content

    Returns:
        Error dict if validation fails, None if valid
    """
    if not content or not content.strip():
        return {"success": False, "message": "Content cannot be empty"}
    return None


async def _check_active_agents(
    caller_agent_id: str,
    sandbox_id: str,
) -> dict[str, Any] | None:
    """
    Check if there are any active agents that would prevent scan completion.

    Args:
        caller_agent_id: ID of the calling agent (to exclude from check)
        sandbox_id: Sandbox to check

    Returns:
        Error dict with details if active agents found, None if all clear
    """
    agents = await agent_store.list_agents(sandbox_id)

    running_agents = []
    waiting_agents = []

    for agent in agents:
        # Skip the caller
        if agent.agent_id == caller_agent_id:
            continue

        if agent.status == AgentStatus.RUNNING:
            running_agents.append({
                "id": agent.agent_id,
                "name": agent.name,
                "task": agent.task,
            })
        elif agent.status == AgentStatus.WAITING:
            waiting_agents.append({
                "id": agent.agent_id,
                "name": agent.name,
            })

    if running_agents or waiting_agents:
        # Build detailed error message (matching original format)
        message_parts = ["Cannot finish scan while other agents are still active:"]

        if running_agents:
            message_parts.append("\n\nRunning agents:")
            for a in running_agents:
                message_parts.append(f"  - {a['name']} ({a['id']}): {a['task']}")

        if waiting_agents:
            message_parts.append("\n\nWaiting agents:")
            for a in waiting_agents:
                message_parts.append(f"  - {a['name']} ({a['id']})")

        message_parts.extend([
            "\n\nSuggested actions:",
            "1. Use agent_wait_for_message to wait for all agents to complete",
            "2. Send messages to agents asking them to finish if urgent",
            "3. Use agent_view_graph to monitor agent status",
        ])

        return {
            "success": False,
            "message": "\n".join(message_parts),
            "active_agents": {
                "running": len(running_agents),
                "waiting": len(waiting_agents),
                "details": {
                    "running": running_agents,
                    "waiting": waiting_agents,
                },
            },
        }

    return None


async def finish_scan(
    caller_agent_id: str,
    content: str,
    sandbox_id: str = "default",
    success: bool = True,
) -> dict[str, Any]:
    """
    Complete the main security scan and generate final report.

    This tool can ONLY be used by the root/main agent. Subagents must use
    agent_finish instead.

    This tool will NOT allow finishing if any agents are still running or waiting.

    Args:
        caller_agent_id: ID of the root agent finishing the scan
        content: Complete scan report (methodology, findings, recommendations, etc.)
        sandbox_id: Sandbox ID
        success: Whether the scan completed successfully

    Returns:
        dict with success, scan_completed, message
    """
    try:
        # Validation 1: Root agent only
        validation_error = await _validate_root_agent(caller_agent_id)
        if validation_error:
            return validation_error

        # Validation 2: Content not empty
        validation_error = _validate_content(content)
        if validation_error:
            return validation_error

        # Validation 3: No active agents
        active_error = await _check_active_agents(caller_agent_id, sandbox_id)
        if active_error:
            return active_error

        # Store scan result
        scan_result = {
            "content": content.strip(),
            "success": success,
            "sandbox_id": sandbox_id,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }

        # If caller is a known agent, update its status and include info
        if caller_agent_id:
            agent = await agent_store.get_agent(caller_agent_id)
            if agent:
                agent.status = AgentStatus.COMPLETED if success else AgentStatus.FAILED
                agent.finished_at = datetime.now(timezone.utc)
                agent.result = {
                    "summary": "Scan completed - final report generated",
                    "success": success,
                }
                await agent_store.update_agent(agent)
                scan_result["root_agent_id"] = caller_agent_id
                scan_result["root_agent_name"] = agent.name

        await agent_store.set_scan_result(sandbox_id, scan_result)

        logger.info(
            f"Scan completed for sandbox '{sandbox_id}': "
            f"{'SUCCESS' if success else 'FAILED'}"
        )

        return {
            "success": True,
            "scan_completed": True,
            "message": "Scan completed successfully" if success else "Scan completed with errors",
            "sandbox_id": sandbox_id,
        }

    except (ValueError, TypeError, KeyError) as e:
        return {
            "success": False,
            "message": f"Failed to complete scan: {e!s}",
        }
    except Exception as e:
        logger.exception(f"Failed to complete scan: {e}")
        return {
            "success": False,
            "error": f"Failed to complete scan: {e}",
        }
