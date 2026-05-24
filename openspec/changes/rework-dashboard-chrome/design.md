## Context

The dashboard chrome is implemented in `PanelList.tsx` and `PanelList.css`. The header currently
holds three distinct concerns in a single flex row: zoom out/in/reset buttons, a zoom-level pill,
a panel-count chip, and the add-panel (+) button. The ticket asks to decouple zoom from the header
and render it as a floating bottom-right widget, while keeping count + add in the header.

## Goals / Non-Goals

**Goals:**
- Extract zoom controls from `panel-list__header` into a `panel-list__zoom-widget` fixed to the
  bottom-right of `.panel-list` (position: absolute, bottom/right offset).
- Keep count chip + add button inline in the (now simpler) header.
- CSS-only layout change: no new Redux state, no new hooks, no new services.

**Non-Goals:**
- Auto-hide zoom widget on inactivity (exploratory; deferred).
- Changing zoom range, persistence logic, or gesture handling.
- Any backend changes.

## Decisions

### 1. Widget positioning: `position: absolute` inside `position: relative` panel-list

`PanelList` renders a `<section class="panel-list">` that already spans the full panel column.
Setting `position: relative` on `.panel-list` and `position: absolute; bottom: 20px; right: 20px`
on `.panel-list__zoom-widget` keeps the widget inside the scroll boundary and out of the normal
flow. Alternative (`position: fixed`) would escape the scroll container and overlap the sidebar —
rejected.

### 2. Conditional rendering: same guard as before (`selectedDashboardId !== null`)

The widget is only rendered when a dashboard is selected, matching the existing header-based guard.
No new state needed.

### 3. Header simplification: merge `panel-list__panel-actions` content directly into header-actions

The header flex row loses the zoom-controls section. Count chip and add button remain in a single
`panel-list__panel-actions` inline-flex row aligned to the right. `panel-list__header-actions`
`justify-content` changes from `space-between` to `flex-end` since there is only one item group.

### 4. ARIA: `role="group"` with `aria-label="Zoom controls"` on the widget

Provides an accessible landmark without a full `<nav>`, consistent with how the existing zoom
controls block was identified in tests.

## Risks / Trade-offs

- [Overlap on very narrow viewports] → Widget uses `bottom: 20px; right: 20px` with a `max-width`
  so it can't grow wider than its content. On sub-600px viewports the widget might overlap panel
  cards at zoom != 1 — acceptable given mobile use is low-priority per ticket.
- [z-index stacking] → Panel cards use default stacking; widget needs `z-index: 10` to appear
  above them. Modal already uses higher z-index so no conflict.

## Planner Notes

- This is a pure frontend layout refactor. No API or schema changes. Self-approved.
- Tests in `PanelList.test.tsx` use `aria-label="Zoom in" / "Zoom out" / "Reset zoom"` which are
  preserved verbatim — no test changes needed for the zoom functionality tests. The only test
  update needed is the "zoom controls appear when a dashboard is selected" test if it asserts
  the controls are in the header (it does not — it just queries by aria-label globally).
- The `panel-list__zoom-controls` CSS class is removed from the header; the new widget uses
  `panel-list__zoom-widget` and `panel-list__zoom-widget__controls`.
