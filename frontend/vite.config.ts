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
        // HEL-553: the single main JS chunk (no route-level code-splitting
        // yet) was already at ~2.04 MiB before this change and crossed
        // workbox's 2 MiB default `maximumFileSizeToCacheInBytes` precache
        // limit once the Metrics feature's code landed, failing `vite
        // build`'s SW-generation step outright. Raised with headroom for
        // near-term growth rather than re-tuned per feature; route-level
        // code-splitting (the plugin's own suggested alternative) is a
        // larger, separate change.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
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
