#!/usr/bin/env node
import { readStdin } from "./utils.js";

async function main(): Promise<void> {
  try {
    const input = await readStdin();
    const parsed = JSON.parse(input);
    const chatSessionId = process.env.STRIX_CHAT_SESSION_ID;

    // Only notify for Ask AI sessions (not scans or terminal claude usage)
    if (chatSessionId) {
      try {
        await fetch(`http://localhost:${process.env.PORT || 3000}/api/internal/compacting`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chatSessionId,
            claudeSessionId: parsed.session_id,
            trigger: parsed.trigger || "auto",
          }),
        });
      } catch { /* backend might not be running */ }
    }

    console.log(JSON.stringify({ continue: true }));
  } catch {
    console.log(JSON.stringify({ continue: true }));
  }
}

main();
