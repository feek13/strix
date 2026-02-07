import "dotenv/config";
import { createRestServer } from "./server/rest-api.js";
import { createWebSocketServer } from "./server/websocket.js";

const REST_PORT = parseInt(process.env.PORT || "3000", 10);
const WS_PORT = parseInt(process.env.WS_PORT || "3001", 10);

createRestServer(REST_PORT);
createWebSocketServer(WS_PORT);

console.log(`[Strix WebUI] Backend started`);
console.log(`[Strix WebUI] REST API: http://localhost:${REST_PORT}`);
console.log(`[Strix WebUI] WebSocket: ws://localhost:${WS_PORT}`);
