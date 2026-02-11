import { WebSocket, WebSocketServer } from "ws";
import { eventReceiver } from "../bridge/event-receiver.js";
import { store } from "../store/sqlite-store.js";
import type { Agent, ToolExecution, Vulnerability, LogEntry, WSMessage, InternalEvent } from "@strix-webui/shared";
import { v4 as uuidv4 } from "uuid";

function generateAgentIdFromToolUseId(toolUseId: string): string {
  const suffix = toolUseId.slice(-12).replace(/[^a-zA-Z0-9]/g, "");
  return `agent_${suffix}`;
}

const IDLE_CHECK_INTERVAL_MS = 10000;
const AGENT_IDLE_TIMEOUT_MS = 120000;
const HEARTBEAT_INTERVAL_MS = 15000;

export function createWebSocketServer(port: number = 3001): WebSocketServer {
  const wss = new WebSocketServer({ port });

  const sessionAgentMap = new Map<string, string>();
  const agentLastActivity = new Map<string, number>();
  const scanSessionMap = new Map<string, string>(); // scanId -> sessionId for active scan

  // Track replay state to suppress broadcasts and duplicate log entries
  let isReplayingEvents = false;

  function broadcast(message: WSMessage): void {
    if (isReplayingEvents) return; // Skip during event replay
    const data = JSON.stringify(message);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  function updateAgentActivity(agentId: string): void {
    agentLastActivity.set(agentId, Date.now());
  }

  const eventHandler = (event: InternalEvent & { _replay?: boolean }) => {
    try {
      const isReplay = !!event._replay;
      if (isReplay) isReplayingEvents = true;

      // Skip events not belonging to a known scan (e.g. from the host Claude Code session)
      if ("scanId" in event && event.scanId) {
        const knownScan = store.getScan(event.scanId);
        if (!knownScan && event.type !== "SCAN_STARTED") {
          return; // Ignore events for unknown scans
        }
      }

      switch (event.type) {
        case "SCAN_STARTED": {
          const scan = store.getScan(event.scanId);
          if (scan) {
            broadcast({ type: "SCAN_STARTED", payload: scan });
          }
          break;
        }

        case "AGENT_CREATING": {
          const taskInput = event.taskInput || {};
          const agentId = generateAgentIdFromToolUseId(event.toolUseId);

          const existingAgent = store.getAgent(agentId);
          if (existingAgent) {
            sessionAgentMap.set(event.sessionId, agentId);
            updateAgentActivity(agentId);
            break;
          }

          const parentId = sessionAgentMap.get(event.sessionId) || null;

          const agent: Agent = {
            id: agentId,
            scanId: event.scanId,
            name: (taskInput.description as string) || "Security Agent",
            parentId,
            status: "running",
            task: (taskInput.prompt as string) || "",
            createdAt: event.timestamp,
            finishedAt: null,
          };

          sessionAgentMap.set(event.sessionId, agent.id);
          updateAgentActivity(agent.id);

          store.saveAgent(agent);
          broadcast({ type: "AGENT_CREATED", payload: agent });

          if (!isReplay) {
            const log: LogEntry = {
              id: uuidv4(),
              scanId: event.scanId,
              agentId: agent.id,
              level: "info",
              message: `Agent spawned: ${agent.name}`,
              timestamp: event.timestamp,
            };
            store.saveLog(log);
            broadcast({ type: "LOG_ENTRY", payload: log });
          }
          break;
        }

        case "AGENT_STOPPED": {
          const agentId = sessionAgentMap.get(event.sessionId);
          if (agentId) {
            store.updateAgentStatus(agentId, "completed", event.timestamp);
            broadcast({
              type: "AGENT_STATUS_CHANGED",
              payload: { id: agentId, status: "completed", finishedAt: event.timestamp },
            });
            sessionAgentMap.delete(event.sessionId);
            agentLastActivity.delete(agentId);
          }
          break;
        }

        case "TOOL_STARTED": {
          let agentId = sessionAgentMap.get(event.sessionId) || "";

          if (!agentId) {
            const allAgents = store.getAgentsByScan(event.scanId);
            const allTools = store.getToolsByScan(event.scanId);

            const agentsWithoutTools = allAgents.filter((a) => {
              if (a.status !== "running") return false;
              if (!a.parentId) return false;
              return !allTools.some((tc) => tc.agentId === a.id);
            });

            if (agentsWithoutTools.length > 0) {
              const oldest = agentsWithoutTools.sort(
                (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
              )[0];
              agentId = oldest.id;
              sessionAgentMap.set(event.sessionId, agentId);
            } else {
              const deterministicId = `agent_${event.sessionId.replace(/-/g, "").slice(0, 16)}`;
              const existing = store.getAgent(deterministicId);

              if (existing) {
                agentId = deterministicId;
                sessionAgentMap.set(event.sessionId, agentId);
              } else {
                const rootAgent: Agent = {
                  id: deterministicId,
                  scanId: event.scanId,
                  name: "Strix Scanner",
                  parentId: null,
                  status: "running",
                  task: "Main security assessment",
                  createdAt: event.timestamp,
                  finishedAt: null,
                };
                agentId = rootAgent.id;
                sessionAgentMap.set(event.sessionId, agentId);
                store.saveAgent(rootAgent);
                broadcast({ type: "AGENT_CREATED", payload: rootAgent });
              }
            }
          }

          updateAgentActivity(agentId);

          const toolExecution: ToolExecution = {
            id: event.toolUseId,
            scanId: event.scanId,
            agentId,
            sessionId: event.sessionId,
            toolName: event.toolName,
            toolInput: event.toolInput,
            status: "running",
            startedAt: event.timestamp,
          };

          store.saveToolExecution(toolExecution);
          broadcast({ type: "TOOL_STARTED", payload: toolExecution });

          if (!isReplay) {
            const log: LogEntry = {
              id: uuidv4(),
              scanId: event.scanId,
              agentId,
              level: "info",
              message: `Tool started: ${event.toolName}`,
              toolName: event.toolName,
              timestamp: event.timestamp,
            };
            store.saveLog(log);
            broadcast({ type: "LOG_ENTRY", payload: log });
          }
          break;
        }

        case "TOOL_COMPLETED": {
          const existingTool = store.getToolExecution(event.toolUseId);
          if (existingTool) {
            if (existingTool.agentId) {
              updateAgentActivity(existingTool.agentId);
            }

            store.updateToolExecution(event.toolUseId, {
              status: "completed",
              toolOutput: event.toolOutput,
              completedAt: event.timestamp,
            });

            const updated = store.getToolExecution(event.toolUseId);
            if (updated) {
              broadcast({ type: "TOOL_COMPLETED", payload: updated });
            }

            if (!isReplay) {
              const log: LogEntry = {
                id: uuidv4(),
                scanId: event.scanId,
                agentId: existingTool.agentId,
                level: "success",
                message: `Tool completed: ${event.toolName}`,
                toolName: event.toolName,
                timestamp: event.timestamp,
              };
              store.saveLog(log);
              broadcast({ type: "LOG_ENTRY", payload: log });
            }
          }
          break;
        }

        case "VULNERABILITY_FOUND": {
          const vuln: Vulnerability = {
            id: uuidv4(),
            scanId: event.scanId,
            agentId: event.agentId,
            ...event.vulnerability,
            discoveredAt: event.timestamp,
          };

          store.saveVulnerability(vuln);
          broadcast({ type: "VULNERABILITY_FOUND", payload: vuln });

          // Update scan finding count
          const vulns = store.getVulnsByScan(event.scanId);
          store.updateScanFindings(event.scanId, vulns.length);

          if (!isReplay) {
            const log: LogEntry = {
              id: uuidv4(),
              scanId: event.scanId,
              agentId: event.agentId,
              level: "warning",
              message: `Vulnerability found: ${vuln.title} (${vuln.severity})`,
              timestamp: event.timestamp,
            };
            store.saveLog(log);
            broadcast({ type: "LOG_ENTRY", payload: log });
          }
          break;
        }

        case "SCAN_COMPLETED": {
          store.updateScanStatus(event.scanId, event.status, event.timestamp);
          const scan = store.getScan(event.scanId);
          if (scan) {
            broadcast({ type: "SCAN_UPDATED", payload: { id: scan.id, status: scan.status, completedAt: scan.completedAt } });
          }

          // Mark all running agents for this scan as completed
          const scanAgents = store.getAgentsByScan(event.scanId);
          for (const agent of scanAgents) {
            if (agent.status === "running") {
              store.updateAgentStatus(agent.id, "completed", event.timestamp);
              broadcast({
                type: "AGENT_STATUS_CHANGED",
                payload: { id: agent.id, status: "completed", finishedAt: event.timestamp },
              });
              agentLastActivity.delete(agent.id);
              for (const [sid, aid] of sessionAgentMap.entries()) {
                if (aid === agent.id) { sessionAgentMap.delete(sid); break; }
              }
            }
          }
          break;
        }
      }
    } catch (error) {
      console.error("[WS] Error processing event:", error);
    } finally {
      isReplayingEvents = false;
    }
  };

  eventReceiver.on("event", eventHandler);

  wss.on("connection", (ws) => {
    console.log("[WS] Client connected");
    (ws as WebSocket & { isAlive: boolean }).isAlive = true;

    ws.on("pong", () => {
      (ws as WebSocket & { isAlive: boolean }).isAlive = true;
    });

    // Send initial state
    const scans = store.getAllScans();
    const activeScan = scans.find((s) => s.status === "running") || scans[0] || null;

    const initMessage: WSMessage = {
      type: "INIT_STATE",
      payload: {
        scan: activeScan,
        agents: activeScan ? store.getAgentsByScan(activeScan.id) : [],
        toolExecutions: activeScan ? store.getToolsByScan(activeScan.id) : [],
        vulnerabilities: activeScan ? store.getVulnsByScan(activeScan.id) : [],
        logs: activeScan ? store.getRecentLogs(activeScan.id, 200) : [],
      },
    };
    ws.send(JSON.stringify(initMessage));

    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === "CLEAR_ALL") {
          store.clearAll();
          sessionAgentMap.clear();
          agentLastActivity.clear();
          eventReceiver.clearEvents();
          broadcast({
            type: "INIT_STATE",
            payload: { scan: null, agents: [], toolExecutions: [], vulnerabilities: [], logs: [] },
          });
        } else if (message.type === "PING") {
          ws.send(JSON.stringify({ type: "PONG", payload: { timestamp: new Date().toISOString() } }));
        } else if (message.type === "SUBSCRIBE_SCAN" && message.payload?.scanId) {
          const scan = store.getScan(message.payload.scanId);
          if (scan) {
            const state: WSMessage = {
              type: "INIT_STATE",
              payload: {
                scan,
                agents: store.getAgentsByScan(scan.id),
                toolExecutions: store.getToolsByScan(scan.id),
                vulnerabilities: store.getVulnsByScan(scan.id),
                logs: store.getRecentLogs(scan.id, 200),
              },
            };
            ws.send(JSON.stringify(state));
          }
        }
      } catch (error) {
        console.error("[WS] Failed to parse client message:", error);
      }
    });

    ws.on("close", () => console.log("[WS] Client disconnected"));
    ws.on("error", (error) => console.error("[WS] Client error:", error));
  });

  eventReceiver.start();

  const heartbeatTimer = setInterval(() => {
    wss.clients.forEach((ws) => {
      const wsExt = ws as WebSocket & { isAlive: boolean };
      if (wsExt.isAlive === false) return ws.terminate();
      wsExt.isAlive = false;
      ws.ping();
    });
  }, HEARTBEAT_INTERVAL_MS);

  const idleCheckTimer = setInterval(() => {
    const now = Date.now();
    for (const [agentId, lastActivity] of agentLastActivity.entries()) {
      if (now - lastActivity > AGENT_IDLE_TIMEOUT_MS) {
        const agent = store.getAgent(agentId);
        if (agent && agent.status === "running") {
          const tools = store.getToolsByScan(agent.scanId);
          const hasRunning = tools.some((t) => t.agentId === agentId && t.status === "running");
          if (hasRunning) {
            updateAgentActivity(agentId);
            continue;
          }

          const finishedAt = new Date().toISOString();
          store.updateAgentStatus(agentId, "completed", finishedAt);
          for (const [sid, aid] of sessionAgentMap.entries()) {
            if (aid === agentId) { sessionAgentMap.delete(sid); break; }
          }
          broadcast({ type: "AGENT_STATUS_CHANGED", payload: { id: agentId, status: "completed", finishedAt } });
        }
        agentLastActivity.delete(agentId);
      }
    }
  }, IDLE_CHECK_INTERVAL_MS);

  wss.on("close", () => {
    clearInterval(heartbeatTimer);
    clearInterval(idleCheckTimer);
    eventReceiver.removeListener("event", eventHandler);
    eventReceiver.stop();
  });

  console.log(`[WS] WebSocket server running on ws://localhost:${port}`);
  return wss;
}
