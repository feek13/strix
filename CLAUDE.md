# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Strix is an AI-powered security testing framework for Claude Code. It has three main components: an MCP server providing sandboxed security tools, a Claude Code plugin with specialized security skills, and a web UI for launching/monitoring scans.

## Repository Structure

| Directory | Purpose | Language |
|-----------|---------|----------|
| `mcp-server/` | Published MCP server (`strix-sandbox` on PyPI) | Python 3.11+ |
| `strix-sandbox-mcp/` | Dev fork of MCP server (local edits/testing) | Python 3.11+ |
| `plugin/` | Claude Code plugin: skills, commands, agent definitions | Markdown (YAML frontmatter) |
| `strix-webui/` | Web dashboard for launching scans and real-time monitoring | TypeScript (Node.js + React) |
| `strix-marketplace/` | Packaged plugin for Claude Code marketplace | Markdown |
| `scripts/` | One-click install scripts (bash, PowerShell) | Shell |

`a2ui-reference/` and `claude-agent-webui/` are reference codebases, not part of the project.

## Development Commands

### MCP Server (`mcp-server/` or `strix-sandbox-mcp/`)

```bash
cd mcp-server
pip install -e ".[dev]"          # Install in dev mode

# Quality
ruff check src/                  # Lint
ruff format --check src/         # Format check
mypy src/                        # Type check

# Tests
pytest tests/ -m unit -v         # Unit tests only
pytest tests/ -m integration -v  # Integration tests (need Docker)
pytest tests/ -v                 # All tests
pytest tests/test_findings.py -v # Single file
pytest -k "test_name" -v         # Single test
```

For `strix-sandbox-mcp/` (dev fork): `cd strix-sandbox-mcp && pip install -e .` then `python -m pytest tests/ -v`.

### Web UI (`strix-webui/`)

```bash
cd strix-webui
npm install                      # Install all workspace deps
npm run build                    # Build all (shared → backend → frontend)
npm run dev                      # Dev servers: REST :3000, WS :3001, Vite :5173
npm run install:hooks            # Register hooks in ~/.claude/settings.json
```

Build order matters: shared must build before backend/frontend (`npm run build:shared` first).

### Plugin

No build step. Skills are Markdown files with YAML frontmatter in `plugin/skills/*/SKILL.md`. Slash commands in `plugin/commands/*.md`. Agent definition in `plugin/agents/strix.md`.

## Architecture

### MCP Server

FastMCP server exposing ~35 tools via MCP protocol (stdio). Tools delegate to a Docker container running Playwright, mitmproxy, tmux, and IPython.

```
server.py (tool definitions) → tools/*.py (implementation) → HTTP → container/tool_server.py (FastAPI in Docker)
```

Key files: `server.py` defines `@mcp.tool()` decorators, `tools/browser.py`, `tools/proxy.py`, `tools/terminal.py`, `tools/findings.py` (SQLite via aiosqlite), `runtime/` manages Docker lifecycle.

### Web UI

NPM workspaces monorepo: `shared/` (types), `backend/` (Express + WS + SQLite), `frontend/` (React + Vite + Tailwind).

**Data flow**: Backend spawns `claude --print --dangerously-skip-permissions` → Claude Code hooks (PreToolUse, PostToolUse, SubagentStop, PreCompact) append events to `~/.strix-webui/events/events.jsonl` → EventReceiver watches file → updates SQLite → broadcasts via WebSocket → frontend Zustand stores → React renders.

Key backend files:
- `scan-manager.ts` — Spawns Claude CLI, one active scan at a time, passes `STRIX_SCAN_ID` env var
- `websocket.ts` — WS server port 3001, heartbeat, broadcasts events
- `hooks/*.ts` — Four hooks (PreToolUse, PostToolUse, SubagentStop, PreCompact), run as separate processes, read stdin from Claude Code, append to JSONL or notify backend
- `store/sqlite-store.ts` — better-sqlite3 at `~/.strix-webui/strix.db`, WAL mode. Tables: scans, agents, tool_executions, vulnerabilities, logs, chat_sessions, chat_messages
- `server/rest-api.ts` — Express REST API including `/api/ask` (SSE streaming to Claude CLI) and `/api/chat/*` (session CRUD with user isolation via `X-Strix-User-Id` header)
- `reports/` — `pdf-generator.ts` (scan reports), `chat-pdf-generator.ts` and `chat-docx-generator.ts` (chat session exports)

Key frontend files:
- `pages/LiveScan.tsx` — 3-pane layout: chat + attack flow visualization + terminal log
- `pages/AskAI.tsx` — Standalone AI chat page with persistent sessions
- `pages/ReportPreview.tsx` — Report viewer with inline AI chat panel (also session-persistent)
- `components/Visualization/NetworkTopology.tsx` — `@xyflow/react` graph of agents/tools/findings
- `hooks/useWebSocket.ts` — Auto-reconnect, heartbeat, tab-visibility handling
- `store/*.ts` — Zustand stores, one per entity, `Map<string, T>` for O(1) lookups
- `lib/userId.ts` — Per-browser UUID (localStorage) for user isolation
- `lib/chatApi.ts` — Chat session API wrapper with user ID header

### Plugin Skills

8 security testing skills, each a Markdown file with embedded methodology:
`security-recon`, `injection-testing`, `auth-testing`, `logic-testing`, `platform-testing`, `web-security-testing`, `verification-methods`, `security-reporting`

### User Isolation (Chat Sessions)

Chat sessions use a lightweight user isolation model: each browser generates a UUID stored in localStorage, sent as `X-Strix-User-Id` header on all `/api/chat/*` requests. Backend filters all queries by `user_id`. Currently only chat sessions are isolated; scans/findings/reports are shared across all users.

## Gotchas

- Root `.gitignore` has `lib/` (Python convention) which blocks `frontend/src/lib/`. Use `git add -f` for files in that directory.
- Frontend imports shared types via `@shared/index` (Vite alias + tsconfig paths), but re-exports them through `frontend/src/types/index.ts` — add new shared types to both files.
- `npm run build:shared` must run before backend or frontend builds. `npm run build` handles the order automatically.

## Conventions

- Commit messages: conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`), optionally scoped (`feat(webui):`, `fix(mcp):`)
- Branch naming: `feature/description`, `fix/description`
- Python: 100-char line limit, type hints on all functions, ruff + mypy
- TypeScript (webui): strict mode, shared types imported via `@strix-webui/shared`
- Release tags: `mcp-v0.2.0` (MCP server → PyPI + Docker Hub), `plugin-v1.0.0` (plugin → GitHub Release)

## CI

GitHub Actions runs on push/PR to `main`:
1. **Lint & Type Check** — ruff + mypy on `mcp-server/`
2. **Test** — pytest unit tests on Python 3.11 + 3.12
3. **Validate Plugin** — Checks plugin structure

## Environment Variables

```bash
STRIX_LLM="anthropic/claude-sonnet-4-5"  # or openai/gpt-5 (for strix CLI)
LLM_API_KEY="your-key"
LLM_API_BASE="..."                        # For local models (Ollama, LMStudio)
PERPLEXITY_API_KEY="..."                  # Enables web search tool
```

## Known Issues

- `strix-sandbox-mcp/` tests: `test_browser.py` has 15 failures (ImportError for old function names), `test_proxy.py` has 2 failures (hardcoded limit mismatch)
- `claude --print` takes ~2.5 minutes to initialize MCP servers before tool execution begins
- Web UI has no test runner or linter configured yet
