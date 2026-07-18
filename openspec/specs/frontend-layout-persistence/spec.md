## Purpose

Defines how the frontend loads, persists, and reconciles dashboard panel layouts. Covers hydration
from saved backend state, debounced persistence of drag/resize changes, undo/redo persistence, and
fallback position computation for panels missing from saved layouts.
## Requirements
### Requirement: The frontend hydrates the grid from saved dashboard layouts
The frontend MUST load saved dashboard layout state into the panel grid when a dashboard is selected.

#### Scenario: Selected dashboard has a saved layout
- **GIVEN** a selected dashboard includes a saved `layout`
- **WHEN** the dashboard panels are rendered
- **THEN** the grid uses the saved positions and sizes for supported breakpoints
- **AND** the rendered layout is not reset to generated defaults unless required for missing entries

### Requirement: The frontend persists completed layout changes
The frontend MUST persist drag and resize changes back to the backend when the user completes a layout
update. Undo and redo traversal MUST also persist the settled layout to the backend using the same
debounced path. Layout persistence MUST use `PATCH /api/dashboards/:id/update` with
`{ fields: ["layout"], dashboard: { layout: ... } }` — layout is a dashboard-level attribute stored
as a 4-breakpoint JSON blob, not a per-panel field.

#### Scenario: Panel layout changes are saved
- **GIVEN** a dashboard with rendered panels
- **WHEN** the user drags or resizes panels in the grid
- **THEN** the frontend submits the updated dashboard `layout` via `PATCH /api/dashboards/:id/update`
- **AND** a later reload of the same dashboard restores the saved arrangement

#### Scenario: Undone layout is persisted
- **GIVEN** the user has undone a layout change
- **WHEN** the layout debounce settles
- **THEN** the frontend submits the undone layout to the backend via `PATCH /api/dashboards/:id/update`
- **AND** a later reload restores the undone arrangement

#### Scenario: Redone layout is persisted
- **GIVEN** the user has redone a layout change
- **WHEN** the layout debounce settles
- **THEN** the frontend submits the redone layout to the backend via `PATCH /api/dashboards/:id/update`
- **AND** a later reload restores the redone arrangement

### Requirement: Layout persistence remains robust as panels change
The frontend MUST safely reconcile saved layouts with the currently loaded panel collection. Panels missing from the saved layout MUST receive smart-computed positions (left-to-right, row-wrapping) rather than naive sequential-index positions.

#### Scenario: Saved layout is incomplete or stale
- **GIVEN** a dashboard layout is missing entries for some panels or includes removed panel ids
- **WHEN** the dashboard panels are rendered
- **THEN** stale panel ids are ignored
- **AND** missing panel entries receive smart-computed fallback positions that fill available horizontal space before starting a new row
- **AND** the resulting layout remains renderable across supported breakpoints

#### Scenario: New panel added to a dashboard with existing panels
- **GIVEN** a dashboard has at least one panel with a saved layout position
- **WHEN** a new panel is created and the panel list is refreshed
- **THEN** the new panel receives a fallback position in the first available horizontal slot adjacent to existing panels
- **AND** it does not stack at x=0, y=0 on top of or below an existing panel at that position

### Requirement: Panel flush debounce runs alongside layout flush debounce
The frontend MUST run an independent 250 ms panel-flush debounce timer in addition to the
existing layout debounce, both co-located in PanelGrid. The two timers are independent — a
layout change does not reset the panel flush timer, and vice versa.

#### Scenario: Layout and panel flushes are independent
- **GIVEN** a panel title has been accumulated and a layout drag has also occurred
- **WHEN** each respective 250 ms debounce settles
- **THEN** the layout flush sends `PATCH /api/dashboards/:id/update` as before
- **AND** the panel flush sends `POST /api/panels/updateBatch` independently
- **AND** neither flush waits for or is blocked by the other

### Requirement: Staged layout changes survive desktop grid unmount

A layout change staged on desktop (drag or resize completed, PATCH not yet flushed) MUST be persisted
when the desktop grid unmounts — including when the viewport shrinks below the `sm` (768px) boundary
within the auto-save window, when the user switches dashboards, and when the user navigates away. The
unmount flush MUST NOT introduce any layout-write path reachable from the mobile stack: a boundary
crossing with no staged desktop change MUST dispatch no layout PATCH, and the HEL-301 guarantee that
mobile browsing never PATCHes dashboard layout MUST continue to hold.

#### Scenario: Shrink below 768px mid-edit flushes the staged layout

- **GIVEN** a dashboard rendered on desktop with a layout change staged within the auto-save window
- **WHEN** the container width crosses below the `sm` boundary and the desktop grid unmounts
- **THEN** exactly one layout PATCH is dispatched carrying the staged layout
- **AND** a later reload (or restore to desktop) shows the staged arrangement

#### Scenario: Browse-only boundary crossing dispatches nothing

- **GIVEN** a dashboard rendered on desktop with no staged layout change
- **WHEN** the container width crosses below the `sm` boundary
- **THEN** no layout PATCH is dispatched by the unmount path

#### Scenario: Rapid repeated boundary crossings do not duplicate the flush

- **GIVEN** a layout change staged on desktop
- **WHEN** the container width rapidly crosses the `sm` boundary multiple times (down, up, down)
- **THEN** the staged layout is persisted exactly once
- **AND** no layout PATCH originates while the mobile stack is mounted

