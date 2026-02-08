# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Strix WebUI is a real-time web dashboard for monitoring Strix autonomous security testing. It bridges the Strix CLI (spawned as a child process) with a React frontend via WebSocket, providing live visibility into security assessments.

## Development Commands

```bash
npm install                  # Install all workspace dependencies
npm run build:shared         # Build shared types (required before first run)
npm run install:hooks        # Register Claude Code hooks in ~/.claude/settings.json
npm run dev                  # Start backend (port 3000) + frontend (port 5173) concurrently
npm run dev:backend          # Backend only (tsx watch)
npm run dev:frontend         # Frontend only (Vite)
npm run build                # Build all packages (shared → backend → frontend)
```

No test runner or linter is currently configured.

## Architecture

**Monorepo** with NPM workspaces: `backend/`, `frontend/`, `shared/`.

### Shared (`shared/src/index.ts`)

Single file defining all TypeScript types used across the network boundary: `Scan`, `Agent`, `ToolExecution`, `Vulnerability`, `LogEntry`, `WSMessage` (server→client), `WSClientMessage` (client→server), `InternalEvent` (JSONL hook format).

### Backend (Express + WebSocket + SQLite)

- **`server/rest-api.ts`** — Express REST endpoints: CRUD for scans, PDF report download, `/api/ask` (SSE streaming to Claude CLI in ask/execute modes), `/api/chat/*` (session CRUD with `X-Strix-User-Id` user isolation)
- **`server/scan-manager.ts`** — Spawns `claude` CLI as child process with `--print --dangerously-skip-permissions`, passes `STRIX_SCAN_ID` env var. One active scan at a time.
- **`server/websocket.ts`** — WS server on port 3001. Sends `INIT_STATE` on connect, broadcasts all events, 15s heartbeat, 2-min idle agent detection
- **`store/sqlite-store.ts`** — SQLite via better-sqlite3, stored at `~/.strix-webui/strix.db` (WAL mode). Tables: scans, agents, tool_executions, vulnerabilities, logs, chat_sessions, chat_messages. Tool outputs >10KB truncated to separate files in `~/.strix-webui/content/`
- **`bridge/event-receiver.ts`** — Watches `~/.strix-webui/events/events.jsonl` via `fs.watch` + 500ms polling, parses events, updates DB, emits to WebSocket
- **`hooks/`** — Four hooks registered in `~/.claude/settings.json`: `pre-tool-use.ts`, `post-tool-use.ts`, `subagent-stop.ts` (append events to JSONL), and `pre-compact.ts` (notifies backend when Claude compacts context in chat sessions). This is how the CLI communicates with the WebUI without modification.
- **`reports/`** — `pdf-generator.ts` (scan vulnerability reports via PDFKit), `chat-pdf-generator.ts` (chat session export to PDF), `chat-docx-generator.ts` (chat session export to DOCX via `docx` lib)

### Frontend (React + Vite + TailwindCSS)

- **State**: Zustand stores in `store/` — one per entity (scan, agent, tool, vulnerability, log), all using `Map<string, T>` for O(1) lookups
- **WebSocket**: `hooks/useWebSocket.ts` — auto-connect, auto-reconnect (2s), heartbeat ping, tab-visibility reconnect
- **Routing** (react-router-dom): `/` Dashboard, `/ask` AskAI, `/scan` LiveScan, `/scan/:id` specific scan, `/scan/:id/report` ReportPreview, `/history`, `/reports`, `/findings`, `/settings`
- **Key pages**: `Dashboard.tsx` (scan launcher), `LiveScan.tsx` (3-pane layout), `AskAI.tsx` (standalone chat with persistent sessions), `ReportPreview.tsx` (report viewer with inline chat panel)
- **Shared types re-export**: `types/index.ts` re-exports from `@shared/index` — new shared types must be added to both files
- **User isolation**: `lib/userId.ts` generates per-browser UUID in localStorage; `lib/chatApi.ts` sends it as `X-Strix-User-Id` header on chat API calls
- **Visualization**: `NetworkTopology.tsx` uses `@xyflow/react` for hierarchical agent/tool/finding graph with custom node types and animated edges

### Data Flow

```
Strix CLI (claude process)
  ↓ hooks intercept tool use
Hooks → append to JSONL file (~/.strix-webui/events/events.jsonl)
  ↓ fs.watch
EventReceiver → updates SQLite → emits events
  ↓
WebSocket server → broadcasts to all clients
  ↓
Frontend useWebSocket → updates Zustand stores → React re-renders
```

### Key Design Decisions

- **JSONL as IPC**: Hooks run as separate Node processes with no DB access. JSONL provides simple append-only communication.
- **Agent ID heuristics**: Root agents derive IDs from session ID, child agents from `create_agent` tool-use ID. Auto-creates root agent if `AGENT_CREATING` event is missing.
- **Vite proxy**: Dev server proxies `/api` → `localhost:3000` so frontend can use relative API paths.
- **`@shared` alias**: Frontend imports shared types via `@shared/index` (resolved by both Vite and tsconfig paths).

## Ports

| Service    | Port |
|-----------|------|
| REST API   | 3000 (`PORT`) |
| WebSocket  | 3001 (`WS_PORT`) |
| Vite dev   | 5173 |

## Gotchas

- Root `.gitignore` has `lib/` (Python convention) which blocks `frontend/src/lib/`. Use `git add -f` for files in that directory.
- When adding new shared types to `shared/src/index.ts`, also add them to `frontend/src/types/index.ts` (the re-export barrel).
- `npm run build:shared` must complete before backend or frontend builds. `npm run build` handles ordering automatically.
- Chat session user isolation is header-based (`X-Strix-User-Id`), not auth-based. Scans/findings/reports are not yet user-isolated.

## Design System

Dark theme in `tailwind.config.ts`: backgrounds `#0A0A0A`/`#141414`/`#1F1F1F`, accent green `#22C55E`, severity colors (critical=red, high=orange, medium=yellow, low=blue). Fonts: Geist Sans + Geist Mono.
