# HEL-308 — Bring shared ui-select popover option rows to ≥44px on mobile

**Priority:** Medium
**Type:** bug (touch-target defect class)
**Linear:** https://linear.app/helioapp/issue/HEL-308/bring-shared-ui-select-popover-option-rows-to-44px-on-mobile

## Context

Found during HEL-303 review. The shared `ui-select` component's popover option
rows measure 34px tall on mobile — the same sub-44px touch-target defect class
HEL-245/255/248/303 fixed across the panel-detail editor, but living in the
shared component, which was outside HEL-303's touched-file scope.

## What

Extend the established `@media (max-width: 768px)` ≥44px pattern (see
PanelDetailModal.css and its CSS-lock test precedent) to the `ui-select`
popover option rows, keeping desktop density unchanged. Audit other shared
popover/menu components (context menus, dropdown menus) for the same class
while there.

## Acceptance criteria

- [ ] `ui-select` popover option rows measure ≥44px at 390px viewport width
      (verified via getBoundingClientRect, both themes)
- [ ] Desktop row density unchanged
- [ ] CSS-lock test guarding the mobile rule

## Orchestrator audit findings (pre-planning probe, confirmed against source)

- `.ui-select__option` (`frontend/src/shared/ui/inputs.css:115`) —
  `padding: var(--space-2) var(--space-3)`, `font-size: var(--text-sm)`, no
  mobile media query anywhere in `inputs.css`. This is the 34px row. **Fix.**
- `.actions-menu__item` (`frontend/src/shared/chrome/ActionsMenu.css:36`) —
  same padding with `--text-xs` (≈31px), shared menu component, mobile-reachable
  via PanelCard / DashboardList / SidebarItemList. Same defect class, trivially
  the same fix. **Fix in this PR (low-risk).**
- `Popover.css` — generic container, no option rows of its own. No change.
- `MobileNavSheet.css` / `BottomNav.css` — already carry ≥44px mobile rules and
  CSS-lock coverage. No change.
- **Spinoff candidates (report, do not fix here):** `.actions-menu__trigger`
  (28px kebab button, `--control-sm` square) and the bare `.ui-select__trigger`
  outside `.panel-detail-modal` scope (PanelDetailModal.css only lifts it
  within the modal).

## Session verification requirements (from the fleet run brief)

- Evaluator AND skeptic measure via getBoundingClientRect at 390×844 in BOTH
  themes: ui-select option rows AND any other popover rows touched must clear
  44px; desktop rows must be UNCHANGED (measure both viewports).
- ui-select is used widely (field pickers, dropdowns across the app) — verify a
  representative sample of call sites render correctly with taller rows and
  nothing overflows (the panel is `max-height: 280px; overflow-y: auto`).
- Playwright screenshots go to the session scratchpad or gitignored tmp, never
  the repo root.
