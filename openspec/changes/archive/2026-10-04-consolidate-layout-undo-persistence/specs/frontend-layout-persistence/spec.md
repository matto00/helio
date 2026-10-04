## MODIFIED Requirements

### Requirement: The frontend persists completed layout changes
The frontend MUST persist drag and resize changes back to the backend when the user completes a layout
update. Undo and redo traversal MUST also persist the settled layout to the backend using the same
deferred flush. A completed change is staged locally and persisted by the next auto-save tick (every 30 seconds),
a manual Save now, or the desktop grid's unmount flush; there is no per-change debounce timer. Layout persistence
MUST use `PATCH /api/dashboards/:id/update` with `{ fields: ["layout"], dashboard: { layout: ... } }` — layout is a
dashboard-level attribute stored as a 4-breakpoint JSON blob, not a per-panel field.

#### Scenario: Panel layout changes are saved
- **GIVEN** a dashboard with rendered panels
- **WHEN** the user drags or resizes panels in the grid and the layout is flushed
- **THEN** the frontend submits the updated dashboard `layout` via `PATCH /api/dashboards/:id/update`
- **AND** a later reload of the same dashboard restores the saved arrangement

#### Scenario: Undone layout is persisted
- **GIVEN** the user has undone a layout change
- **WHEN** the next auto-save tick, Save now, or grid unmount flushes the layout
- **THEN** the frontend submits the undone layout to the backend via `PATCH /api/dashboards/:id/update`
- **AND** a later reload restores the undone arrangement

#### Scenario: Redone layout is persisted
- **GIVEN** the user has redone a layout change
- **WHEN** the next auto-save tick, Save now, or grid unmount flushes the layout
- **THEN** the frontend submits the redone layout to the backend via `PATCH /api/dashboards/:id/update`
- **AND** a later reload restores the redone arrangement

## REMOVED Requirements

### Requirement: Panel flush debounce runs alongside layout flush debounce
**Reason**: Neither flush is debounced. Pending panel updates and a pending layout change are both flushed by one
shared 30-second auto-save interval, Save now, and (for layout) the desktop grid's unmount flush; the 250 ms timers
this requirement describes do not exist.
**Migration**: See "Panel and layout changes share one deferred flush" below.

## ADDED Requirements

### Requirement: Panel and layout changes share one deferred flush
Pending panel updates and a pending layout change MUST be flushed together by the same auto-save interval and by
Save now; each write MUST be sent independently, so a failure or delay of one MUST NOT block the other.

#### Scenario: Layout and panel flushes are independent
- **GIVEN** a panel title has been accumulated and a layout drag has also occurred
- **WHEN** the auto-save interval elapses or the user clicks Save now
- **THEN** the layout flush sends `PATCH /api/dashboards/:id/update`
- **AND** the panel flush sends `POST /api/panels/updateBatch` independently
- **AND** neither flush waits for or is blocked by the other
