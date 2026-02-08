#!/usr/bin/env node
import type { HookInput, InternalEvent } from "@strix-webui/shared";
import { readStdin, writeEvent } from "./utils.js";

async function main(): Promise<void> {
  try {
    const input = await readStdin();
    const hookInput: HookInput = JSON.parse(input);
    const timestamp = new Date().toISOString();
    const scanId = process.env.STRIX_SCAN_ID || "default";

    // Detect agent creation (Task tool or MCP create_agent)
    const toolName = hookInput.tool_name || "";
    if ((toolName === "Task" || toolName.endsWith("create_agent")) && hookInput.tool_use_id) {
      const event: InternalEvent = {
        type: "AGENT_CREATING",
        timestamp,
        scanId,
        sessionId: hookInput.session_id,
        toolUseId: hookInput.tool_use_id,
        taskInput: hookInput.tool_input || {},
      };
      writeEvent(event);
    }

    // Record all tool starts
    if (hookInput.tool_name && hookInput.tool_use_id) {
      const event: InternalEvent = {
        type: "TOOL_STARTED",
        timestamp,
        scanId,
        sessionId: hookInput.session_id,
        toolUseId: hookInput.tool_use_id,
        toolName: hookInput.tool_name,
        toolInput: hookInput.tool_input || {},
      };
      writeEvent(event);
    }

    // Detect vulnerability reports (tool name may be MCP-prefixed, e.g. mcp__strix-sandbox__create_vulnerability_report)
    if (hookInput.tool_name?.endsWith("create_vulnerability_report") && hookInput.tool_input) {
      const ti = hookInput.tool_input;
      const event: InternalEvent = {
        type: "VULNERABILITY_FOUND",
        timestamp,
        scanId,
        agentId: "",
        vulnerability: {
          title: (ti.title as string) || "Unknown",
          severity: (ti.severity as "critical" | "high" | "medium" | "low" | "info") || "info",
          description: (ti.content as string) || "",
        },
      };
      writeEvent(event);
    }

    console.log(JSON.stringify({ continue: true }));
  } catch (error) {
    console.error("[pre-tool-use hook error]", error);
    console.log(JSON.stringify({ continue: true }));
  }
}

main();
