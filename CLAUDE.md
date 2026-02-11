# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Strix is an AI-powered security testing framework for Claude Code. It has four main components: an MCP server providing sandboxed security tools, a Claude Code plugin with specialized security skills, a web UI for launching/monitoring scans, and a Tauri v2 desktop/mobile app that embeds the web UI with a Rust backend.

## Repository Structure

| Directory | Purpose | Language |
|-----------|---------|----------|
| `src-tauri/` | Tauri v2 desktop/mobile app (Rust backend + bundled frontend) | Rust |
| `strix-webui/` | Web dashboard: frontend (React) + standalone backend (Node.js) | TypeScript |
| `mcp-server/` | Published MCP server (`strix-sandbox` on PyPI) | Python 3.11+ |
| `strix-sandbox-mcp/` | Dev fork of MCP server (local edits/testing) | Python 3.11+ |
| `plugin/` | Claude Code plugin: skills, commands, agent definitions | Markdown (YAML frontmatter) |
| `strix-marketplace/` | Packaged plugin for Claude Code marketplace | Markdown |
| `scripts/` | One-click install scripts (bash, PowerShell) | Shell |

`a2ui-reference/` and `claude-agent-webui/` are reference codebases, not part of the project.

The `strix-webui/` subdirectory has its own `CLAUDE.md` with detailed webui architecture, API endpoints, and design system documentation.

## Development Commands

### Tauri Desktop App (`src-tauri/`)

```bash
# Prerequisites: install Tauri CLI
cargo install tauri-cli --version "^2"

# Build Rust backend (fast check)
cd src-tauri && cargo build

# Build for iOS simulator
cargo build --target aarch64-apple-ios-sim

# Run desktop app (dev mode, needs frontend running on :5173)
cargo tauri dev

# Run iOS simulator (specify device)
cargo tauri ios dev "iPhone 17 Pro" --no-watch

# Build production macOS app (.app + .dmg)
cargo tauri build

# Initialize iOS project (first time only)
cargo tauri ios init
```

**Important**: `cargo tauri dev` requires the frontend dev server running separately (`cd strix-webui && npm run dev:frontend`). The Tauri webview connects to `http://localhost:5173` in dev mode.

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

Build order matters: shared must build before backend/frontend (`npm run build:shared` first). `npm run build` handles the order automatically.

### Plugin

No build step. Skills are Markdown files with YAML frontmatter in `plugin/skills/*/SKILL.md`. Slash commands in `plugin/commands/*.md`. Agent definition in `plugin/agents/strix.md`. Plugin metadata in `plugin/.claude-plugin/plugin.json`.

## Architecture

### Tauri Desktop App (Rust Backend)

The Tauri app replaces the Node.js backend with a single Rust binary that embeds the React frontend. Same API surface, same database schema, same WebSocket protocol — the frontend doesn't know the difference.

**Startup flow** (`src-tauri/src/lib.rs`):
1. Initialize tracing logger
2. Build Tauri app with `tauri::async_runtime::spawn` (non-blocking)
3. `start_backend()` initializes: DB → EventReceiver → ScanManager → hooks → REST (:3000) → WS (:3001)
4. `RunEvent::Exit` handler does graceful cleanup (stop scans, save cursor, kill processes)

**Module map** (`src-tauri/src/`):

| Module | Purpose |
|--------|---------|
| `lib.rs` | Tauri app entry, backend orchestration, graceful shutdown |
| `server/rest_api.rs` | Axum REST routes (19 endpoints matching Node.js API) |
| `server/websocket.rs` | WS on :3001, INIT_STATE, event broadcast, 15s heartbeat, idle detection |
| `server/scan_manager.rs` | Spawns `claude` CLI, timeout management, process lifecycle |
| `server/sse.rs` | Server-Sent Events for Ask AI streaming |
| `server/docker_utils.rs` | Docker preflight checks with step-by-step progress |
| `bridge/event_receiver.rs` | Watches `~/.strix-webui/events/events.jsonl` via `notify` + polling |
| `store/db.rs` | `AppDb` wrapper: `Mutex<rusqlite::Connection>`, WAL mode, `~/.strix-webui/strix.db` |
| `store/{scans,agents,tools,vulns,logs,chat}.rs` | CRUD for each entity |
| `models/` | Rust structs matching TypeScript types (`#[serde(rename_all = "camelCase")]`). Includes `events.rs` (JSONL event structs) and `ws_messages.rs` (WebSocket protocol types) |
| `reports/` | PDF (printpdf) and DOCX (docx-rs) generation. `pdf_writer.rs` has low-level PDF rendering helpers |
| `hooks/bin/` | 4 standalone binaries registered with Claude Code |
| `hooks/shared.rs` | `HookInput` struct, `read_stdin()`, output truncation — shared by all 4 hook binaries |
| `hooks/install.rs` | Registers hooks in `~/.claude/settings.json` |
| `utils/` | `errors.rs` (error message extraction), `events.rs` (event file path helpers) |

**Hook binaries** — 4 separate executables that Claude Code invokes during scans:
- `strix-hook-pre-tool-use` — Detects agent creation, logs tool starts, captures vulnerabilities
- `strix-hook-post-tool-use` — Records tool completion with truncated output
- `strix-hook-subagent-stop` — Marks agents as stopped
- `strix-hook-pre-compact` — Notifies backend of context compaction

All hooks: read `HookInput` from stdin → write event to `events.jsonl` → print `{"continue":true}`.

### Data Flow

```
Tauri spawns: claude --print --dangerously-skip-permissions (with STRIX_SCAN_ID env)
  → Claude Code hooks append events to ~/.strix-webui/events/events.jsonl
    → EventReceiver watches file, broadcasts via tokio::broadcast
      → Updates SQLite → WebSocket broadcasts to frontend
        → Zustand stores → React re-renders
```

### Frontend Tauri Detection

`strix-webui/frontend/src/lib/config.ts` detects `window.__TAURI__` (set by `withGlobalTauri: true` in tauri.conf.json):
- **Tauri mode**: `API_BASE_URL = "http://localhost:3000"`, `WS_URL = "ws://localhost:3001"`
- **Standalone mode**: `API_BASE_URL = ""` (relative paths, Vite proxies to :3000)

### MCP Server

FastMCP server exposing ~35 tools via MCP protocol (stdio). Tools delegate to a Docker container running Playwright, mitmproxy, tmux, and IPython.

```
server.py (tool definitions) → tools/*.py (implementation) → HTTP → container/tool_server.py (FastAPI in Docker)
```

### Plugin Skills

8 security testing skills, each a Markdown file with embedded methodology:
`security-recon`, `injection-testing`, `auth-testing`, `logic-testing`, `platform-testing`, `web-security-testing`, `verification-methods`, `security-reporting`

## Conventions

- Commit messages: conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`), optionally scoped (`feat(tauri):`, `feat(webui):`, `fix(mcp):`)
- Branch naming: `feature/description`, `fix/description`
- Rust: `#[serde(rename_all = "camelCase")]` on all models to match frontend JSON. Use `spawn_blocking` for all rusqlite calls.
- Python: 100-char line limit, type hints on all functions, ruff + mypy
- TypeScript (webui): strict mode, shared types imported via `@strix-webui/shared`
- Release tags: `app-v0.1.0` (Tauri app → GitHub Release), `mcp-v0.2.0` (MCP server → PyPI + Docker Hub), `plugin-v1.0.0` (plugin → GitHub Release)

## CI/CD

GitHub Actions runs on push/PR to `main`:
1. **Lint & Type Check** — ruff + mypy on `mcp-server/`
2. **Test** — pytest unit tests on Python 3.11 + 3.12
3. **Validate Plugin** — Checks plugin structure

Release workflows (triggered by tags):
- **`app-v*`** → `release-app.yml`: Tauri builds for macOS (ARM + Intel), Windows, Linux → draft GitHub Release with .dmg/.msi/.deb/.AppImage
- **`mcp-v*`** → `release-mcp.yml`: PyPI + Docker Hub + GitHub Release
- **`plugin-v*`** → `release-plugin.yml`: Plugin zip + GitHub Release

Auto-tagging: `auto-tag.yml` watches `src-tauri/Cargo.toml`, `mcp-server/pyproject.toml`, `plugin/.claude-plugin/plugin.json` for version changes and creates tags automatically.

## Environment Variables

```bash
STRIX_LLM="anthropic/claude-sonnet-4-5"  # or openai/gpt-5 (for strix CLI)
LLM_API_KEY="your-key"
LLM_API_BASE="..."                        # For local models (Ollama, LMStudio)
PERPLEXITY_API_KEY="..."                  # Enables web search tool
RUST_LOG="strix=debug,tower_http=info"   # Tauri backend tracing (default: strix=info)
```

## Gotchas

- Root `.gitignore` has `lib/` (Python convention) which blocks `frontend/src/lib/`. Use `git add -f` for files in that directory.
- Frontend imports shared types via `@shared/index` (Vite alias + tsconfig paths), but re-exports them through `frontend/src/types/index.ts` — add new shared types to both files.
- `strix-sandbox-mcp/` tests: `test_browser.py` has 15 failures (ImportError for old function names), `test_proxy.py` has 2 failures (hardcoded limit mismatch).
- `claude --print` takes ~2.5 minutes to initialize MCP servers before tool execution begins.
- Web UI has no test runner or linter configured yet.
- **Tauri iOS**: Xcode's shell doesn't load `~/.zshrc`. The `project.pbxproj` build script must have `export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:$PATH"` prepended. If `cargo tauri ios init` regenerates the Xcode project, this fix must be reapplied.
- **Tauri iOS**: `cargo tauri ios dev` requires specifying a device name (e.g., `"iPhone 17 Pro"`), otherwise it loops waiting for device selection.
- **Tauri Cargo.toml**: Must have `default-run = "strix"` because of 4 hook `[[bin]]` entries, and `[lib] crate-type = ["staticlib", "cdylib", "lib"]` for iOS static library linking.
- **`beforeBuildCommand`** in `tauri.conf.json` runs from the `strix-webui/` directory (resolved from `frontendDist` parent), not from repo root or `src-tauri/`.
