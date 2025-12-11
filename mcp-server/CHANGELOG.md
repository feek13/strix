# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-01-XX

### Added

- Initial MCP server implementation with FastMCP framework
- 50 security testing tools across 10 categories:
  - **Sandbox Management** (3 tools): `sandbox_create`, `sandbox_destroy`, `sandbox_status`
  - **Browser Automation** (12 tools): Playwright-based browser control
  - **Terminal Execution** (2 tools): Command execution with tmux sessions
  - **Python Execution** (2 tools): IPython code execution with session persistence
  - **HTTP Proxy** (7 tools): mitmproxy-based traffic interception
  - **Findings Tracking** (5 tools): Security findings CRUD and export
  - **File Operations** (7 tools): Sandbox workspace file management
  - **Utility** (1 tool): Structured thinking tool
  - **Prompt Modules** (2 tools): Specialized knowledge module management
  - **Multi-Agent Coordination** (10 tools): Agent creation, messaging, and lifecycle
- Docker sandbox isolation for security-sensitive operations
- Async/await patterns throughout for non-blocking execution
- Type hints on all public functions
- Comprehensive docstrings with Args/Returns documentation

### Security

- All code execution isolated in Docker containers
- Workspace directory sandboxing
- Token-based authentication support

### Dependencies

- mcp >= 1.0.0
- fastapi >= 0.109.0
- uvicorn >= 0.27.0
- httpx >= 0.26.0
- pydantic >= 2.5.0
- docker >= 7.0.0
- aiosqlite >= 0.19.0
