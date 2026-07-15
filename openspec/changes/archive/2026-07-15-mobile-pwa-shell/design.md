## Context

The frontend (`frontend/`, Vite + React) is not installable: `vite.config.ts` has no PWA plugin, `index.html`
has no manifest/meta tags and pulls Fraunces / Schibsted Grotesk / JetBrains Mono from Google Fonts at runtime.
`notes/mobile-pwa-handoff.md` is the binding spec; this change covers W1, W2, W6, §3.2, §4.2 only.

Relevant ground truth:

- `frontend/src/main.tsx:15` wires the global 401 interceptor (`setupAuthInterceptor`) before the first API call.
- `frontend/src/features/auth/ui/LoginPage.tsx:88` starts Google OAuth via `window.location.href =
  ${API_BASE_URL}/api/auth/google` — a full navigation the service worker could intercept when same-origin.
- `theme.css`: `--app-bg` is `#121110` (dark) / `#f4f2ed` (light).
- `DESIGN.md` §4 ratifies breakpoints **1440 / 1100 / 768** only [mechanical]; a phone port needs ~430px.
- `frontend/src/features/panels/ui/PanelDetailModal.css:575` uses a stray, unratified `@media (max-width: 480px)`.
- Prod topology: frontend `helioapp.dev`, API `api.helioapp.dev` — cross-origin for the SW, but same registrable
  domain for cookies (§3.1 resolved, no action).

Every device-dependent acceptance criterion is human-verified on a real iPhone; the terminal state of this ticket
is "ready for device testing" (`.concertino/laws/verification-before-completion`).

## Goals / Non-Goals

**Goals:**

- Installable PWA: manifest, icons from `public/orbit-mark.svg`, iOS meta tags, safe-area viewport.
- Conservative service worker: app-shell precache only; `/api/**` network-only, never cached; auto-update.
- Fonts survive standalone cold loads without FOUT (cache-first, keep the trio).
- Ratify the phone breakpoint in `DESIGN.md` §4 and fold in the stray 480px.
- Prepare the standalone-OAuth fallback (hide Google button) so the device test outcome is a one-line toggle.
- Hand back a LAN-reachable build plus an ordered device test plan for the human.

**Non-Goals:**

- Panel sizing (HEL-301), navigation (HEL-302), offline data, push, Capacitor.
- Backend or `schemas/` changes. No `PanelGrid` / layout-persistence work.
- Fixing iOS's cookie jar; dynamic `theme-color` following the in-app `ThemeProvider` toggle.

## Decisions

1. **`vite-plugin-pwa` with the `generateSW` (Workbox) strategy, `registerType: "autoUpdate"`,
   `injectRegister: "auto"`.** The ticket mandates the plugin; `generateSW` over `injectManifest` because our SW
   needs zero custom logic — precache + runtime rules are fully expressible in config, and less hand-written SW
   code means less to wedge on a phone with no devtools. Registration stays out of `main.tsx`'s module body where
   practical; if a registration import is needed, it must sit *after* `setupAuthInterceptor` wiring and must not
   touch axios. `devOptions.enabled` stays false so worktree dev servers are never SW-intercepted.
2. **`/api/**` is network-only by construction, twice over.** (a) No Workbox `runtimeCaching` entry matches
   `/api` — Workbox only caches routes it is told to cache, so API responses are never stored. (b)
   `navigateFallbackDenylist: [/^\/api\//]` — without this the SPA navigate-fallback would serve `index.html`
   for the same-origin `/api/auth/google` navigation (dev/preview proxy), breaking OAuth. In prod the API is
   cross-origin (`api.helioapp.dev`) and untouched by the SW; the denylist makes dev/preview behave identically.
   The 401 interceptor is preserved because no `/api` response is ever served from cache — a 401 always reaches
   axios. An explicit Jest test asserts the generated SW config has no `/api` cache route.
3. **Fonts: cache-first runtime caching of Google Fonts, not self-hosting.** Workbox recipe:
   `StaleWhileRevalidate` for `fonts.googleapis.com` (the CSS) and `CacheFirst` (1-year expiry, ~30 entries) for
   `fonts.gstatic.com` (the woff2 files). Self-hosting was considered and rejected: ~1 MB of binary font assets
   in-repo and manual subsetting, versus a two-entry documented recipe. Trade-off: the very first visit still
   needs the network for fonts — acceptable because SW install itself requires that same network; every
   subsequent standalone cold load is cache-served (satisfies the FOUT criterion as testable on device).
4. **Icons via `@vite-pwa/assets-generator` from `public/orbit-mark.svg`**, one-shot script (`npm run
   generate-pwa-assets`), outputs committed to `public/`: 180×180 apple-touch-icon, 192/512 standard, 512
   maskable (padded so the mark survives the maskable safe zone). Generated PNGs are committed, not built in CI —
   deterministic deploys, no CI toolchain addition. Legibility on light/dark home screens is a device-test item.
5. **Manifest**: `name`/`short_name` "Helio", `display: "standalone"`, `start_url: "/"`, `scope: "/"`,
   `background_color`/`theme_color` `#f4f2ed` (light `--app-bg`). A manifest holds one colour pair; light chosen
   as splash default. `index.html` gets dual `<meta name="theme-color">` tags with `prefers-color-scheme` media
   (`#f4f2ed` / `#121110`) so the iOS status bar follows OS appearance; following the in-app ThemeProvider toggle
   dynamically is out of scope (recorded in Planner Notes).
6. **`index.html` additions**: `viewport-fit=cover` appended to the existing viewport meta,
   `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style: default` (opaque bar, correct for an
   opaque `--app-bg` shell per DESIGN.md's opacity invariant), `apple-touch-icon` link, dual theme-color.
7. **Ratify the phone breakpoint at 430px** in `DESIGN.md` §4 — canonical set becomes 1440 / 1100 / 768 / 430.
   430px covers every iPhone portrait width (largest is 430–440pt) while staying clear of small tablets.
   Rationale line goes in the doc per its own "never silently diverge" rule. `PanelDetailModal.css:575` changes
   `480px` → `430px` — folding the one pre-existing violation into the ratified value (behaviour delta: viewports
   431–480px keep the two-column modal row, which is the desktop-correct outcome).
8. **OAuth-in-standalone: ship the Google button visible; pre-build the fallback as an inert, one-line toggle.**
   The device test answers §3.2; hiding pre-emptively would remove a possibly-working login path. The executor
   writes the exact CSS rule (`@media (display-mode: standalone) and (max-width: 430px)` hiding
   `.auth-google-btn`) into the device-test plan as the prepared remediation, applied only if the human reports
   OAuth failing in standalone. Password login (`POST /api/auth/login`, pure XHR) is the guaranteed path either
   way. Outcome is recorded on HEL-300 per the acceptance criteria.
9. **Login/Register keyboard usability**: audit auth-page CSS for `100vh` (a lie on iOS Safari) and replace with
   `100dvh` where found; keep existing `autocomplete` attributes untouched so iOS offers Keychain. On-device
   keyboard check is in the human test plan.

## Risks / Trade-offs

- [A wedged SW on a phone is near-unrecoverable] → `autoUpdate` + conservative `generateSW`; no custom SW code;
  `/api` never cached so auth state can never be trapped stale.
- [SW intercepts the OAuth navigation in preview and serves the app shell] → `navigateFallbackDenylist`
  (Decision 2b); explicitly part of the device test plan.
- [Manifest/meta colours drift from `theme.css` if tokens change] → values are duplicated by necessity (manifest
  is static JSON); comment in `vite.config.ts` points back at `theme.css` as source.
- [Maskable icon crops the OrbitMark] → assets-generator padding preset; verified visually on device.
- [First-ever load on a dead connection still FOUTs] → inherent to any SW strategy (install needs network);
  accepted, matches the AC's "standalone cold load" framing.
- [431–480px modal-row behaviour change from folding 480→430] → tiny window, no known device; desktop unchanged.

## Migration Plan

Ships through the existing Firebase Hosting pipeline unchanged. Rollback = revert the commit; browsers with the
SW installed self-heal via `autoUpdate` on next visit (new deploy serves an updated SW; a full removal would ship
`selfDestroying: true` if ever needed).

## Open Questions

- §3.2: does Google OAuth complete inside iOS standalone? Answer comes only from the human device test; both
  outcomes have a prepared path (Decision 8).

## Planner Notes

- Self-approved: `vite-plugin-pwa` + `@vite-pwa/assets-generator` dev-dependencies — mandated verbatim by the
  ticket, so not treated as an escalation-worthy new external dependency.
- Self-approved: 430px (not 480px) as the ratified phone value; 480 was the accident being folded in, not a
  precedent (handoff §4.2 says "~430px").
- Self-approved: static light-theme manifest colours + `prefers-color-scheme` meta pair; dynamic theme-color
  tracking of ThemeProvider is deferred (would need JS meta mutation; no ticket requirement).
- Self-approved: committing generated icon PNGs to `public/` rather than generating in CI.
