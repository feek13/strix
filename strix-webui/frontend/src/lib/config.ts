/**
 * Runtime configuration for backend connectivity.
 *
 * When running inside a Tauri desktop app (`window.__TAURI__` exists),
 * the Rust backend is embedded — so we connect to localhost.
 * When running as a standalone web app, we use the current hostname
 * (which may be the same dev machine or a remote server).
 */

declare global {
  interface Window {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: {
      invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    };
  }
}

/** True when running inside a Tauri webview. */
export const IS_TAURI =
  typeof window !== "undefined" &&
  (window.__TAURI__ !== undefined || window.__TAURI_INTERNALS__ !== undefined);

const hostname =
  typeof window !== "undefined" ? window.location.hostname : "localhost";

/** Base URL for REST API calls (e.g. "/api/scans"). */
export const API_BASE_URL = IS_TAURI
  ? "http://localhost:3000"
  : "";

/** WebSocket URL for real-time event stream. */
export const WS_URL = IS_TAURI
  ? "ws://localhost:3001"
  : `ws://${hostname}:3001`;
