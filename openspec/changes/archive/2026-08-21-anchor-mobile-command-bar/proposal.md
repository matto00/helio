## Why

On the installed iOS PWA the mobile command bar scrolls away and overprints the OS status bar (the
clock renders over the app title as `He5:56ews Overview`), sits below an inert band instead of
reaching the physical top, and spends vertical space a phone cannot afford. The cause is
structural: `.app-shell` is `height: 100vh` (`App.css:5`), and on iOS `100vh` is the *largest*
viewport, so the shell exceeds the visible area and the document scrolls as a whole — carrying the
`position: relative` command bar (`App.css:49`) with it. Nothing reserves the top safe-area inset.

## What Changes

- `.app-shell` moves off `100vh` to a dynamic-viewport unit, so the document never scrolls as a
  whole; scrolling stays in `.app-content`.
- The mobile command bar becomes structurally non-scrolling, so it can never be occluded by, or
  overprint, the status bar at any scroll position.
- The top safe-area inset is claimed for the first time here, through a **single reusable seam**
  (`--app-safe-top` / `--app-top-chrome-height` in `theme.css`) rather than a one-off
  `padding-top`. HEL-773's nav sheet consumes the seam instead of re-deriving the inset.
- `index.html`'s `apple-mobile-web-app-status-bar-style`: `default` -> `black-translucent`.
- Mobile bar height 64px -> 56px (`calc(var(--control-lg) + var(--space-4))`), and the bar's painted
  controls return to their 28px desktop size, keeping a 44px hit area via a sized `::after` — a real
  16px reduction in painted weight rather than a glyph tweak.

## Capabilities

### New Capabilities

- `mobile-app-shell-anchoring`: the shell matches the visible viewport, the mobile command bar
  never scrolls, and the top safe-area inset is claimed through one reusable token seam.

### Modified Capabilities

- `command-bar-touch-target-framing`: mobile height changes from `var(--space-10)` (64px) to
  `calc(var(--control-lg) + var(--space-4))` (56px). The framing guarantee is unchanged — clearance
  around the 44px floor goes 10px -> 6px per side, still visible, never edge-to-edge. The CSS-lock
  test (`App.css.test.ts:92`) pins the old token and is updated in lockstep.

## Impact

- `App.css` (`.app-shell`, `.app-command-bar` and descendants), `theme.css` (tokens + ancestor chain),
  `index.html` (meta), `UserMenu.css` (avatar hit area), `PanelDetailModal.mobile.css` (mobile modal header).
- Tests: `App.css.test.ts` (updated), plus new `theme.css.test.ts` and `UserMenu.css.test.ts` CSS-locks.
- No `.tsx` file, no backend, API, schema, or dependency change.
- **Fenced off:** `App.css:424`'s bottom-nav clearance rule and all `BottomNav.*` files belong to
  HEL-774, delivered concurrently. Untouched here.

## Non-goals

- Bottom-nav styling (HEL-774); nav-sheet direction (HEL-773).
- Hiding the OS clock/battery — impossible in an iOS PWA; not attempted.
- Proving light-theme status-bar legibility: a known-unverified risk accepted by the product owner
  (ticket.md D2), unverifiable in headless Chromium, checked on a physical device post-merge.
