# HEL-772: Mobile top bar: anchor to the top of the screen, stop it scrolling away, reduce height

## Description

Product-owner feedback from the installed PWA on iOS (2026-08-20), covering three
related defects in the mobile top bar. They are grouped because all three edit
`.app-shell` and `.app-command-bar` in `frontend/src/app/App.css`; splitting them
would only produce merge conflicts.

**1. The command bar scrolls up and collides with the OS status bar.** Scrolling a
dashboard on mobile drags the whole app shell upward, so the command bar slides
beneath the status bar and the two overprint — the clock renders on top of the app
title, reading as `He5:56ews Overview`. The command bar is app chrome and must never
scroll.

**2. The command bar does not reach the top of the screen.** It sits below an inert
band of OS chrome, so the app reads as detached from the top of the display rather
than as one continuous surface.

**3. The bar is taller than it needs to be** and its icons are larger than necessary,
spending vertical space that matters on a phone.

## Root cause (verified in code, re-confirmed during planning)

- `.app-shell` is `height: 100vh` (`App.css:5`). On iOS, `100vh` is the *largest*
  viewport, so the shell exceeds the visible area, the document scrolls as a whole,
  and the command bar — which is `position: relative` (`App.css:49`), not sticky —
  travels with it. `100dvh` is already used elsewhere in this codebase
  (`PanelDetailModal.mobile.css:14`, `auth.css:6`, `App.css:432`); the app shell was
  simply never migrated.
- **No `env(safe-area-inset-top)` exists anywhere in the codebase.** Only `-bottom`
  is used (`App.css:424`, `BottomNav.css:27-28`, `MobileNavSheet.css:41`), so nothing
  reserves or claims the top inset. This change introduces it.
- `index.html:14` sets `apple-mobile-web-app-status-bar-style: default`, which keeps
  the status bar as opaque OS chrome and prevents content extending under it.
  `viewport-fit=cover` is already present (`index.html:5`).
- **Correction to the ticket's stated 48px.** `height: 48px` (`App.css:40`) is the
  *desktop* value. Below 768px the bar is already `height: var(--space-10)` = **64px**
  (`App.css:383`), raised from 48px deliberately by HEL-745 to clear the 44px
  IconButton tap floor with more than 2px per side. The height reduction in this
  ticket is therefore 64px -> target, not 48px -> target.

## Scope

- Migrate `.app-shell` off `100vh` to a dynamic-viewport unit so the shell matches the
  visible viewport and the document does not scroll as a whole. Scrolling belongs to
  the content region (`.app-content`), not the shell.
- Make the command bar structurally non-scrolling on mobile, so it is never occluded
  by, and never overprints, the status bar.
- Claim the top safe-area inset so the bar's own surface extends to the physical top
  of the screen and no inert band remains above it.
- Reduce the mobile command bar's height and bring its icon glyph sizing down
  proportionally — **without** breaking the >=44px touch-target floor on any
  interactive control. This repo has regressed that floor repeatedly (HEL-745,
  HEL-747, HEL-314, HEL-319, and HEL-535's cycle-1 defect where a `@media` block sat
  *above* the base rule so equal specificity made the floor inert). The visible bar
  may shrink; the tap targets may not.
- ~~Verify the status-bar glyphs remain legible against the bar in both themes once
  content sits under them.~~ **RETIRED by decision D2 below** — struck here, not just in
  the AC list, so the archived artifact does not preserve a requirement nobody is
  permitted to meet.

## Out of scope

- Bottom nav styling (HEL-774's ticket).
- The navigation sheet's direction (HEL-773's ticket).
- Hiding the OS clock/battery — **not possible in an iOS PWA.** `black-translucent`
  reclaims the space visually by letting content render beneath the status bar, but
  the glyphs still paint on top. Android Chrome honours `display: fullscreen` in the
  manifest; iOS ignores it. **Do not spend any time attempting this.**

## Acceptance criteria

- [ ] Scrolling any mobile page never moves the command bar, and the bar and the OS
      status bar never overprint at any scroll position.
- [ ] The command bar's surface extends to the physical top of the screen; no inert
      band remains above it.
- [ ] The app shell matches the visible viewport on iOS Safari and in the installed
      PWA, including after browser-chrome show/hide.
- [ ] Command bar height is reduced from its current mobile value (64px), with every
      interactive control still >=44px in its tap dimension.
- [ ] ~~Status-bar glyphs are legible over the command bar in light and dark.~~
      **RE-SCOPED BY PRODUCT OWNER (see DECISIONS below).** Not verifiable in this
      environment. Replaced by: the bar reaches the physical top; the top inset is
      correctly applied and correctly sized; nothing overprints at any scroll
      position.
- [ ] Verified in a correctly-configured emulation at 430px and 375px, in both themes
      — not by unit test alone.
- [ ] `npm run lint` / `npm test` pass with zero new warnings.

## DECISIONS — PRODUCT OWNER, BINDING (resolved during Planning)

Two ticket premises were escalated during Planning and answered directly by the
product owner. Both answers are binding on every downstream role.

**D1 — Mobile command bar height: `calc(var(--control-lg) + var(--space-4))` (56px).**
Reclaims 8px from the current 64px while keeping 6px clearance per side over the 44px
`IconButton` floor. **Compute the value locally. Do NOT take a dependency on
`BottomNav`'s tokens, rules, or `--bottom-nav-height`.** HEL-774 is concurrently
reshaping the bottom nav into a floating capsule, which changes its geometry and the
meaning of that token; this bar must not follow it when that lands. The top/bottom
chrome symmetry is **intentional-at-this-moment, not a maintained invariant** — a
future divergence is expected and must not be "fixed".

**D2 — `black-translucent`: implement the ticket literally.** `black-translucent` plus
`padding-top: env(safe-area-inset-top)`, in **both** themes. **No dark inset band, no
dark-bar treatment.** The product owner verifies on a physical iPhone post-merge.

**Consequence of D2 — binding on the executor, evaluator, and skeptic:**

- Light-theme status-bar glyph legibility is a **known-unverified risk explicitly
  accepted by the product owner.** The specific concern is white/light status-bar
  glyphs painted over the light-theme bar surface `--app-surface` (~`#f4f2ed`).
- **Nobody is required to prove it, and nobody may claim it.** Do **not** attempt to
  verify it in headless Chromium — Chromium does not reproduce iOS status-bar
  painting, so a green result there would be meaningless, and an unfounded legibility
  claim in a report or a commit message is itself a defect.
- **Skeptic, explicitly:** do **not** fail the final gate on the original
  "legible in light and dark" AC — it has been deliberately re-scoped by the product
  owner. Equally, do **not** accept an unfounded legibility claim if the executor
  makes one. Judge the re-scoped criteria instead: bar reaches the physical top, inset
  applied and correctly sized, no overprint at any scroll position.
- Fallbacks, already considered and rejected *for now*, recorded so that a failed
  device check has a designed remedy rather than a rediscovery: (a) a dark surface over
  the `env(safe-area-inset-top)` strip **only**, bar body keeping `--app-surface`;
  (b) a dark command bar in both themes.

**D3 — the 48px premise in the original ticket was wrong** (`App.css:40` read without
the `<=768px` override at `App.css:383`). Corrected throughout this file and in
`design.md` so the archived artifacts do not preserve the wrong number.

## FILE-OVERLAP FENCE — HEL-774 IS RUNNING IN PARALLEL

HEL-774 (Liquid Glass bottom nav) is being delivered concurrently and shares
`frontend/src/app/App.css`.

- **This ticket owns:** `.app-shell` and `.app-command-bar` (and its descendants) in
  `App.css`; `frontend/index.html` meta tags; new top-inset tokens in `theme.css`.
- **HEL-774 owns:** `BottomNav.css`, `BottomNav.tsx`, and the bottom-nav
  **content-clearance rule at `App.css:424`** (`.app-content { padding-bottom: ... }`).
- **Do not touch `App.css:424` or any `BottomNav.*` file.** If you believe you must,
  **stop and escalate to the orchestrator** rather than editing it.

**HEL-548 is also live concurrently** (empty-state CTAs). Stay out of `DashboardList`,
`SourcesPage`, `PipelinesPage`, `TypeRegistryBrowser`, `PanelCreationModal`, and
`shared/ui/EmptyState.tsx`. If you believe you need one of them, **escalate rather than
edit**. Note `PanelCreationModal.css` is theirs; `PanelDetailModal.mobile.css` (a different
file) is ours.

## UI/UX EMPHASIS — BINDING ON EXECUTOR, EVALUATOR, AND SKEPTIC

This is a pure mobile chrome ticket on the surface beta users see first. Passing tests
are necessary but nowhere near sufficient.

1. **`DESIGN.md` is binding.** Token discipline is absolute: zero hardcoded colors,
   spacing, or type. Open token-drift tickets already exist (HEL-652, HEL-680,
   HEL-677) because past work leaked literals. The one sanctioned literal in this area
   is the mobile `44px` tap floor, which DESIGN.md S3 explicitly ratifies.
2. **The >=44px touch-target floor is non-negotiable, and this repo has regressed it
   five times** (HEL-745, HEL-747, HEL-314, HEL-319, HEL-535). **Verify the floor with
   `getComputedStyle`/`getBoundingClientRect` at 430 and 768, not by reading the CSS**
   — that is exactly how HEL-535's inert-cascade bug hid (a `@media` block placed
   above the base rule, equal specificity, so the floor never won).
3. **Verify in a real browser, measured.** The core claims are geometric: the bar does
   not move on scroll, it reaches the physical top, nothing overprints. Capture
   positions across a scroll trace and compare numerically — do not eyeball. Both
   themes, 430 and 375.
4. **The status-bar overprint is the headline defect.** Reproduce it first on the
   unfixed build so you know your probe detects it, then prove it gone. A fix verified
   only against the fixed build proves nothing.
5. **Accessibility:** the bar must remain reachable and correctly labelled;
   `prefers-reduced-motion` respected for any transition added.

**Skeptic:** you own subjective design judgement. If it is technically correct but
reads as unpolished or cramped next to the rest of the app, say so and fail the gate.

## ENVIRONMENT CONSTRAINTS

- **Do NOT use the MCP Playwright tools.** The MCP Playwright session is
  single-instance and shared, and two other delivery runs are driving browsers
  concurrently. Launch your **own headless Chromium** instead — Playwright is
  installed, executable under `~/.cache/ms-playwright/chromium-1208`. A browser that
  appears to be steered by someone else is expected, not a defect.
- `scripts/check-openspec-hygiene.mjs` false-positives "complete but not archived" on
  implementation commits (HEL-657). Expect `git commit -n`; **disclose it explicitly
  and confirm the other five checks passed first.** Never bypass for anything else.
- Root jest no longer runs worktree tests (HEL-768) — use this worktree's own
  `npm test` and `npm --prefix frontend test`.

## Related

Product-owner mobile feedback batch (2026-08-20) alongside HEL-773 (nav sheet) and
HEL-774 (bottom nav). Touch-target regressions: HEL-745, HEL-747, HEL-314, HEL-319.
