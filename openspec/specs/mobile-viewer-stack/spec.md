# mobile-viewer-stack Specification

## Purpose
Render dashboards below the 768px grid boundary as a read-only single-column panel stack, ordered by the stored xs layout, on a code path structurally incapable of persisting layout changes.

## Requirements

### Requirement: Phone-width dashboards render a read-only single-column stack
`PanelGrid` SHALL render a plain single-column stack of `PanelCard`s — and SHALL NOT mount the React Grid
Layout `<Responsive>` component — whenever the panel grid's container width is below the `sm` grid boundary
(768px, `panelGridConfig.breakpoints.sm`). The stack SHALL be read-only: no drag handles, no resize handles, no
title-edit affordance, and no delete affordance. Tapping a panel SHALL still open the panel detail modal.

#### Scenario: Container narrower than 768px renders the stack
- **WHEN** a dashboard renders with a grid container width below 768px
- **THEN** no React Grid Layout `<Responsive>` element is mounted
- **AND** panels render as a single-column stack of panel cards

#### Scenario: Container at or above 768px renders the grid unchanged
- **WHEN** a dashboard renders with a grid container width of 768px or more
- **THEN** the React Grid Layout grid renders with drag, resize, and edit affordances exactly as before

#### Scenario: Stack panels are read-only
- **WHEN** the stack is rendered
- **THEN** no drag handle, resize handle, title-edit input, or delete control is present on any panel card
- **AND** tapping a panel card opens the panel detail modal

### Requirement: Stack order follows the stored xs layout
The stack SHALL order panels by the resolved `xs` layout's `y` coordinate ascending, breaking ties by `x`
ascending, where the resolved `xs` layout is the saved `xs` layout when valid and otherwise the layout derived
from the nearest authored breakpoint per `breakpoint-layout-resolution`. Deriving SHALL preserve the source
layout's reading order, so the stack order matches the source reading order.

#### Scenario: Panels ordered by y then x
- **WHEN** the `xs` layout places panel A at (x:0, y:2), panel B at (x:0, y:0), and panel C at (x:1, y:0)
- **THEN** the stack renders B, then C, then A

#### Scenario: No xs layout
- **WHEN** only the lg layout is authored, with image above markdown above text in reading order
- **THEN** the stack renders image, markdown, text in that order

### Requirement: The stack path is structurally incapable of persisting layout
The phone stack rendering path SHALL NOT invoke `markLayoutChanged`, dispatch `updateDashboardLayout`, or
dispatch `setLayoutPending`. Opening, resizing, rotating, backgrounding, or leaving a dashboard open on the
stack path MUST NOT produce a `PATCH /api/dashboards/:id` layout write. The stored layout contract is
untouched: `dashboardGridCols.xs` remains `2` and stored layouts are never rewritten from the stack.

#### Scenario: Mounting at phone width produces no layout write
- **WHEN** a dashboard is opened at a container width below 768px
- **AND** the auto-save interval elapses
- **THEN** no dashboard layout update is dispatched to the backend

#### Scenario: Width changes across the boundary produce no layout write from the stack
- **WHEN** the container width changes while the stack is mounted, including crossing the 768px boundary
- **THEN** no dashboard layout update originates from the stack path

### Requirement: Panel-field edits staged below the sm boundary persist without any layout write
Panel title/appearance edits staged while the mobile stack is rendered MUST persist via the panel batch endpoint
(`updatePanelsBatch`) exactly as at desktop width (container width below 768px,
`panelGridConfig.breakpoints.sm`). The stack's structural layout guarantee is unchanged: no code path reachable while the stack is
mounted may dispatch `updateDashboardLayout` or `setLayoutPending`, and browsing on mobile MUST never issue a
dashboard-layout PATCH (the stored `xs` layout stays byte-identical, per HEL-301).

#### Scenario: Modal appearance save at phone width persists
- **GIVEN** a dashboard rendered as the mobile stack (container width below 768px)
- **WHEN** the user saves an appearance edit in the panel detail modal and the auto-save flush fires
- **THEN** a panel batch update request is issued containing the staged appearance
- **AND** no `PATCH /api/dashboards/:id` request is issued

#### Scenario: Mobile browsing issues zero layout PATCHes
- **WHEN** the user scrolls the stack, opens/closes panel detail modals, switches dashboards, or the container
  width changes while below 768px
- **THEN** no `PATCH /api/dashboards/:id` (layout) request is issued at any point
- **AND** the dashboard's stored `xs` layout remains byte-identical

#### Scenario: Pure resize across the 768px boundary never PATCHes layout
- **GIVEN** the user has made no layout edit
- **WHEN** the container width crosses the 768px boundary in either direction (shell swap)
- **THEN** no `PATCH /api/dashboards/:id` (layout) request is issued

### Requirement: Phone-width edit affordances are honest
At viewports narrower than 768px, every edit affordance that is reachable SHALL work end-to-end
(open → edit → save → persisted) with interactive targets of at least 44 CSS px, and no affordance
SHALL imply or reach desktop-only layout actions (panel drag, panel resize, grid layout editing).
Content edits reachable from the stack (via the panel detail modal) are legitimate — HEL-304 makes
them persist width-independently — but any affordance that cannot complete its action at phone
width MUST NOT be rendered there.

#### Scenario: Reachable content edit completes end-to-end

- **WHEN** a user at a 390×844 viewport opens a panel's detail modal, edits its content or
  configuration, and saves
- **THEN** the edit persists (visible after reload) and every control used in the flow measures
  ≥ 44px via its bounding client rect

#### Scenario: Layout actions are unreachable and unimplied

- **WHEN** a dashboard renders at a viewport narrower than 768px
- **THEN** no drag handle, resize handle, or layout-editing control is rendered or implied anywhere
  in the stack or its modals

#### Scenario: No dead-end edit affordances

- **WHEN** any button or control presented below 768px is activated
- **THEN** it performs its full action at that width — no control leads to a flow that silently
  fails or requires a wider viewport to complete

### Requirement: Phone stack gutters keep content close to the screen edge
On the phone shell (viewport at or below 768px) the dashboard view SHALL inset stacked panels 12px from the left and
right screen edges (the `--space-3` token), separate consecutive stacked panels by about 10px, and pad each stacked
panel card by about 14px. Markdown and plain-text panel bodies SHALL NOT add a further horizontal inset of their own inside the card (other
panel kinds keep their own internal layout). At a 375px viewport, the first glyph of a markdown panel's body text SHALL start no more than 28px from the
screen's left edge, measured from the rendered page, and the markdown body's box SHALL end no more than 28px from
the screen's right edge. Stacked panels SHALL remain fully scrollable above the glass nav (bottom clearance). A dashboard's saved zoom
level SHALL NOT scale the phone shell's stack (the zoom controls are hidden there, so a saved level could not be
seen or reset); the saved level itself SHALL be left unchanged and still apply above 768px.

#### Scenario: Markdown text starts within 28px of the edge at 375px
- **WHEN** a dashboard with a markdown panel renders at a 375px viewport
- **THEN** the left edge of the markdown body's first text line is at most 28px from the screen's left edge
- **AND** the panel card's outer edge is 12px from each screen edge

#### Scenario: Stacked panels are separated by a narrow gap
- **WHEN** two or more panels render in the phone stack
- **THEN** the vertical gap between consecutive panel cards is between 8px and 12px

#### Scenario: The last panel clears the glass nav
- **WHEN** the user scrolls to the end of a phone dashboard
- **THEN** the last panel's bottom edge sits above the glass nav's top edge

#### Scenario: A saved zoom level does not shrink the phone stack
- **WHEN** a dashboard whose saved zoom level is 50% renders at 375px
- **THEN** the stack renders at 100% with the gutters above, and the saved 50% still applies when the viewport is
  wider than 768px

#### Scenario: Other dashboard-view content shares the 12px edge
- **WHEN** a status message, onboarding checklist, empty state or chip row renders on the phone dashboard view
- **THEN** its content starts 12px from the screen edge (the chip row may scroll edge to edge, first chip at 12px)

#### Scenario: A 768px phone viewport keeps the stack
- **WHEN** the viewport is exactly 768px wide with overlay (zero-width) scrollbars
- **THEN** the single-column stack renders, not the desktop grid

#### Scenario: Desktop grid unchanged
- **WHEN** the viewport is wider than 768px
- **THEN** the grid's gutters and panel padding are unchanged by this requirement
