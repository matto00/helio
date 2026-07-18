## Why

The shared `ui-select` popover option rows render ~34px tall on mobile — the same sub-44px touch-target
defect class HEL-245/255/248/303 fixed inside the panel-detail editor, but living in the shared component
(`frontend/src/shared/ui/inputs.css`), which was outside HEL-303's touched-file scope. The audit the ticket
requests also found `.actions-menu__item` (shared kebab menu, mobile-reachable via panel cards, dashboard
list, and sidebar rows) at ~31px — the identical class, trivially the same fix.

## What Changes

- Add an `@media (max-width: 768px)` block to `frontend/src/shared/ui/inputs.css` giving
  `.ui-select__option` a `min-height: 44px` tap target (flex-centered so labels stay aligned). Desktop
  density unchanged — no rule outside the media block changes.
- Same mobile-scoped `min-height: 44px` for `.actions-menu__item` in
  `frontend/src/shared/chrome/ActionsMenu.css` (same defect class, low-risk, in-audit fix).
- Add CSS-lock tests (`inputs.css.test.ts`, `ActionsMenu.css.test.ts`) following the
  `PanelDetailModal.css.test.ts` / `MobileNavSheet.css.test.ts` precedent, asserting the mobile media
  block keeps the ≥44px rules.
- Report spinoff candidates (not fixed here): `.actions-menu__trigger` 28px kebab button; bare
  `.ui-select__trigger` outside the panel-detail modal scope.

## Capabilities

### New Capabilities

- `shared-popover-touch-targets`: mobile (≤768px) minimum tap-target sizing for shared popover/menu
  option rows (`ui-select` options, actions-menu items), with desktop density preserved and CSS-lock
  regression guards.

### Modified Capabilities

<!-- none — no existing spec covers shared popover row sizing -->

## Impact

- `frontend/src/shared/ui/inputs.css` (+ new `inputs.css.test.ts`)
- `frontend/src/shared/chrome/ActionsMenu.css` (+ new `ActionsMenu.css.test.ts`)
- No TSX/logic changes, no backend, no schema changes. All `ui-select` and `ActionsMenu` call sites
  inherit the fix; popover panels already scroll (`max-height` + `overflow-y: auto`).

## Non-goals

- Resizing `.actions-menu__trigger` or the bare `.ui-select__trigger` outside the panel-detail modal
  (spinoff candidates — layout-affecting, not trivially same-class).
- Any desktop sizing change; any behavioral/TSX change to Select or ActionsMenu.
