"""Strix Sandbox MCP Server - Main entry point."""

from mcp.server.fastmcp import FastMCP

import json

from strix_sandbox.tools import sandbox, browser, terminal, python_exec, proxy, findings, files
from strix_sandbox.tools.agents import tools as agent_tools
from strix_sandbox import prompts

mcp = FastMCP(
    name="strix-sandbox",
    instructions="Sandboxed security testing tools for Claude Code. Provides browser automation, HTTP proxy, terminal execution, Python execution, and findings tracking.",
)


# ============== Sandbox Management Tools ==============


@mcp.tool()
async def sandbox_create(
    name: str = "default",
    with_proxy: bool = True,
    with_browser: bool = True,
) -> dict:
    """
    Create an isolated sandbox environment for security testing.

    Args:
        name: Sandbox name (default: "default")
        with_proxy: Start mitmproxy for traffic interception (default: True)
        with_browser: Pre-launch Playwright browser (default: True)

    Returns:
        sandbox_id, status, proxy_port, workspace_path
    """
    return await sandbox.create(name, with_proxy, with_browser)


@mcp.tool()
async def sandbox_destroy(sandbox_id: str) -> dict:
    """
    Destroy a sandbox environment and cleanup all resources.

    Args:
        sandbox_id: ID of the sandbox to destroy
    """
    return await sandbox.destroy(sandbox_id)


@mcp.tool()
async def sandbox_status(sandbox_id: str = "default") -> dict:
    """
    Get status of a sandbox environment including resource usage.

    Args:
        sandbox_id: ID of the sandbox (default: "default")

    Returns:
        status, uptime, cpu_percent, memory_mb, active tools
    """
    return await sandbox.status(sandbox_id)


# ============== Browser Tools (Playwright) ==============


@mcp.tool()
async def browser_launch(sandbox_id: str = "default") -> dict:
    """
    Launch a Chromium browser in the sandbox.

    Args:
        sandbox_id: Sandbox ID

    Returns:
        browser_id, status
    """
    return await browser.launch(sandbox_id)


@mcp.tool()
async def browser_goto(
    url: str,
    wait_until: str = "domcontentloaded",
    sandbox_id: str = "default",
) -> dict:
    """
    Navigate browser to a URL.

    Args:
        url: Target URL to navigate to
        wait_until: Wait condition - "load", "domcontentloaded", or "networkidle"
        sandbox_id: Sandbox ID

    Returns:
        current_url, title, screenshot (base64)
    """
    return await browser.goto(sandbox_id, url, wait_until)


@mcp.tool()
async def browser_click(
    coordinate: str,
    sandbox_id: str = "default",
) -> dict:
    """
    Click at coordinates on the page.

    Args:
        coordinate: Click position as "x,y" (e.g., "100,200")
        sandbox_id: Sandbox ID

    Returns:
        success, screenshot (base64)
    """
    return await browser.click(sandbox_id, coordinate)


@mcp.tool()
async def browser_type(
    text: str,
    sandbox_id: str = "default",
) -> dict:
    """
    Type text into the currently focused element.

    Args:
        text: Text to type
        sandbox_id: Sandbox ID

    Returns:
        success, screenshot (base64)
    """
    return await browser.type_text(sandbox_id, text)


@mcp.tool()
async def browser_scroll(
    direction: str = "down",
    sandbox_id: str = "default",
) -> dict:
    """
    Scroll the page up or down.

    Args:
        direction: Scroll direction - "up" or "down"
        sandbox_id: Sandbox ID

    Returns:
        success, screenshot (base64)
    """
    return await browser.scroll(sandbox_id, direction)


@mcp.tool()
async def browser_screenshot(sandbox_id: str = "default") -> dict:
    """
    Take a screenshot of the current page.

    Args:
        sandbox_id: Sandbox ID

    Returns:
        screenshot (base64), url, title
    """
    return await browser.screenshot(sandbox_id)


@mcp.tool()
async def browser_execute_js(
    code: str,
    sandbox_id: str = "default",
) -> dict:
    """
    Execute JavaScript code in the browser context.

    Args:
        code: JavaScript code to execute
        sandbox_id: Sandbox ID

    Returns:
        result, console_output, screenshot (base64)
    """
    return await browser.execute_js(sandbox_id, code)


@mcp.tool()
async def browser_new_tab(
    url: str = "",
    sandbox_id: str = "default",
) -> dict:
    """
    Open a new browser tab.

    Args:
        url: Optional URL to open in new tab
        sandbox_id: Sandbox ID

    Returns:
        tab_id, url
    """
    return await browser.new_tab(sandbox_id, url if url else None)


@mcp.tool()
async def browser_switch_tab(
    tab_id: str,
    sandbox_id: str = "default",
) -> dict:
    """
    Switch to a different browser tab.

    Args:
        tab_id: ID of the tab to switch to
        sandbox_id: Sandbox ID

    Returns:
        success, current_tab_id, screenshot (base64)
    """
    return await browser.switch_tab(sandbox_id, tab_id)


@mcp.tool()
async def browser_close_tab(
    tab_id: str,
    sandbox_id: str = "default",
) -> dict:
    """
    Close a browser tab.

    Args:
        tab_id: ID of the tab to close
        sandbox_id: Sandbox ID

    Returns:
        success, remaining_tabs
    """
    return await browser.close_tab(sandbox_id, tab_id)


@mcp.tool()
async def browser_get_source(sandbox_id: str = "default") -> dict:
    """
    Get the HTML source of the current page.

    Args:
        sandbox_id: Sandbox ID

    Returns:
        html (truncated to 20KB), url, title
    """
    return await browser.get_source(sandbox_id)


@mcp.tool()
async def browser_close(sandbox_id: str = "default") -> dict:
    """
    Close the browser entirely.

    Args:
        sandbox_id: Sandbox ID

    Returns:
        success
    """
    return await browser.close(sandbox_id)


# ============== Terminal Tools (tmux) ==============


@mcp.tool()
async def terminal_execute(
    command: str,
    timeout: int = 60,
    session_id: str = "default",
    sandbox_id: str = "default",
) -> dict:
    """
    Execute a command in the sandbox terminal.

    Args:
        command: Command to execute
        timeout: Timeout in seconds (max 60)
        session_id: Terminal session ID for persistent sessions
        sandbox_id: Sandbox ID

    Returns:
        output, exit_code, working_directory
    """
    return await terminal.execute(sandbox_id, session_id, command, timeout)


@mcp.tool()
async def terminal_send_input(
    input_text: str,
    session_id: str = "default",
    sandbox_id: str = "default",
) -> dict:
    """
    Send input to a running process in the terminal.

    Args:
        input_text: Text or special key to send (e.g., "C-c" for Ctrl+C, "Enter")
        session_id: Terminal session ID
        sandbox_id: Sandbox ID

    Returns:
        output
    """
    return await terminal.send_input(sandbox_id, session_id, input_text)


# ============== Python Execution Tools (IPython) ==============


@mcp.tool()
async def python_execute(
    code: str,
    timeout: int = 30,
    session_id: str = "default",
    sandbox_id: str = "default",
) -> dict:
    """
    Execute Python code in an IPython session.

    Args:
        code: Python code to execute
        timeout: Timeout in seconds (max 60)
        session_id: Python session ID for variable persistence
        sandbox_id: Sandbox ID

    Returns:
        output, result, variables (optional)
    """
    return await python_exec.execute(sandbox_id, session_id, code, timeout)


@mcp.tool()
async def python_session(
    action: str,
    session_id: str = "default",
    sandbox_id: str = "default",
) -> dict:
    """
    Manage Python sessions.

    Args:
        action: "new" to create, "list" to list all, "close" to terminate
        session_id: Session ID (for close action)
        sandbox_id: Sandbox ID

    Returns:
        sessions (for list), session_id (for new)
    """
    return await python_exec.manage_session(sandbox_id, action, session_id)


# ============== Proxy Tools (mitmproxy) ==============


@mcp.tool()
async def proxy_start(sandbox_id: str = "default") -> dict:
    """
    Start or restart mitmproxy in the sandbox.

    Args:
        sandbox_id: Sandbox ID

    Returns:
        proxy_port, status
    """
    return await proxy.start(sandbox_id)


@mcp.tool()
async def proxy_list_requests(
    filter: str = "",
    limit: int = 50,
    sort_by: str = "timestamp",
    sort_order: str = "desc",
    sandbox_id: str = "default",
) -> dict:
    """
    List captured HTTP requests from the proxy.

    Args:
        filter: Filter expression (e.g., "host contains example.com", "method = POST")
        limit: Maximum number of requests to return
        sort_by: Sort field - "timestamp", "host", "method", "status_code"
        sort_order: Sort order - "asc" or "desc"
        sandbox_id: Sandbox ID

    Returns:
        requests (list), total_count
    """
    return await proxy.list_requests(
        sandbox_id, filter if filter else None, limit, sort_by, sort_order
    )


@mcp.tool()
async def proxy_view_request(
    request_id: str,
    part: str = "request",
    sandbox_id: str = "default",
) -> dict:
    """
    View details of a captured request including full headers and body.

    Args:
        request_id: ID of the request to view
        part: "request" or "response"
        sandbox_id: Sandbox ID

    Returns:
        headers, body, metadata
    """
    return await proxy.view_request(sandbox_id, request_id, part)


@mcp.tool()
async def proxy_send_request(
    method: str,
    url: str,
    headers: dict = None,
    body: str = "",
    timeout: int = 30,
    sandbox_id: str = "default",
) -> dict:
    """
    Send an HTTP request through the proxy.

    Args:
        method: HTTP method (GET, POST, PUT, DELETE, PATCH, etc.)
        url: Target URL
        headers: Request headers as dict
        body: Request body
        timeout: Request timeout in seconds
        sandbox_id: Sandbox ID

    Returns:
        status_code, headers, body, response_time
    """
    return await proxy.send_request(sandbox_id, method, url, headers, body, timeout)


@mcp.tool()
async def proxy_repeat_request(
    request_id: str,
    modifications: dict = None,
    sandbox_id: str = "default",
) -> dict:
    """
    Repeat a captured request with optional modifications.

    Args:
        request_id: ID of the request to repeat
        modifications: Changes to apply - {url, headers, body, params}
        sandbox_id: Sandbox ID

    Returns:
        status_code, headers, body, response_time
    """
    return await proxy.repeat_request(sandbox_id, request_id, modifications)


@mcp.tool()
async def proxy_set_scope(
    allowlist: list = None,
    denylist: list = None,
    sandbox_id: str = "default",
) -> dict:
    """
    Set the proxy interception scope to filter captured traffic.

    Args:
        allowlist: Patterns to include (e.g., ["*.example.com", "api.target.com"])
        denylist: Patterns to exclude (e.g., ["*.google.com"])
        sandbox_id: Sandbox ID

    Returns:
        scope_config
    """
    return await proxy.set_scope(sandbox_id, allowlist, denylist)


@mcp.tool()
async def proxy_get_sitemap(sandbox_id: str = "default") -> dict:
    """
    Get the discovered sitemap from captured requests.

    Args:
        sandbox_id: Sandbox ID

    Returns:
        sitemap (hierarchical structure of discovered endpoints)
    """
    return await proxy.get_sitemap(sandbox_id)


# ============== Findings Tracking Tools ==============


@mcp.tool()
async def finding_create(
    title: str,
    severity: str,
    description: str,
    evidence: str = "",
    remediation: str = "",
    sandbox_id: str = "default",
) -> dict:
    """
    Record a security finding/vulnerability.

    Args:
        title: Finding title
        severity: Severity level - "critical", "high", "medium", "low", "info"
        description: Detailed description of the vulnerability
        evidence: Proof of concept or evidence (code, request/response, etc.)
        remediation: Suggested fix or mitigation
        sandbox_id: Sandbox ID

    Returns:
        finding_id, created_at
    """
    return await findings.create(sandbox_id, title, severity, description, evidence, remediation)


@mcp.tool()
async def finding_list(
    severity: str = "",
    search: str = "",
    sandbox_id: str = "default",
) -> dict:
    """
    List recorded security findings.

    Args:
        severity: Filter by severity level
        search: Search in title and description
        sandbox_id: Sandbox ID

    Returns:
        findings (list), total_count
    """
    return await findings.list_findings(
        sandbox_id, severity if severity else None, search if search else None
    )


@mcp.tool()
async def finding_update(
    finding_id: str,
    title: str = "",
    severity: str = "",
    description: str = "",
    evidence: str = "",
    remediation: str = "",
    sandbox_id: str = "default",
) -> dict:
    """
    Update an existing finding.

    Args:
        finding_id: ID of finding to update
        title: New title (optional)
        severity: New severity (optional)
        description: New description (optional)
        evidence: New evidence (optional)
        remediation: New remediation (optional)
        sandbox_id: Sandbox ID

    Returns:
        success, updated_at
    """
    return await findings.update(
        sandbox_id,
        finding_id,
        title if title else None,
        severity if severity else None,
        description if description else None,
        evidence if evidence else None,
        remediation if remediation else None,
    )


@mcp.tool()
async def finding_delete(
    finding_id: str,
    sandbox_id: str = "default",
) -> dict:
    """
    Delete a finding.

    Args:
        finding_id: ID of finding to delete
        sandbox_id: Sandbox ID

    Returns:
        success
    """
    return await findings.delete(sandbox_id, finding_id)


@mcp.tool()
async def finding_export(
    format: str = "markdown",
    sandbox_id: str = "default",
) -> dict:
    """
    Export all findings as a report.

    Args:
        format: Export format - "markdown", "json", or "html"
        sandbox_id: Sandbox ID

    Returns:
        report_content, filename, finding_count
    """
    return await findings.export(sandbox_id, format)


# ============== File Operation Tools ==============


@mcp.tool()
async def file_read(
    path: str,
    sandbox_id: str = "default",
) -> dict:
    """
    Read a file from the sandbox workspace.

    Args:
        path: File path (relative to /workspace)
        sandbox_id: Sandbox ID

    Returns:
        content, size, encoding
    """
    return await files.read(sandbox_id, path)


@mcp.tool()
async def file_write(
    path: str,
    content: str,
    sandbox_id: str = "default",
) -> dict:
    """
    Write content to a file in the sandbox workspace.

    Args:
        path: File path (relative to /workspace)
        content: Content to write
        sandbox_id: Sandbox ID

    Returns:
        success, size
    """
    return await files.write(sandbox_id, path, content)


@mcp.tool()
async def file_search(
    pattern: str,
    path: str = ".",
    sandbox_id: str = "default",
) -> dict:
    """
    Search for files or content using ripgrep.

    Args:
        pattern: Search pattern (regex)
        path: Directory to search (relative to /workspace)
        sandbox_id: Sandbox ID

    Returns:
        matches (list of {file, line, content})
    """
    return await files.search(sandbox_id, pattern, path)


@mcp.tool()
async def file_str_replace(
    path: str,
    old_str: str,
    new_str: str,
    sandbox_id: str = "default",
) -> dict:
    """
    Replace an exact string in a file (must be unique).

    The old_str must appear exactly once in the file. Include enough
    surrounding context (whitespace, nearby code) to make the match unique.

    Args:
        path: File path relative to /workspace
        old_str: String to find (must be unique in file)
        new_str: Replacement string
        sandbox_id: Sandbox ID

    Returns:
        success, message, replacements
    """
    return await files.str_replace(sandbox_id, path, old_str, new_str)


@mcp.tool()
async def file_list(
    path: str = ".",
    recursive: bool = False,
    sandbox_id: str = "default",
) -> dict:
    """
    List files and directories in the sandbox workspace.

    Args:
        path: Directory path relative to /workspace (default: root)
        recursive: Include subdirectories recursively
        sandbox_id: Sandbox ID

    Returns:
        files, directories, total_files, total_dirs
    """
    return await files.list_dir(sandbox_id, path, recursive)


@mcp.tool()
async def file_view(
    path: str,
    start_line: int | None = None,
    end_line: int | None = None,
    sandbox_id: str = "default",
) -> dict:
    """
    View a file with optional line range (1-indexed, with line numbers).

    More powerful than file_read - shows line numbers and supports ranges.
    Use -1 for end_line to read until the end of the file.

    Args:
        path: File path relative to /workspace
        start_line: Starting line number (1-indexed, default: 1)
        end_line: Ending line number (inclusive, -1 = end of file)
        sandbox_id: Sandbox ID

    Returns:
        content (with line numbers), total_lines, viewed_range
    """
    return await files.view(sandbox_id, path, start_line, end_line)


@mcp.tool()
async def file_insert(
    path: str,
    insert_line: int,
    new_str: str,
    sandbox_id: str = "default",
) -> dict:
    """
    Insert text after a specified line number.

    Args:
        path: File path relative to /workspace
        insert_line: Line number to insert after (0 = at beginning)
        new_str: Text to insert
        sandbox_id: Sandbox ID

    Returns:
        success, message, new_total_lines
    """
    return await files.insert_lines(sandbox_id, path, insert_line, new_str)


# ============== Utility Tools ==============


@mcp.tool()
async def think(thought: str) -> dict:
    """
    Record a reasoning step for structured thinking (no-op tool).

    Args:
        thought: The reasoning or thought to record

    Returns:
        recorded, length
    """
    return {"recorded": True, "length": len(thought)}


# ============== Prompt Module Tools ==============


@mcp.tool()
async def prompt_modules_list() -> dict:
    """
    List all available prompt modules for specialized security testing.

    Use this to discover what specialized knowledge modules are available
    before creating agents with specific expertise.

    Modules provide deep knowledge about:
    - Vulnerabilities (SQL injection, XSS, CSRF, IDOR, RCE, etc.)
    - Frameworks (FastAPI, NextJS)
    - Technologies (Firebase, Supabase)
    - Protocols (GraphQL)

    Returns:
        available_modules (by category), total_count, description
    """
    available = prompts.get_available_prompt_modules()
    total = sum(len(modules) for modules in available.values())

    return {
        "success": True,
        "available_modules": available,
        "total_count": total,
        "description": prompts.generate_modules_description(),
    }


@mcp.tool()
async def prompt_module_view(module_name: str) -> dict:
    """
    View the content of a specific prompt module.

    Use this to see what specialized knowledge a module provides
    before deciding to use it with an agent.

    Args:
        module_name: Name of the prompt module (e.g., "sql_injection", "xss")

    Returns:
        content, module_name, length, success
    """
    content = prompts.load_prompt_module(module_name)

    if content is None:
        available = prompts.get_all_module_names()
        return {
            "success": False,
            "error": f"Module '{module_name}' not found",
            "available_modules": sorted(available),
        }

    return {
        "success": True,
        "module_name": module_name,
        "content": content,
        "length": len(content),
    }


# ============== Multi-Agent Coordination Tools ==============


@mcp.tool()
async def agent_create(
    task: str,
    name: str,
    caller_agent_id: str = "",
    sandbox_id: str = "default",
    inherit_context: bool = True,
    prompt_modules: str = "",
) -> dict:
    """
    Create and spawn a new agent to handle a specific subtask.

    Use this to delegate complex subtasks to specialized agents. Each agent
    operates independently and can communicate via messages.

    Args:
        task: The specific task/objective for the new agent
        name: Human-readable name for the agent (e.g., "SQL Injection Tester")
        caller_agent_id: ID of the parent agent creating this subagent
        sandbox_id: Sandbox to run in (default: "default")
        inherit_context: Whether to inherit parent's conversation history
        prompt_modules: Comma-separated prompt modules (max 5)

    Returns:
        agent_id, success, message, agent_info
    """
    return await agent_tools.create_agent(
        caller_agent_id=caller_agent_id,
        task=task,
        name=name,
        sandbox_id=sandbox_id,
        inherit_context=inherit_context,
        prompt_modules=prompt_modules,
    )


@mcp.tool()
async def agent_send_message(
    target_agent_id: str,
    message: str,
    caller_agent_id: str = "",
    message_type: str = "information",
    priority: str = "normal",
) -> dict:
    """
    Send a message to another agent for coordination.

    Use this for inter-agent communication: sharing findings, requesting
    information, or coordinating tasks.

    Args:
        target_agent_id: ID of the agent to send message to
        message: The message content
        caller_agent_id: ID of the sending agent
        message_type: Type - "query", "instruction", "information"
        priority: Priority - "low", "normal", "high", "urgent"

    Returns:
        success, message_id, delivery_status, target_agent
    """
    return await agent_tools.send_message_to_agent(
        caller_agent_id=caller_agent_id,
        target_agent_id=target_agent_id,
        message=message,
        message_type=message_type,
        priority=priority,
    )


@mcp.tool()
async def agent_finish(
    result_summary: str,
    caller_agent_id: str = "",
    findings: str = "",
    success: bool = True,
    report_to_parent: bool = True,
    final_recommendations: str = "",
) -> dict:
    """
    Mark a subagent's task as completed and report to parent.

    IMPORTANT: Only subagents can use this. Root agents must use a different
    completion method.

    Args:
        result_summary: Summary of what was accomplished
        caller_agent_id: ID of the finishing agent
        findings: JSON array of findings (e.g., '["finding1", "finding2"]')
        success: Whether task completed successfully
        report_to_parent: Whether to send results to parent
        final_recommendations: JSON array of recommendations

    Returns:
        agent_completed, parent_notified, completion_summary
    """
    findings_list = json.loads(findings) if findings else None
    recommendations_list = json.loads(final_recommendations) if final_recommendations else None

    return await agent_tools.agent_finish(
        caller_agent_id=caller_agent_id,
        result_summary=result_summary,
        findings=findings_list,
        success=success,
        report_to_parent=report_to_parent,
        final_recommendations=recommendations_list,
    )


@mcp.tool()
async def agent_wait_for_message(
    caller_agent_id: str = "",
    reason: str = "Waiting for messages from other agents",
    timeout: int = 600,
) -> dict:
    """
    Pause agent execution until receiving a message.

    Use this when waiting for subagents to complete or for coordination
    messages from other agents.

    Args:
        caller_agent_id: ID of the waiting agent
        reason: Explanation for waiting (for logging)
        timeout: Maximum wait time in seconds (default: 600)

    Returns:
        success, status, messages_received, messages, agent_info
    """
    return await agent_tools.wait_for_message(
        caller_agent_id=caller_agent_id,
        reason=reason,
        timeout=timeout,
    )


@mcp.tool()
async def agent_view_graph(
    caller_agent_id: str = "",
    sandbox_id: str = "default",
) -> dict:
    """
    View the current agent graph showing all agents and relationships.

    Use this to understand the current state of all agents, their tasks,
    and hierarchical relationships.

    Args:
        caller_agent_id: ID of the viewing agent (for "you are here" marker)
        sandbox_id: Sandbox to view (default: "default")

    Returns:
        graph_structure (text tree), summary (statistics)
    """
    return await agent_tools.view_agent_graph(
        caller_agent_id=caller_agent_id,
        sandbox_id=sandbox_id,
    )


@mcp.tool()
async def agent_stop(agent_id: str) -> dict:
    """
    Stop a running agent.

    Args:
        agent_id: ID of the agent to stop

    Returns:
        success, message
    """
    return await agent_tools.stop_agent(agent_id)


@mcp.tool()
async def agent_status(agent_id: str) -> dict:
    """
    Get detailed status of an agent.

    Args:
        agent_id: ID of the agent

    Returns:
        agent details, pending_messages count
    """
    return await agent_tools.get_agent_status(agent_id)


@mcp.tool()
async def agent_clear_graph(sandbox_id: str = "default") -> dict:
    """
    Clear all agents for a sandbox.

    Use this to reset the agent graph when starting fresh.

    Args:
        sandbox_id: Sandbox to clear (default: "default")

    Returns:
        success, count of agents cleared
    """
    return await agent_tools.clear_agent_graph(sandbox_id)


@mcp.tool()
async def scan_finish(
    content: str,
    caller_agent_id: str = "",
    sandbox_id: str = "default",
    success: bool = True,
) -> dict:
    """
    Complete the main security scan and generate final report.

    IMPORTANT: This tool can ONLY be used by the root/main agent.
    Subagents must use agent_finish instead.

    IMPORTANT: This tool will NOT allow finishing if any agents are still
    running or waiting. You must wait for all agents to complete first.

    Use this tool when:
    - You are the main/root agent conducting the security assessment
    - ALL subagents have completed their tasks
    - You have completed all testing phases
    - You are ready to conclude the entire security assessment

    Put ALL details in the content - methodology, tools used, vulnerability counts,
    key findings, recommendations, compliance notes, risk assessments, next steps, etc.

    Args:
        content: Complete scan report including executive summary, methodology,
                 findings, vulnerability details, recommendations, and conclusions
        caller_agent_id: ID of the root agent (leave empty for external calls)
        sandbox_id: Sandbox ID (default: "default")
        success: Whether the scan completed successfully without critical errors

    Returns:
        success, scan_completed, message, sandbox_id
    """
    return await agent_tools.finish_scan(
        caller_agent_id=caller_agent_id,
        content=content,
        sandbox_id=sandbox_id,
        success=success,
    )


# ============== Server Entry Point ==============


def main() -> None:
    """Run the MCP server."""
    mcp.run()


if __name__ == "__main__":
    main()
