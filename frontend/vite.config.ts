import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const backendPort = parseInt(process.env.BACKEND_PORT ?? "8080");

export default defineConfig({
  plugins: [react()],
  server: {
    port: parseInt(process.env.PORT ?? "5173"),
    strictPort: true,
    proxy: {
      "/api": `http://localhost:${backendPort}`,
      "/health": `http://localhost:${backendPort}`,
    },
  },
});
