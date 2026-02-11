export function getUserId(): string {
  // Use a stable ID across all clients (Tauri, browser, etc.) so chat sessions
  // are shared. Strix is a single-user local tool — no multi-user isolation needed.
  return "tauri-local";
}
