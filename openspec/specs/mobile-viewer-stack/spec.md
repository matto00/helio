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
ascending. Panels missing from the `xs` layout SHALL follow the existing `resolveDashboardLayout` fallback
resolution before ordering.

#### Scenario: Panels ordered by y then x
- **WHEN** the `xs` layout places panel A at (x:0, y:2), panel B at (x:0, y:0), and panel C at (x:1, y:0)
- **THEN** the stack renders B, then C, then A

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

