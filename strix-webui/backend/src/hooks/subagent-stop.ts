#!/usr/bin/env node
import type { HookInput, InternalEvent } from "@strix-webui/shared";
import { readStdin, writeEvent } from "./utils.js";

async function main(): Promise<void> {
  try {
    const input = await readStdin();
    const hookInput: HookInput = JSON.parse(input);

    const event: InternalEvent = {
      type: "AGENT_STOPPED",
      timestamp: new Date().toISOString(),
      sessionId: hookInput.session_id,
    };
    writeEvent(event);
  } catch (error) {
    console.error("[subagent-stop hook error]", error);
  }
}

main();
