# HEL-300 — Mobile PWA shell — manifest, icons, service worker, breakpoint ratification

## Description

Make the Helio frontend installable to an iPhone home screen and launchable standalone. **Unblocks the rest of the project** — ratifies the phone breakpoint that both sibling tickets depend on, and retires the one open risk (OAuth in standalone mode) before any design effort is spent.

`notes/mobile-pwa-handoff.md` **is the binding spec.** Read it in full first, including its §0 instruction to read `DESIGN.md` and `CONTRIBUTING.md`. This ticket is spec sections **W1, W2, W6, §3.2, and §4.2** (NOT W3/W4/W5 — those belong to sibling tickets HEL-301/HEL-302).

## Scope

### W1 — PWA shell

- Add `vite-plugin-pwa` to `frontend/`; configure in `vite.config.ts`.
- Manifest: `name: "Helio"`, `short_name: "Helio"`, `display: "standalone"`, `start_url: "/"`, `scope: "/"`, colours from `theme.css`.
- Icons from the existing `public/orbit-mark.svg` via `@vite-pwa/assets-generator`: 180×180 apple-touch-icon, 192/512 standard, 512 maskable. Check the OrbitMark reads on both light and dark iOS home screens.
- `index.html`: `viewport-fit=cover`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `apple-touch-icon`, dual `theme-color` (light/dark, sourced from `--app-bg`).

### W2 — Service worker (deliberately conservative)

- **Precache:** built JS/CSS/fonts/icons — app shell only.
- **Network-only, never cached:** everything under `/api/**`. Non-negotiable — these responses are authenticated and user-specific. A cached `/api/auth/me` is a correctness bug; a cached response served to the wrong session is a security bug.
- Must not break the 401 interceptor in `main.tsx`.
- `registerType: "autoUpdate"`. A wedged service worker on a phone with no devtools is genuinely hard to recover from.

### Fonts (spec §4.3)

`index.html` pulls Fraunces / Schibsted Grotesk / JetBrains Mono from Google Fonts. A standalone PWA on a bad connection will flash unstyled text. Self-host into `public/` or give fonts a cache-first rule. **Do not drop the font trio.**

### §4.2 — Ratify the phone breakpoint in `DESIGN.md` (unblocks HEL-301 and HEL-302)

`DESIGN.md` §4 currently ratifies **1440 / 1100 / 768** and says media queries use "these values only **[mechanical]**", plus *"never silently diverge"*. A phone port needs ~430px.

**Amend** `DESIGN.md` **§4 explicitly** — ratify the phone breakpoint in the doc with a one-line rationale. Do not quietly add a `@media (max-width: 430px)`. Note `PanelDetailModal.css:575` already uses a stray `480px` — fold it into whatever you ratify rather than leaving two undocumented values.

### §3.2 / W6 — Google OAuth in standalone (the open risk)

`LoginPage.tsx:88` does a full cross-origin navigation: `window.location.href = ${API_BASE_URL}/api/auth/google`.

**iOS standalone PWAs have a separate cookie jar from Safari.** Historically this punted users into Safari, completing OAuth in the wrong jar and leaving the PWA permanently logged out. iOS 16.4+ improved this, but it is version-sensitive and **must be tested on the device, not reasoned about**.

Mitigation already exists: email/password login is a pure XHR (`POST /api/auth/login`) and cannot break out of the PWA. **If OAuth fails in standalone, hide the Google button below the phone breakpoint and let password auth carry the phone.** Do not attempt to fix iOS's cookie jar.

Also: `LoginPage` / `RegisterPage` must be usable with the iOS keyboard up — inputs must not slide under it. Keep the existing `autocomplete` attributes so iOS offers Keychain.

## Out of scope

Panel sizing (HEL-301), navigation (HEL-302), offline data, push, Capacitor, backend or `schemas/` changes.

## Acceptance criteria

- [ ] Installs to iPhone home screen; launches standalone with correct icon, no browser chrome, no notch overlap, correct light/dark + accent.
- [ ] Service worker never caches `/api/**`; 401 interceptor still works.
- [ ] Fonts do not FOUT in standalone on a cold load.
- [ ] `DESIGN.md` §4 amended and the stray 480px folded in.
- [ ] OAuth-in-standalone answered on a real device, with the outcome recorded on this ticket. If it fails, Google button hidden below the phone breakpoint.
- [ ] Desktop and iPad ≥768px visually and behaviourally unchanged.
- [ ] `npm run lint && npm test` clean; Husky pre-commit passes. No backend or schema changes.

## IMPORTANT — Verification is human-performed; do not claim "done"

**Every acceptance criterion above requires a physical iPhone. No agent can verify any of them.** A 390px desktop viewport proves nothing about iOS standalone mode, Safari's cookie jar, or the home screen.

`.concertino/laws/verification-before-completion` requires fresh evidence, which cannot be produced by an agent here. **The correct terminal state for this ticket is "ready for device testing", not "done."**

The executor must hand back with:

1. A build reachable from the phone: `npm --prefix frontend run build && npx vite preview --host` (phone on the same wifi).
2. An explicit, ordered test plan for the human (Matt / matto00) to run on a real iPhone.

The evaluator and skeptic must NOT accept a desktop viewport as proof of any device-dependent acceptance criterion, and must not claim those criteria are verified. Code-level criteria (service worker never caches `/api/**`, 401 interceptor intact, lint/test clean, DESIGN.md amended, no backend/schema changes) CAN be verified without a device and should be.

The orchestrator will present the build + test plan to the human and relay results before this ticket is considered complete. If results come back bad, iterate.

Debugging aid: Safari on macOS can remote-inspect a standalone PWA on a physical iPhone over USB (phone: Settings → Safari → Advanced → Web Inspector).

## Binding references

- `notes/mobile-pwa-handoff.md` — binding spec (read in full; this ticket = W1, W2, W6, §3.2, §4.2 only)
- `DESIGN.md` — design-language standard (frontend)
- `CONTRIBUTING.md` — code-quality standard
- `.concertino/laws/verification-before-completion`
