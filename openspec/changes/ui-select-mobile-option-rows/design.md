## Context

`.ui-select__option` (`frontend/src/shared/ui/inputs.css:115`) renders every shared-Select popover row at
`padding: var(--space-2) var(--space-3)` + `--text-sm` ≈ 34px. `inputs.css` has no media queries at all.
`.actions-menu__item` (`frontend/src/shared/chrome/ActionsMenu.css:36`) is the same pattern at `--text-xs`
≈ 31px. Both are shared components reachable on phone (field pickers, panel-card/dashboard-list/sidebar
kebab menus). HEL-245/255/248/303 established the repo convention: an `@media (max-width: 768px)` block
adding literal `min-height: 44px` (see `MobileNavSheet.css:145-156` — literal 44px, not a token, with a
comment citing the HIG minimum), guarded by static CSS-lock tests (`PanelDetailModal.css.test.ts`).

## Goals / Non-Goals

**Goals:**
- ≥44px `ui-select` option rows and actions-menu items at ≤768px, both themes; desktop unchanged.
- CSS-lock tests for both files, per the established precedent.
- Audit report on other shared popover/menu surfaces (done — see proposal; only these two need fixing).

**Non-Goals:**
- `.actions-menu__trigger` (28px kebab button) and bare `.ui-select__trigger` outside the panel-detail
  modal — spinoff candidates; resizing triggers shifts card/list layouts and is not the "option row" class.
- Any TSX/logic change; any desktop density change.

## Decisions

1. **`min-height: 44px` + flex centering inside a `max-width: 768px` media block, appended to each CSS
   file.** `.ui-select__option` is `display: block`, so a bare `min-height` would top-align the label —
   the mobile rule sets `display: flex; align-items: center` alongside `min-height: 44px`. (Unlike
   `.mobile-nav-sheet__item`, which is flex at all viewports, these rows are `display: block` — hence
   the flex switch lives inside the media block.) Nothing outside the media block changes, so desktop
   is unchanged by construction. Alternative (increasing padding on mobile) rejected: padding math is
   font-size-dependent and the repo convention is explicit `min-height: 44px`.
2. **Literal `44px`, not a token** — matches MobileNavSheet.css's documented choice (the HIG constant,
   not a density token that could drift).
3. **Two new co-located test files** (`frontend/src/shared/ui/inputs.css.test.ts`,
   `frontend/src/shared/chrome/ActionsMenu.css.test.ts`) reusing the brace-matching
   `findMediaBlock`/`findRuleBody` helper pattern from `PanelDetailModal.css.test.ts`. Copy the helpers
   (≈35 lines) rather than extracting a shared test utility — the precedent already has three copies'
   worth of structure in one file per CSS file, and a shared-helper refactor across existing tests is
   out of scope (noted for a future cleanup). Assert: media block exists with `max-width: 768px`;
   `.ui-select__option` / `.actions-menu__item` bodies contain `min-height: 44px`.
4. **Fix `.actions-menu__item` in this PR.** Identical defect class, shared file, one-rule fix, popover
   overlay (taller rows cannot shift page layout — the panel floats). Meets the ticket's "trivially
   same-class, low-risk" bar.

## Risks / Trade-offs

- [Taller rows make long option lists taller than the `280px` panel max-height sooner] → panel already
  has `overflow-y: auto`; verify a long-list call site (e.g. field picker) scrolls at 390×844.
- [`.ui-select__option` gains `display: flex` on mobile; if any call site nests block content in an
  option label it would lay out as flex items] → options render a single text label (`Select.tsx`);
  verify representative call sites visually.
- [Actions-menu panel grows ~26px taller on phone near screen edges] → `usePortalPopover.ts` does NOT
  clamp to the viewport (verified — it positions from the trigger rect with no bounds-check), so this
  must be verified empirically: open a bottom-row panel card's menu at 390×844 and confirm it stays
  on-screen (task 1.5). Do not cite clamping as a safety net.

## Planner Notes

- Self-approved: including `.actions-menu__item` (in-audit, same class, low-risk) and deferring the two
  trigger-sizing findings to spinoff tickets. No external deps, no API/scope escalation.
