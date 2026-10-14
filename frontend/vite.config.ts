import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { visualizer } from "rollup-plugin-visualizer";

import { planNumbersPlugin } from "./src/landing/planNumbersPlugin";
import { shellRoutingPlugin } from "./src/landing/shellRoutingPlugin";
import {
  navigateFallback,
  navigateFallbackDenylist,
  pwaManifest,
  pwaRuntimeCaching,
  swTakeoverOptions,
} from "./src/pwaConfig";

const backendPort = parseInt(process.env.BACKEND_PORT ?? "8080");

// HEL-512 — bundle-composition report, opt-in only (`npm run build:analyze`, or
// `ANALYZE=true npm run build`). Never added to the plugin list on an ordinary `npm run build`,
// so prod build output/timing are unaffected. Report lands in `dist/`, which is already
// git-ignored — see `.gitignore`.
const analyzeBuild = process.env.ANALYZE === "true";

export default defineConfig({
  plugins: [
    shellRoutingPlugin(),
    planNumbersPlugin(),
    react(),
    ...(analyzeBuild
      ? [
          visualizer({
            filename: "dist/stats.html",
            gzipSize: true,
            brotliSize: true,
            template: "treemap",
          }),
        ]
      : []),
    VitePWA({
      registerType: "autoUpdate",
      // The landing page must not register the service worker, so registration is an explicit
      // `virtual:pwa-register` call in the app entry (main.tsx) instead of an injected script.
      injectRegister: false,
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
        ...swTakeoverOptions,
        navigateFallback,
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
  // Two HTML entries: `index.html` is the static landing page served at `/`, `app.html` is the
  // SPA shell every other path falls back to.
  build: {
    rolldownOptions: {
      input: {
        index: resolve(import.meta.dirname, "index.html"),
        app: resolve(import.meta.dirname, "app.html"),
      },
    },
  },
  server: {
    port: parseInt(process.env.PORT ?? "5173"),
    strictPort: true,
    proxy: {
      "/api": `http://localhost:${backendPort}`,
      "/health": `http://localhost:${backendPort}`,
    },
  },
});
