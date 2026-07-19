## Why

The HEL-308/314 sweep brought shared popover/menu controls to the ≥44px mobile tap-target minimum, but
its closing audit flagged three interactive controls in shared `Modal` and `EmptyState` chrome that are
still sub-44px on mobile: `.ui-modal__close` (28px), `.ui-modal-btn` (32px), and `.ui-empty-state__cta`
(32px). Unlike the HEL-314 kebab (never mounted on the phone shell), these are phone-reachable via the
bottom-nav create/empty-state routes (pipelines / data-sources / type registry). This change closes out
the shared-chrome touch-target class app-wide.

## What Changes

- Add a `@media (max-width: 768px)` `min-width: 44px; min-height: 44px` rule for `.ui-modal__close`
  (square icon button) in `frontend/src/shared/ui/Modal.css`, keeping the glyph centered.
- Add a `@media (max-width: 768px)` `min-height: 44px` rule for `.ui-modal-btn` in `Modal.css`, leaving
  desktop `--control-md` (32px) height intact.
- Add a `@media (max-width: 768px)` `min-height: 44px` rule for `.ui-empty-state__cta` in
  `frontend/src/shared/ui/EmptyState.css` (base selector, so it also floors the more-specific sidebar
  variant defensively; the sidebar variant is not mounted at ≤768px).
- Add CSS-lock regression tests for each new rule, following the `inputs.css.test.ts` precedent (new
  `Modal.css.test.ts` and `EmptyState.css.test.ts`).
- Desktop (>768px) density is unchanged for every control.

## Capabilities

### New Capabilities

- `modal-emptystate-touch-targets`: mobile (≤768px) ≥44px tap-target floors for shared `Modal` chrome
  (`.ui-modal__close`, `.ui-modal-btn`) and the `EmptyState` CTA (`.ui-empty-state__cta`), with desktop
  density preserved and CSS-lock regression guards.

### Modified Capabilities

- (none)

## Impact

- `frontend/src/shared/ui/Modal.css` (+ new `Modal.css.test.ts`)
- `frontend/src/shared/ui/EmptyState.css` (+ new `EmptyState.css.test.ts`)
- No backend, API, or dependency changes.

## Non-goals

- No changes to desktop density or to any already-covered `.panel-detail-modal`-scoped overrides.
- No JS/TSX logic changes; CSS + tests only.
- No redesign of the modal or empty-state controls beyond the tap-target floor.
