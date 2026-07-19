## Why

The HEL-308 audit brought shared popover option rows and menu items to the ≥44px mobile tap-target
minimum, but left two trigger controls behind: `.actions-menu__trigger` (28px kebab) and the bare
`.ui-select__trigger` (32px) at call sites outside `.panel-detail-modal`. This change closes out the
touch-target class app-wide so no sub-44px interactive control remains in the mobile shell / shared
components.

## What Changes

- Add a `@media (max-width: 768px)` ≥44px rule for `.actions-menu__trigger` in `ActionsMenu.css`,
  keeping the kebab visually compact while meeting the tap-target minimum, and confirm the taller
  trigger does not break the header rows it sits in.
- Add a `@media (max-width: 768px)` `min-height: 44px` rule for the bare `.ui-select__trigger` in
  `inputs.css` (the shared primitive), leaving `.panel-detail-modal`-scoped overrides untouched.
- Add CSS-lock tests for each new rule (per the `PanelDetailModal.css.test.ts` / existing
  `ActionsMenu.css.test.ts` precedent).
- Re-audit shared interactive controls in the mobile shell and record a final audit note asserting no
  remaining sub-44px controls.
- Desktop (>768px) density is unchanged for every control.

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `shared-popover-touch-targets`: extend the mobile ≥44px tap-target requirement from popover option
  rows / menu items to the `.actions-menu__trigger` and bare `.ui-select__trigger` trigger controls,
  plus a closing audit assertion.

## Impact

- `frontend/src/shared/chrome/ActionsMenu.css` (+ `.css.test.ts`)
- `frontend/src/shared/ui/inputs.css` (+ `.css.test.ts`)
- No backend, API, or dependency changes.

## Non-goals

- No changes to desktop density or to `.panel-detail-modal`-scoped trigger overrides (already covered).
- No JS/TSX logic changes; CSS + tests only.
- No redesign of the kebab or select controls beyond the tap-target height.
