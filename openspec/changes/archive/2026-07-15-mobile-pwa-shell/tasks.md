## 1. Frontend — PWA shell (W1)

- [x] 1.1 Add `vite-plugin-pwa` and `@vite-pwa/assets-generator` as frontend devDependencies
- [x] 1.2 Generate icons from `public/orbit-mark.svg` (180 apple-touch, 192/512 standard, 512 maskable); commit PNGs to `public/`
- [x] 1.3 Configure `VitePWA` in `vite.config.ts`: manifest (name/short_name "Helio", standalone, start_url/scope "/", `--app-bg` colours, icon set), `registerType: "autoUpdate"`, `injectRegister: "auto"`, devOptions disabled
- [x] 1.4 `index.html`: add `viewport-fit=cover`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `apple-touch-icon` link, dual `prefers-color-scheme` theme-color metas (#f4f2ed / #121110)

## 2. Frontend — Service worker rules (W2 + fonts)

- [x] 2.1 Workbox config: precache app shell only; `navigateFallbackDenylist: [/^\/api\//]`; no runtime caching rule matching `/api`
- [x] 2.2 Font runtime caching: StaleWhileRevalidate for `fonts.googleapis.com`, CacheFirst with long expiry for `fonts.gstatic.com`; font links stay in `index.html`
- [x] 2.3 Verify SW registration does not disturb `setupAuthInterceptor` wiring in `main.tsx` (interceptor set before first API call, axios untouched)

## 3. Frontend — Breakpoint ratification (§4.2)

- [x] 3.1 Amend `DESIGN.md` §4: ratify 430px (canonical set 1440/1100/768/430) with a one-line rationale
- [x] 3.2 Fold `PanelDetailModal.css:575` `480px` → `430px`; grep `frontend/` media queries to confirm no other undocumented values

## 4. Frontend — Auth on phone (W6 / §3.2)

- [x] 4.1 Audit auth pages (`LoginPage`/`RegisterPage` CSS) for `100vh`; replace with `100dvh` where found; keep `autocomplete` attributes
- [x] 4.2 Write the prepared OAuth fallback (hide `.auth-google-btn` under `@media (display-mode: standalone) and (max-width: 430px)`) into the device test plan as an inert remediation — do NOT apply it pre-emptively

## 5. Tests & verification gates

- [x] 5.1 Jest test asserting the PWA config: no `/api` runtime cache route, navigateFallbackDenylist covers `/api`, manifest fields (standalone, scope, icons)
- [x] 5.2 `npm run lint`, `npm test`, `npm run build` clean; confirm no backend or `schemas/` diffs
- [x] 5.3 Verify built output: `dist/` contains manifest + SW, precache manifest excludes `/api`, icons emitted

## 6. Handoff — device test readiness

- [x] 6.1 Start LAN-reachable preview (`npm --prefix frontend run build && npx vite preview --host`) and record the URL
- [x] 6.2 Write ordered iPhone test plan (install, standalone launch, icon light/dark, notch, fonts cold-load, OAuth-in-standalone with prepared fallback, keyboard-up login, ≥768px unchanged) into `files-modified.md` handoff notes
