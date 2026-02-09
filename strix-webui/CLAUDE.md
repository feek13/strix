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

Single file defining all TypeScript types used across the network boundary: `Scan`, `Agent`, `ToolExecution`, `Vulnerability`, `LogEntry`, `WSMessage` (server→client), `WSClientMessage` (client→server), `InternalEvent` (JSONL hook format), `ChatSession`, `ChatMessageRecord`, `ToolCategory`, `TOOL_CATEGORIES`, `SKILL_CATEGORIES`.

### Backend (Express + WebSocket + SQLite)

- **`server/rest-api.ts`** — Express REST endpoints (see API Endpoints below)
- **`server/scan-manager.ts`** — Spawns `claude` CLI as child process with `--print --dangerously-skip-permissions`, passes `STRIX_SCAN_ID` env var. One active scan at a time.
- **`server/docker-utils.ts`** — Docker preflight checks (engine running, sandbox image present, image pull/build) with step-by-step progress reporting via `PreflightStep` events
- **`server/websocket.ts`** — WS server on port 3001. Sends `INIT_STATE` on connect, broadcasts all events, 15s heartbeat, 2-min idle agent detection
- **`store/sqlite-store.ts`** — SQLite via better-sqlite3, stored at `~/.strix-webui/strix.db` (WAL mode). Tables: scans, agents, tool_executions, vulnerabilities, logs, chat_sessions, chat_messages. Tool outputs >10KB truncated to separate files in `~/.strix-webui/content/`
- **`bridge/event-receiver.ts`** — Watches `~/.strix-webui/events/events.jsonl` via `fs.watch` + 500ms polling, parses events, updates DB, emits to WebSocket
- **`hooks/`** — Four hooks registered in `~/.claude/settings.json`: `pre-tool-use.ts`, `post-tool-use.ts`, `subagent-stop.ts` (append events to JSONL), and `pre-compact.ts` (notifies backend when Claude compacts context in chat sessions). Hooks run as separate Node processes with no DB access — JSONL provides simple append-only IPC.
- **`reports/`** — `pdf-generator.ts` (scan vulnerability reports via PDFKit), `chat-pdf-generator.ts` (chat session export to PDF), `chat-docx-generator.ts` (chat session export to DOCX via `docx` lib)

### Frontend (React + Vite + TailwindCSS)

- **State**: Zustand stores in `store/` — one per entity (scan, agent, tool, vulnerability, log), all using `Map<string, T>` for O(1) lookups
- **WebSocket**: `hooks/useWebSocket.ts` — auto-connect, auto-reconnect (2s), heartbeat ping, tab-visibility reconnect
- **Routing** (react-router-dom): `/` Dashboard, `/ask` AskAI, `/scan` LiveScan, `/scan/:id` specific scan, `/scan/:id/report` ReportPreview, `/history`, `/reports`, `/findings`, `/settings`, `/tools/:category` ToolCategory
- **Key pages**: `Dashboard.tsx` (scan launcher with Docker preflight), `LiveScan.tsx` (3-pane layout), `AskAI.tsx` (standalone chat with persistent sessions), `ReportPreview.tsx` (report viewer with inline chat panel)
- **Mobile**: `useIsMobile.ts` hook, `MobileDrawer.tsx` (slide-over panels), `MobileTabBar.tsx` (bottom navigation). `MainLayout.tsx` switches between desktop sidebar and mobile drawer.
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
- **`@shared` alias**: Frontend imports shared types via `@shared/index` (resolved by both Vite config and tsconfig paths).

## API Endpoints

```
GET    /api/health
POST   /api/scans                     # Create scan
POST   /api/scans/start               # Start scan
GET    /api/scans                     # List scans
GET    /api/scans/:id                 # Get scan
DELETE /api/scans/:id                 # Delete scan
POST   /api/scans/:id/resume          # Resume scan
GET    /api/scans/:id/report          # Download PDF report
GET    /api/scans/:id/report/preview  # Report preview data
GET    /api/tools/content/:contentId  # Fetch truncated tool output
POST   /api/internal/compacting       # Hook notification
POST   /api/ask                       # SSE streaming to Claude CLI
GET    /api/chat/sessions             # List chat sessions (user-scoped)
POST   /api/chat/sessions             # Create session
DELETE /api/chat/sessions/:id         # Delete session
PATCH  /api/chat/sessions/:id         # Update session
GET    /api/chat/sessions/:id/messages    # Get messages
POST   /api/chat/sessions/:id/messages    # Send message
GET    /api/chat/sessions/:id/export/pdf  # Export as PDF
GET    /api/chat/sessions/:id/export/docx # Export as DOCX
```

## Ports

| Service    | Port |
|-----------|------|
| REST API   | 3000 (`PORT`) |
| WebSocket  | 3001 (`WS_PORT`) |
| Vite dev   | 5173 |

## Design System

Light/dark/system theming via `useTheme` hook and Tailwind `dark:` variants. Colors are defined as CSS custom properties in `frontend/src/index.css` and consumed via `tailwind.config.ts` (e.g., `--color-strix-bg`, `--color-severity-critical`). Both light and dark palettes are defined — the active palette is toggled by applying `dark` class to `<html>`.

Dark palette: backgrounds `#0A0A0A`/`#141414`/`#1F1F1F`, accent green `#22C55E`, severity colors (critical=red, high=orange, medium=yellow, low=blue). Light palette: backgrounds `#F5F5F5`/`#FFFFFF`/`#EEEEEE`, accent green `#16A34A`. Fonts: Geist Sans + Geist Mono.

## Gotchas

- Root `.gitignore` (in parent strix repo) has `lib/` (Python convention) which blocks `frontend/src/lib/`. Use `git add -f` for files in that directory.
- When adding new shared types to `shared/src/index.ts`, also add them to `frontend/src/types/index.ts` (the re-export barrel).
- `npm run build:shared` must complete before backend or frontend builds. `npm run build` handles ordering automatically.
- Chat session user isolation is header-based (`X-Strix-User-Id`), not auth-based. Scans/findings/reports are not yet user-isolated.
