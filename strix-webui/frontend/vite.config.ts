import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "../shared/src"),
    },
  },
  server: {
    port: 5173,
    open: true,
    hmr: { port: 5173 },
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
