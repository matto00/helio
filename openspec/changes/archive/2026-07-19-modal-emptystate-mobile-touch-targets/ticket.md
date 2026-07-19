# HEL-319 — Bring shared Modal + EmptyState chrome to ≥44px touch targets on mobile

URL: https://linear.app/helioapp/issue/HEL-319/bring-shared-modal-emptystate-chrome-to-44px-touch-targets-on-mobile
Priority: Medium
Project: Helio Mobile — PWA

## Context

Follow-up from the HEL-314 touch-target sweep (the trailing cleanup after the HEL-308 audit). HEL-314 brought the two remaining shared *trigger* controls (`.ui-select__trigger`, `.actions-menu__trigger`) to the ≥44px mobile floor, but its closing audit honestly flagged two more shared components whose interactive chrome is **still sub-44px on mobile** — and unlike the HEL-314 kebab (which is never mounted on the phone shell), these **are** phone-reachable via the bottom-nav create/empty-state routes (pipelines / data-sources / type registry).

## Sub-44px targets to fix (at `max-width: 768px`)

* **Shared** `Modal` (`frontend/src/shared/ui/Modal.css` or equivalent):
  * `.ui-modal__close` — currently 28px
  * `.ui-modal-btn` — currently 32px
* `EmptyState`:
  * `.ui-empty-state__cta`

## Approach

Add mobile `min-height`/`min-width: 44px` rules at `max-width: 768px`, matching the `PanelDetailModal.mobile.css` precedent established across the HEL-308/245/255/248/303/308/314 sweep. Desktop density must stay unchanged (scope the rules to the mobile media query). Add CSS-lock regression tests for each rule, consistent with HEL-314.

## Acceptance criteria

1. `.ui-modal__close`, `.ui-modal-btn`, and `.ui-empty-state__cta` render ≥44px on a 390px-wide phone shell (rendered-verified, both themes) on a bottom-nav create/empty-state route.
2. Desktop dimensions unchanged.
3. CSS-lock tests guard each rule.
4. `npm test`, lint, and format all pass.

## Notes

Deferred from HEL-314 per refactor discipline (behavior-preserving scope kept tight). This closes out the shared-chrome touch-target class app-wide.
