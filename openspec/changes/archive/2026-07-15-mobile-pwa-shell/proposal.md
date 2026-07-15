## Why

The Helio frontend is not installable to a phone home screen and has no standalone launch mode.
This blocks the two follow-on mobile tickets (viewer grid sizing, native navigation), which both
need a ratified phone breakpoint before any mobile CSS is written, and leaves an open risk (does
Google OAuth survive iOS standalone mode?) unanswered before further mobile design investment.

## What Changes

- Add `vite-plugin-pwa` with a web app manifest (`name/short_name: "Helio"`, `display: standalone`,
  colours sourced from `theme.css`) and generated icons (180×180 apple-touch-icon, 192/512 standard,
  512 maskable) from the existing `public/orbit-mark.svg`.
- `index.html`: `viewport-fit=cover`, `apple-mobile-web-app-capable`,
  `apple-mobile-web-app-status-bar-style`, `apple-touch-icon` link, dual light/dark `theme-color`.
- Register a deliberately conservative service worker (`registerType: "autoUpdate"`): precache the
  built app shell (JS/CSS/fonts/icons) only; `/api/**` is always network-only — **BREAKING if
  violated**, so this is enforced as a non-negotiable routing rule, not a default. Must not break
  the existing 401 interceptor in `main.tsx`.
- Self-host or cache-first the Fraunces / Schibsted Grotesk / JetBrains Mono font trio so standalone
  cold loads don't FOUT.
- Amend `DESIGN.md` §4 to ratify a phone breakpoint (~430px) with a one-line rationale, folding in
  the stray undocumented `480px` in `PanelDetailModal.css:575`.
- Test Google OAuth in iOS standalone on a real device; if it breaks (separate cookie jar), hide the
  "Continue with Google" button below the phone breakpoint in standalone mode and rely on the
  existing password XHR login, which cannot break out of the PWA. Record the outcome on HEL-300.
- Verify `LoginPage`/`RegisterPage` inputs stay visible with the iOS keyboard up.

## Capabilities

### New Capabilities

- `pwa-installability`: web app manifest, icons, `index.html` PWA meta tags, service worker
  registration and caching rules (app-shell precache, `/api/**` network-only, font caching).

### Modified Capabilities

- `frontend-auth-ui`: the Google login button becomes conditionally hidden below the ratified phone
  breakpoint when running in standalone display mode, per the on-device OAuth test outcome.
- `helio-design-tokens`: ratify a phone breakpoint token/value in `DESIGN.md` §4 and fold the stray
  `480px` in `PanelDetailModal.css` into it.

## Impact

- `frontend/vite.config.ts`, `frontend/index.html`, `frontend/public/` (new icons, fonts),
  `frontend/src/main.tsx` (SW registration, must preserve 401 interceptor),
  `frontend/src/**/LoginPage.tsx` (conditional Google button), `DESIGN.md`,
  `frontend/src/**/PanelDetailModal.css` (480px → ratified token).
- New dependencies: `vite-plugin-pwa`, `@vite-pwa/assets-generator` (dev-time icon generation).
- No backend or `schemas/` changes.

## Non-goals

Panel sizing (HEL-301), navigation tab bar / dashboard sheet (HEL-302), offline dashboard data,
push notifications, Capacitor/native wrapper, iPad-specific work.
