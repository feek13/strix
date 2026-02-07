#!/usr/bin/env node
import type { HookInput, InternalEvent } from "@strix-webui/shared";
import { readStdin, writeEvent, truncateOutputIfNeeded } from "./utils.js";

async function main(): Promise<void> {
  try {
    const input = await readStdin();
    const hookInput: HookInput = JSON.parse(input);
    const timestamp = new Date().toISOString();
    const scanId = process.env.STRIX_SCAN_ID || "default";

    if (hookInput.tool_name && hookInput.tool_use_id) {
      const truncatedOutput = truncateOutputIfNeeded(hookInput.tool_response);

      const event: InternalEvent = {
        type: "TOOL_COMPLETED",
        timestamp,
        scanId,
        sessionId: hookInput.session_id,
        toolUseId: hookInput.tool_use_id,
        toolName: hookInput.tool_name,
        toolInput: hookInput.tool_input || {},
        toolOutput: truncatedOutput,
      };
      writeEvent(event);
    }

    console.log(JSON.stringify({ continue: true }));
  } catch (error) {
    console.error("[post-tool-use hook error]", error);
    console.log(JSON.stringify({ continue: true }));
  }
}

main();
