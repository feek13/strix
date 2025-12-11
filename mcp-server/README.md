# Strix Sandbox MCP Server

Sandboxed security testing tools for Claude Code via MCP (Model Context Protocol).

## Overview

This MCP server provides 35 tools for security testing in isolated Docker containers:

- **Browser Automation** - Playwright-powered web interaction (12 tools)
- **HTTP Proxy** - mitmproxy-based traffic interception (7 tools)
- **Terminal Execution** - tmux-based command execution (2 tools)
- **Python Execution** - IPython-based code execution (2 tools)
- **Findings Tracking** - SQLite-backed vulnerability documentation (5 tools)
- **File Operations** - Workspace file management (3 tools)
- **Sandbox Management** - Container lifecycle control (3 tools)

## Quick Start

### 1. Build the Docker Image

```bash
cd strix-sandbox-mcp
docker compose build
```

### 2. Start the Container

```bash
docker compose up -d
```

### 3. Configure Claude Code

Add the MCP server to your Claude Code configuration:

```bash
claude mcp add strix-sandbox -- python -m strix_sandbox.server
```

Or add to your MCP settings file:

```json
{
  "mcpServers": {
    "strix-sandbox": {
      "command": "python",
      "args": ["-m", "strix_sandbox.server"]
    }
  }
}
```

## Tools Reference

### Sandbox Management

| Tool | Description |
|------|-------------|
| `sandbox_create` | Create an isolated sandbox environment |
| `sandbox_destroy` | Destroy a sandbox and cleanup resources |
| `sandbox_status` | Get status and resource usage of a sandbox |

### Browser Tools

| Tool | Description |
|------|-------------|
| `browser_launch` | Launch a Chromium browser |
| `browser_goto` | Navigate to a URL |
| `browser_click` | Click at coordinates |
| `browser_type` | Type text into focused element |
| `browser_scroll` | Scroll page up/down |
| `browser_screenshot` | Take a screenshot |
| `browser_execute_js` | Execute JavaScript |
| `browser_new_tab` | Open a new tab |
| `browser_switch_tab` | Switch to a different tab |
| `browser_close_tab` | Close a tab |
| `browser_get_source` | Get page HTML source |
| `browser_close` | Close the browser |

### Proxy Tools (mitmproxy)

| Tool | Description |
|------|-------------|
| `proxy_start` | Start/restart the proxy |
| `proxy_list_requests` | List captured HTTP requests |
| `proxy_view_request` | View request/response details |
| `proxy_send_request` | Send an HTTP request |
| `proxy_repeat_request` | Replay a captured request with modifications |
| `proxy_set_scope` | Configure interception scope |
| `proxy_get_sitemap` | Get discovered sitemap |

### Terminal Tools

| Tool | Description |
|------|-------------|
| `terminal_execute` | Execute a shell command |
| `terminal_send_input` | Send input to running process |

### Python Tools

| Tool | Description |
|------|-------------|
| `python_execute` | Execute Python code |
| `python_session` | Manage Python sessions |

### Findings Tools

| Tool | Description |
|------|-------------|
| `finding_create` | Record a security finding |
| `finding_list` | List recorded findings |
| `finding_update` | Update an existing finding |
| `finding_delete` | Delete a finding |
| `finding_export` | Export findings as report |

### File Tools

| Tool | Description |
|------|-------------|
| `file_read` | Read a file from workspace |
| `file_write` | Write content to a file |
| `file_search` | Search files using ripgrep |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Claude Code (Client)                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ MCP Protocol (stdio)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 strix-sandbox MCP Server                     │
│                    (Python + FastMCP)                        │
│                                                             │
│  src/strix_sandbox/                                         │
│  ├── server.py          # MCP tool definitions              │
│  ├── tools/             # Tool implementations              │
│  └── runtime/           # Docker container management       │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP (port 9999)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Docker Container (Sandbox)                 │
│                                                             │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐  │
│  │ Playwright│ │   tmux    │ │  IPython  │ │ mitmproxy │  │
│  │ (Browser) │ │ (Terminal)│ │ (Python)  │ │  (Proxy)  │  │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘  │
│                                                             │
│  container/                                                 │
│  ├── tool_server.py    # FastAPI tool execution server      │
│  ├── browser_instance.py                                    │
│  ├── terminal_session.py                                    │
│  └── python_instance.py                                     │
└─────────────────────────────────────────────────────────────┘
```

## Development

### Prerequisites

- Python 3.12+
- Docker
- Poetry (optional, for local development)

### Local Setup

```bash
# Install dependencies
pip install -e ".[dev]"

# Run the MCP server locally
python -m strix_sandbox.server

# Run tests
pytest tests/
```

### Building Docker Image

```bash
# Build image
docker build -t strix/sandbox-mcp:latest ./container

# Run container
docker run -d --name strix-sandbox \
    -p 9999:9999 -p 8080:8080 \
    -e TOOL_SERVER_TOKEN=your-token \
    --cap-add SYS_ADMIN \
    strix/sandbox-mcp:latest
```

## Security Considerations

- The sandbox container runs with `SYS_ADMIN` capability (required for Playwright)
- All tool execution is isolated within Docker containers
- Authentication is required for the tool server (token-based)
- File operations are restricted to the `/workspace` directory
- Only use for authorized security testing

## License

MIT License - See [LICENSE](LICENSE) for details.

## Related Projects

- [strix-security](../strix-security) - Claude Code Skills for security testing
- [Model Context Protocol](https://github.com/anthropics/model-context-protocol)
