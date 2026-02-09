import type { Response } from "express";

export interface SSEConnection {
  /** Send a data event */
  send: (data: Record<string, unknown>) => void;
  /** Send a raw SSE line (e.g. ": heartbeat\n\n") */
  sendRaw: (line: string) => void;
  /** End the SSE connection */
  end: () => void;
  /** Whether the connection has been ended */
  finished: boolean;
}

/**
 * Set up an SSE connection with standard headers and heartbeat.
 * Returns helpers to write events and clean up.
 */
export function setupSSE(res: Response, heartbeatMs = 5000): SSEConnection {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  res.write(": connected\n\n");

  let finished = false;

  const heartbeat = setInterval(() => {
    if (!finished) res.write(": heartbeat\n\n");
  }, heartbeatMs);

  const end = () => {
    if (finished) return;
    finished = true;
    clearInterval(heartbeat);
  };

  res.on("close", end);

  return {
    send: (data) => {
      if (!finished) res.write(`data: ${JSON.stringify(data)}\n\n`);
    },
    sendRaw: (line) => {
      if (!finished) res.write(line);
    },
    end,
    get finished() { return finished; },
  };
}
