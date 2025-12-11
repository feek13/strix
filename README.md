# Strix - AI-Powered Security Testing Framework

[![CI](https://github.com/usestrix/strix/actions/workflows/ci.yml/badge.svg)](https://github.com/usestrix/strix/actions/workflows/ci.yml)
[![PyPI version](https://badge.fury.io/py/strix-sandbox.svg)](https://badge.fury.io/py/strix-sandbox)
[![Docker](https://img.shields.io/docker/v/strix/sandbox?label=docker)](https://hub.docker.com/r/strix/sandbox)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Autonomous AI agents for security testing. Strix provides specialized skills for Claude Code that enable comprehensive vulnerability assessment of web applications, APIs, and codebases.

## Quick Start

### One-Click Install

**Linux/macOS:**
```bash
curl -fsSL https://raw.githubusercontent.com/usestrix/strix/main/scripts/install.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/usestrix/strix/main/scripts/install.ps1 | iex
```

### Manual Install

```bash
# 1. Install MCP Server
pip install strix-sandbox

# 2. Configure Claude Code
claude mcp add strix-sandbox --command "strix-sandbox"

# 3. Install Skills Plugin
git clone https://github.com/usestrix/strix.git
cp -r strix/plugin ~/.claude/plugins/strix-security
```

## Usage

After installation, use these commands in Claude Code:

```
/security-test <target>    # Run security assessment
/security-scan <url>       # Quick vulnerability scan
```

Or invoke skills directly:

```
Use the security-recon skill to map the attack surface of https://example.com
```

## Architecture

```
strix/
├── mcp-server/          # MCP Server (strix-sandbox)
│   ├── src/strix_sandbox/
│   │   ├── server.py    # FastMCP server with 50 tools
│   │   └── tools/       # Tool implementations
│   └── container/       # Docker sandbox environment
│
└── plugin/              # Claude Code Plugin
    ├── skills/          # 8 security testing skills
    ├── commands/        # Slash commands
    └── agents/          # Agent definitions
```

## Components

### MCP Server (`strix-sandbox`)

A sandboxed environment providing security testing tools:

| Category | Tools |
|----------|-------|
| **Browser** | `browser_launch`, `browser_goto`, `browser_click`, `browser_type`, `browser_screenshot` |
| **Proxy** | `proxy_start`, `proxy_list_requests`, `proxy_send_request`, `proxy_set_scope` |
| **Terminal** | `terminal_execute`, `terminal_read_output` |
| **File** | `file_read`, `file_write`, `file_search` |
| **Findings** | `finding_create`, `finding_list`, `finding_export` |

**Install:**
```bash
pip install strix-sandbox
# or
docker pull strix/sandbox:latest
```

### Skills Plugin

8 specialized security testing skills:

| Skill | Description |
|-------|-------------|
| `security-recon` | Attack surface mapping & reconnaissance |
| `injection-testing` | SQL, Command, NoSQL injection testing |
| `auth-testing` | Authentication & authorization testing |
| `logic-testing` | Business logic vulnerability testing |
| `platform-testing` | Platform & API security testing |
| `web-security-testing` | Comprehensive web security testing |
| `verification-methods` | PoC verification methods |
| `security-reporting` | Security report generation |

## Requirements

- Python 3.11+
- Claude Code CLI
- Docker (optional, for full sandbox isolation)

## Development

```bash
# Clone repository
git clone https://github.com/usestrix/strix.git
cd strix

# Install MCP server in dev mode
cd mcp-server
pip install -e ".[dev]"

# Run tests
pytest tests/ -m unit -v

# Run linting
ruff check src/
mypy src/
```

## Release

### MCP Server

```bash
# Tag and push
git tag mcp-v0.2.0
git push origin mcp-v0.2.0
# GitHub Actions publishes to PyPI + Docker Hub
```

### Plugin

```bash
# Tag and push
git tag plugin-v1.0.0
git push origin plugin-v1.0.0
# GitHub Actions creates GitHub Release with zip
```

## Documentation

- [MCP Server API Reference](mcp-server/API_REFERENCE.md)
- [MCP Server Changelog](mcp-server/CHANGELOG.md)
- [Plugin README](plugin/README.md)
- [Contributing Guide](CONTRIBUTING.md)

## Security

This tool is designed for authorized security testing only. Always obtain proper authorization before testing any system you don't own.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.
