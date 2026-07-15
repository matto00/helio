import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

import { navigateFallbackDenylist, pwaManifest, pwaRuntimeCaching } from "./src/pwaConfig";

const backendPort = parseInt(process.env.BACKEND_PORT ?? "8080");

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      // Never intercept the dev server — worktree dev servers must not be
      // SW-controlled (design.md decision 1).
      devOptions: {
        enabled: false,
      },
      includeAssets: ["orbit-mark.svg"],
      manifest: pwaManifest,
      workbox: {
        // App-shell precache only (JS/CSS/HTML/icons/fonts emitted by the
        // build). `/api/**` is never listed here and never will be — see
        // pwaRuntimeCaching (src/pwaConfig.ts), none of whose rules match
        // `/api`.
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        navigateFallbackDenylist,
        runtimeCaching: pwaRuntimeCaching,
      },
    }),
  ],
  server: {
    port: parseInt(process.env.PORT ?? "5173"),
    strictPort: true,
    proxy: {
      "/api": `http://localhost:${backendPort}`,
      "/health": `http://localhost:${backendPort}`,
    },
  },
});
