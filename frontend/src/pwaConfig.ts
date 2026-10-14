import type { ManifestOptions } from "vite-plugin-pwa";

/**
 * PWA manifest + service-worker config (HEL-300, notes/mobile-pwa-handoff.md W1/W2).
 *
 * Extracted from `vite.config.ts` (which imports it) so it can be unit-tested
 * without loading the Vite config module — see `pwaConfig.test.ts`, which
 * mechanically asserts the `/api/**` network-only invariant from spec
 * `pwa-installability`.
 *
 * Colours are literal copies of `--app-bg` from `src/theme/theme.css` (light:
 * #f4f2ed, dark: #0f0e0d). The manifest is static JSON generated at build
 * time and cannot read CSS custom properties — if theme.css's `--app-bg`
 * values ever change, update them here too.
 */
export const APP_BG_LIGHT = "#f4f2ed";
export const APP_BG_DARK = "#0f0e0d";

export const pwaManifest: Partial<ManifestOptions> = {
  name: "Helio",
  short_name: "Helio",
  display: "standalone",
  start_url: "/home",
  scope: "/",
  background_color: APP_BG_LIGHT,
  theme_color: APP_BG_LIGHT,
  icons: [
    { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
    { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
    {
      src: "maskable-icon-512x512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ],
};

// `registerType: "autoUpdate"` only implies these when the plugin injects its own registration, which
// the app no longer does (the landing page must not register the worker, so main.tsx calls
// `registerSW` itself). Without them a new worker stays "waiting" behind the old one, and a browser
// holding the previous build's worker keeps answering `/` with the old app shell indefinitely.
export const swTakeoverOptions = { skipWaiting: true, clientsClaim: true } as const;

// `index.html` is the landing page; the SPA shell is `app.html`.
export const navigateFallback = "/app.html";

// Non-negotiable (HEL-300 W2 / spec pwa-installability): without the `/api/` entry the SPA
// navigate-fallback would serve the app shell for a same-origin navigation to
// /api/auth/google (dev/preview proxy), breaking OAuth and effectively
// caching an authenticated route as static HTML.
//
// HEL-1562: `/` is the landing page. Workbox matches the denylist against path PLUS query
// (NavigationRoute), so these patterns tolerate a query string: a bare `/` is answered by the
// precached landing `index.html`, and `/?ref=x` misses the precache and, being denied here, goes
// to the network, which serves the landing page. Without this, a browser holding the previous
// service worker would be shown the app shell at `/` forever.
export const navigateFallbackDenylist = [/^\/api\//, /^\/(\?.*)?$/, /^\/index\.html(\?.*)?$/];

// Deliberately no entry matching `/api` in this list — Workbox only caches
// routes it is told to cache, so omission is the enforcement mechanism for
// "API responses are never cached" (spec pwa-installability). Keep this list
// free of any pattern that could match `/api/**`.
export const pwaRuntimeCaching = [
  {
    // Google Fonts stylesheet — revalidate in the background so a font-file
    // addition/removal upstream is picked up, while still serving instantly
    // from cache on repeat/standalone loads.
    urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
    handler: "StaleWhileRevalidate" as const,
    options: {
      cacheName: "google-fonts-stylesheets",
    },
  },
  {
    // Google Fonts woff2 files — immutable content-hashed URLs, safe to
    // cache aggressively so standalone cold loads never FOUT.
    urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
    handler: "CacheFirst" as const,
    options: {
      cacheName: "google-fonts-webfonts",
      cacheableResponse: { statuses: [0, 200] },
      expiration: {
        maxEntries: 30,
        maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
      },
    },
  },
];
