import { createContext, useContext, useEffect, useRef, useCallback, useState, createElement } from "react";
import type { ReactNode } from "react";
import { useScanStore } from "../store/scanStore";
import { useAgentStore } from "../store/agentStore";
import { useToolStore } from "../store/toolStore";
import { useVulnerabilityStore } from "../store/vulnerabilityStore";
import { useLogStore } from "../store/logStore";
import type { WSMessage } from "../types";
import { WS_URL } from "../lib/config";

export type ConnectionStatus = "connected" | "disconnected" | "connecting";

interface WebSocketContextValue {
  send: (msg: unknown) => void;
  status: ConnectionStatus;
}

const WebSocketContext = createContext<WebSocketContextValue>({
  send: () => {},
  status: "disconnected",
});

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const pingIntervalRef = useRef<ReturnType<typeof setInterval>>();
  const pongTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const isConnectingRef = useRef(false);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");

  const { setActiveScan, updateScan } = useScanStore();
  const { initAgents, addAgent, updateAgentStatus } = useAgentStore();
  const { initTools, addTool, updateTool } = useToolStore();
  const { initVulnerabilities, addVulnerability } = useVulnerabilityStore();
  const { initLogs, addLog } = useLogStore();

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
    if (pongTimerRef.current) clearTimeout(pongTimerRef.current);
  }, []);

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data) as WSMessage;

        switch (msg.type) {
          case "INIT_STATE":
            setActiveScan(msg.payload.scan);
            initAgents(msg.payload.agents);
            initTools(msg.payload.toolExecutions);
            initVulnerabilities(msg.payload.vulnerabilities);
            initLogs(msg.payload.logs);
            break;
          case "SCAN_STARTED":
            setActiveScan(msg.payload);
            break;
          case "SCAN_UPDATED":
            updateScan(msg.payload);
            break;
          case "AGENT_CREATED":
            addAgent(msg.payload);
            break;
          case "AGENT_STATUS_CHANGED":
            updateAgentStatus(msg.payload.id, msg.payload.status, msg.payload.finishedAt);
            break;
          case "TOOL_STARTED":
            addTool(msg.payload);
            break;
          case "TOOL_COMPLETED":
            updateTool(msg.payload);
            break;
          case "VULNERABILITY_FOUND":
            addVulnerability(msg.payload);
            break;
          case "LOG_ENTRY":
            addLog(msg.payload);
            break;
          case "PONG":
            if (pongTimerRef.current) clearTimeout(pongTimerRef.current);
            break;
        }
      } catch {
        // Skip malformed messages
      }
    },
    [setActiveScan, updateScan, initAgents, addAgent, updateAgentStatus, initTools, addTool, updateTool, initVulnerabilities, addVulnerability, initLogs, addLog]
  );

  const connect = useCallback(() => {
    if (isConnectingRef.current || wsRef.current?.readyState === WebSocket.OPEN) return;
    isConnectingRef.current = true;
    setStatus("connecting");

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        isConnectingRef.current = false;
        setStatus("connected");

        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "PING" }));
            pongTimerRef.current = setTimeout(() => {
              ws.close();
            }, 5000);
          }
        }, 10000);
      };

      ws.onmessage = handleMessage;

      ws.onclose = () => {
        isConnectingRef.current = false;
        setStatus("disconnected");
        clearTimers();
        reconnectTimerRef.current = setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        isConnectingRef.current = false;
      };
    } catch {
      isConnectingRef.current = false;
      setStatus("disconnected");
      reconnectTimerRef.current = setTimeout(connect, 2000);
    }
  }, [handleMessage, clearTimers]);

  useEffect(() => {
    connect();

    const onVisibility = () => {
      if (document.visibilityState === "visible" && wsRef.current?.readyState !== WebSocket.OPEN) {
        connect();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearTimers();
      document.removeEventListener("visibilitychange", onVisibility);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect, clearTimers]);

  const send = useCallback((msg: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return createElement(WebSocketContext.Provider, { value: { send, status } }, children);
}

export function useWebSocket(): WebSocketContextValue {
  return useContext(WebSocketContext);
}
