# panel-save-state-indicator — Delta (fix-mobile-silent-edit-drop / HEL-304)

## MODIFIED Requirements

### Requirement: Save now immediately flushes pending updates
The system SHALL dispatch `updatePanelsBatch` immediately when the user clicks "Save now", clears pending updates,
updates the last-saved timestamp, and resets the auto-save timer. The "Save now" control MUST be functional at
every viewport width at which it is rendered — including below 768px, where the mobile stack is mounted — never a
visible control wired to an unregistered (no-op) flush.

#### Scenario: Save now dispatches updatePanelsBatch
- **WHEN** the user clicks "Save now"
- **THEN** `updatePanelsBatch` is dispatched with all current pending updates
- **AND** `pendingPanelUpdates` is cleared after the successful response
- **AND** `lastSavedAt` is updated to the current time

#### Scenario: Auto-save timer resets after Save now
- **WHEN** the user clicks "Save now"
- **THEN** the 30-second auto-save interval resets so the next auto-save fires 30 seconds after the manual save

#### Scenario: Save now is a no-op when no pending changes
- **WHEN** the user clicks "Save now" with no pending panel updates
- **THEN** no network request is made

#### Scenario: Save now flushes at phone width
- **GIVEN** pending panel updates staged while the viewport/container width is below 768px
- **WHEN** the user clicks "Save now"
- **THEN** `updatePanelsBatch` is dispatched with the pending updates
- **AND** no `PATCH /api/dashboards/:id` (layout) request is issued
