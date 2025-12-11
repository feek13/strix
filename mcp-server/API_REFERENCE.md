# API Reference

Complete reference for all 50 MCP tools provided by strix-sandbox.

## Table of Contents

- [Sandbox Management](#sandbox-management)
- [Browser Tools](#browser-tools)
- [Terminal Tools](#terminal-tools)
- [Python Execution](#python-execution)
- [Proxy Tools](#proxy-tools)
- [Findings Tracking](#findings-tracking)
- [File Operations](#file-operations)
- [Utility Tools](#utility-tools)
- [Prompt Modules](#prompt-modules)
- [Multi-Agent Coordination](#multi-agent-coordination)

---

## Sandbox Management

### `sandbox_create`

Create an isolated sandbox environment for security testing.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `name` | string | `"default"` | Sandbox name |
| `with_proxy` | boolean | `true` | Start mitmproxy for traffic interception |
| `with_browser` | boolean | `true` | Pre-launch Playwright browser |

**Returns:** `sandbox_id`, `status`, `proxy_port`, `workspace_path`

---

### `sandbox_destroy`

Destroy a sandbox environment and cleanup all resources.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `sandbox_id` | string | Yes | ID of the sandbox to destroy |

**Returns:** `success`, `message`

---

### `sandbox_status`

Get status of a sandbox environment including resource usage.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `sandbox_id` | string | `"default"` | ID of the sandbox |

**Returns:** `status`, `uptime`, `cpu_percent`, `memory_mb`, `active_tools`

---

## Browser Tools

### `browser_launch`

Launch a Chromium browser in the sandbox.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `sandbox_id` | string | `"default"` | Sandbox ID |

**Returns:** `browser_id`, `status`

---

### `browser_goto`

Navigate browser to a URL.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `url` | string | Required | Target URL to navigate to |
| `wait_until` | string | `"domcontentloaded"` | Wait condition: `"load"`, `"domcontentloaded"`, `"networkidle"` |
| `sandbox_id` | string | `"default"` | Sandbox ID |

**Returns:** `current_url`, `title`, `screenshot` (base64)

---

### `browser_click`

Click at coordinates on the page.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `coordinate` | string | Required | Click position as `"x,y"` (e.g., `"100,200"`) |
| `sandbox_id` | string | `"default"` | Sandbox ID |

**Returns:** `success`, `screenshot` (base64)

---

### `browser_type`

Type text into the currently focused element.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `text` | string | Required | Text to type |
| `sandbox_id` | string | `"default"` | Sandbox ID |

**Returns:** `success`, `screenshot` (base64)

---

### `browser_scroll`

Scroll the page up or down.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `direction` | string | `"down"` | Scroll direction: `"up"` or `"down"` |
| `sandbox_id` | string | `"default"` | Sandbox ID |

**Returns:** `success`, `screenshot` (base64)

---

### `browser_screenshot`

Take a screenshot of the current page.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `sandbox_id` | string | `"default"` | Sandbox ID |

**Returns:** `screenshot` (base64), `url`, `title`

---

### `browser_execute_js`

Execute JavaScript code in the browser context.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `code` | string | Required | JavaScript code to execute |
| `sandbox_id` | string | `"default"` | Sandbox ID |

**Returns:** `result`, `console_output`, `screenshot` (base64)

---

### `browser_new_tab`

Open a new browser tab.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `url` | string | `""` | Optional URL to open in new tab |
| `sandbox_id` | string | `"default"` | Sandbox ID |

**Returns:** `tab_id`, `url`

---

### `browser_switch_tab`

Switch to a different browser tab.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `tab_id` | string | Required | ID of the tab to switch to |
| `sandbox_id` | string | `"default"` | Sandbox ID |

**Returns:** `success`, `current_tab_id`, `screenshot` (base64)

---

### `browser_close_tab`

Close a browser tab.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `tab_id` | string | Required | ID of the tab to close |
| `sandbox_id` | string | `"default"` | Sandbox ID |

**Returns:** `success`, `remaining_tabs`

---

### `browser_get_source`

Get the HTML source of the current page.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `sandbox_id` | string | `"default"` | Sandbox ID |

**Returns:** `html` (truncated to 20KB), `url`, `title`

---

### `browser_close`

Close the browser entirely.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `sandbox_id` | string | `"default"` | Sandbox ID |

**Returns:** `success`

---

## Terminal Tools

### `terminal_execute`

Execute a command in the sandbox terminal.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `command` | string | Required | Command to execute |
| `timeout` | integer | `60` | Timeout in seconds (max 60) |
| `session_id` | string | `"default"` | Terminal session ID for persistent sessions |
| `sandbox_id` | string | `"default"` | Sandbox ID |

**Returns:** `output`, `exit_code`, `working_directory`

---

### `terminal_send_input`

Send input to a running process in the terminal.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `input_text` | string | Required | Text or special key to send (e.g., `"C-c"` for Ctrl+C) |
| `session_id` | string | `"default"` | Terminal session ID |
| `sandbox_id` | string | `"default"` | Sandbox ID |

**Returns:** `output`

---

## Python Execution

### `python_execute`

Execute Python code in an IPython session.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `code` | string | Required | Python code to execute |
| `timeout` | integer | `30` | Timeout in seconds (max 60) |
| `session_id` | string | `"default"` | Python session ID for variable persistence |
| `sandbox_id` | string | `"default"` | Sandbox ID |

**Returns:** `output`, `result`, `variables` (optional)

---

### `python_session`

Manage Python sessions.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `action` | string | Required | `"new"` to create, `"list"` to list all, `"close"` to terminate |
| `session_id` | string | `"default"` | Session ID (for close action) |
| `sandbox_id` | string | `"default"` | Sandbox ID |

**Returns:** `sessions` (for list), `session_id` (for new)

---

## Proxy Tools

### `proxy_start`

Start or restart mitmproxy in the sandbox.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `sandbox_id` | string | `"default"` | Sandbox ID |

**Returns:** `proxy_port`, `status`

---

### `proxy_list_requests`

List captured HTTP requests from the proxy.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `filter` | string | `""` | Filter expression (e.g., `"host contains example.com"`) |
| `limit` | integer | `50` | Maximum number of requests to return |
| `sort_by` | string | `"timestamp"` | Sort field: `"timestamp"`, `"host"`, `"method"`, `"status_code"` |
| `sort_order` | string | `"desc"` | Sort order: `"asc"` or `"desc"` |
| `sandbox_id` | string | `"default"` | Sandbox ID |

**Returns:** `requests` (list), `total_count`

---

### `proxy_view_request`

View details of a captured request including full headers and body.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `request_id` | string | Required | ID of the request to view |
| `part` | string | `"request"` | `"request"` or `"response"` |
| `sandbox_id` | string | `"default"` | Sandbox ID |

**Returns:** `headers`, `body`, `metadata`

---

### `proxy_send_request`

Send an HTTP request through the proxy.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `method` | string | Required | HTTP method (GET, POST, PUT, DELETE, PATCH, etc.) |
| `url` | string | Required | Target URL |
| `headers` | object | `null` | Request headers as dict |
| `body` | string | `""` | Request body |
| `timeout` | integer | `30` | Request timeout in seconds |
| `sandbox_id` | string | `"default"` | Sandbox ID |

**Returns:** `status_code`, `headers`, `body`, `response_time`

---

### `proxy_repeat_request`

Repeat a captured request with optional modifications.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `request_id` | string | Required | ID of the request to repeat |
| `modifications` | object | `null` | Changes to apply: `{url, headers, body, params}` |
| `sandbox_id` | string | `"default"` | Sandbox ID |

**Returns:** `status_code`, `headers`, `body`, `response_time`

---

### `proxy_set_scope`

Set the proxy interception scope to filter captured traffic.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `allowlist` | array | `null` | Patterns to include (e.g., `["*.example.com"]`) |
| `denylist` | array | `null` | Patterns to exclude (e.g., `["*.google.com"]`) |
| `sandbox_id` | string | `"default"` | Sandbox ID |

**Returns:** `scope_config`

---

### `proxy_get_sitemap`

Get the discovered sitemap from captured requests.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `sandbox_id` | string | `"default"` | Sandbox ID |

**Returns:** `sitemap` (hierarchical structure of discovered endpoints)

---

## Findings Tracking

### `finding_create`

Record a security finding/vulnerability.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `title` | string | Required | Finding title |
| `severity` | string | Required | `"critical"`, `"high"`, `"medium"`, `"low"`, `"info"` |
| `description` | string | Required | Detailed description of the vulnerability |
| `evidence` | string | `""` | Proof of concept or evidence |
| `remediation` | string | `""` | Suggested fix or mitigation |
| `sandbox_id` | string | `"default"` | Sandbox ID |

**Returns:** `finding_id`, `created_at`

---

### `finding_list`

List recorded security findings.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `severity` | string | `""` | Filter by severity level |
| `search` | string | `""` | Search in title and description |
| `sandbox_id` | string | `"default"` | Sandbox ID |

**Returns:** `findings` (list), `total_count`

---

### `finding_update`

Update an existing finding.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `finding_id` | string | Required | ID of finding to update |
| `title` | string | `""` | New title (optional) |
| `severity` | string | `""` | New severity (optional) |
| `description` | string | `""` | New description (optional) |
| `evidence` | string | `""` | New evidence (optional) |
| `remediation` | string | `""` | New remediation (optional) |
| `sandbox_id` | string | `"default"` | Sandbox ID |

**Returns:** `success`, `updated_at`

---

### `finding_delete`

Delete a finding.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `finding_id` | string | Required | ID of finding to delete |
| `sandbox_id` | string | `"default"` | Sandbox ID |

**Returns:** `success`

---

### `finding_export`

Export all findings as a report.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `format` | string | `"markdown"` | Export format: `"markdown"`, `"json"`, `"html"` |
| `sandbox_id` | string | `"default"` | Sandbox ID |

**Returns:** `report_content`, `filename`, `finding_count`

---

## File Operations

### `file_read`

Read a file from the sandbox workspace.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `path` | string | Required | File path (relative to /workspace) |
| `sandbox_id` | string | `"default"` | Sandbox ID |

**Returns:** `content`, `size`, `encoding`

---

### `file_write`

Write content to a file in the sandbox workspace.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `path` | string | Required | File path (relative to /workspace) |
| `content` | string | Required | Content to write |
| `sandbox_id` | string | `"default"` | Sandbox ID |

**Returns:** `success`, `size`

---

### `file_search`

Search for files or content using ripgrep.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `pattern` | string | Required | Search pattern (regex) |
| `path` | string | `"."` | Directory to search (relative to /workspace) |
| `sandbox_id` | string | `"default"` | Sandbox ID |

**Returns:** `matches` (list of `{file, line, content}`)

---

### `file_str_replace`

Replace an exact string in a file (must be unique).

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `path` | string | Required | File path relative to /workspace |
| `old_str` | string | Required | String to find (must be unique in file) |
| `new_str` | string | Required | Replacement string |
| `sandbox_id` | string | `"default"` | Sandbox ID |

**Returns:** `success`, `message`, `replacements`

---

### `file_list`

List files and directories in the sandbox workspace.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `path` | string | `"."` | Directory path relative to /workspace |
| `recursive` | boolean | `false` | Include subdirectories recursively |
| `sandbox_id` | string | `"default"` | Sandbox ID |

**Returns:** `files`, `directories`, `total_files`, `total_dirs`

---

### `file_view`

View a file with optional line range (1-indexed, with line numbers).

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `path` | string | Required | File path relative to /workspace |
| `start_line` | integer | `null` | Starting line number (1-indexed) |
| `end_line` | integer | `null` | Ending line number (-1 = end of file) |
| `sandbox_id` | string | `"default"` | Sandbox ID |

**Returns:** `content` (with line numbers), `total_lines`, `viewed_range`

---

### `file_insert`

Insert text after a specified line number.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `path` | string | Required | File path relative to /workspace |
| `insert_line` | integer | Required | Line number to insert after (0 = at beginning) |
| `new_str` | string | Required | Text to insert |
| `sandbox_id` | string | `"default"` | Sandbox ID |

**Returns:** `success`, `message`, `new_total_lines`

---

## Utility Tools

### `think`

Record a reasoning step for structured thinking (no-op tool).

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `thought` | string | Required | The reasoning or thought to record |

**Returns:** `recorded`, `length`

---

## Prompt Modules

### `prompt_modules_list`

List all available prompt modules for specialized security testing.

**Parameters:** None

**Returns:** `available_modules` (by category), `total_count`, `description`

---

### `prompt_module_view`

View the content of a specific prompt module.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `module_name` | string | Required | Name of the prompt module (e.g., `"sql_injection"`, `"xss"`) |

**Returns:** `content`, `module_name`, `length`, `success`

---

## Multi-Agent Coordination

### `agent_create`

Create and spawn a new agent to handle a specific subtask.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `task` | string | Required | The specific task/objective for the new agent |
| `name` | string | Required | Human-readable name for the agent |
| `caller_agent_id` | string | `""` | ID of the parent agent creating this subagent |
| `sandbox_id` | string | `"default"` | Sandbox to run in |
| `inherit_context` | boolean | `true` | Whether to inherit parent's conversation history |
| `prompt_modules` | string | `""` | Comma-separated prompt modules (max 5) |

**Returns:** `agent_id`, `success`, `message`, `agent_info`

---

### `agent_send_message`

Send a message to another agent for coordination.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `target_agent_id` | string | Required | ID of the agent to send message to |
| `message` | string | Required | The message content |
| `caller_agent_id` | string | `""` | ID of the sending agent |
| `message_type` | string | `"information"` | `"query"`, `"instruction"`, `"information"` |
| `priority` | string | `"normal"` | `"low"`, `"normal"`, `"high"`, `"urgent"` |

**Returns:** `success`, `message_id`, `delivery_status`, `target_agent`

---

### `agent_finish`

Mark a subagent's task as completed and report to parent.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `result_summary` | string | Required | Summary of what was accomplished |
| `caller_agent_id` | string | `""` | ID of the finishing agent |
| `findings` | string | `""` | JSON array of findings |
| `success` | boolean | `true` | Whether task completed successfully |
| `report_to_parent` | boolean | `true` | Whether to send results to parent |
| `final_recommendations` | string | `""` | JSON array of recommendations |

**Returns:** `agent_completed`, `parent_notified`, `completion_summary`

---

### `agent_wait_for_message`

Pause agent execution until receiving a message.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `caller_agent_id` | string | `""` | ID of the waiting agent |
| `reason` | string | `"Waiting for messages from other agents"` | Explanation for waiting |
| `timeout` | integer | `600` | Maximum wait time in seconds |

**Returns:** `success`, `status`, `messages_received`, `messages`, `agent_info`

---

### `agent_view_graph`

View the current agent graph showing all agents and relationships.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `caller_agent_id` | string | `""` | ID of the viewing agent |
| `sandbox_id` | string | `"default"` | Sandbox to view |

**Returns:** `graph_structure` (text tree), `summary` (statistics)

---

### `agent_stop`

Stop a running agent.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `agent_id` | string | Required | ID of the agent to stop |

**Returns:** `success`, `message`

---

### `agent_status`

Get detailed status of an agent.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `agent_id` | string | Required | ID of the agent |

**Returns:** agent details, `pending_messages` count

---

### `agent_clear_graph`

Clear all agents for a sandbox.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `sandbox_id` | string | `"default"` | Sandbox to clear |

**Returns:** `success`, count of agents cleared

---

### `scan_finish`

Complete the main security scan and generate final report.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `content` | string | Required | Complete scan report including executive summary, methodology, findings, recommendations |
| `caller_agent_id` | string | `""` | ID of the root agent |
| `sandbox_id` | string | `"default"` | Sandbox ID |
| `success` | boolean | `true` | Whether the scan completed successfully |

**Returns:** `success`, `scan_completed`, `message`, `sandbox_id`

**Note:** This tool can ONLY be used by the root/main agent. Subagents must use `agent_finish` instead.
