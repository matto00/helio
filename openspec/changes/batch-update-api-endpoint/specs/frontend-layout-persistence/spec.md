## MODIFIED Requirements

### Requirement: The frontend persists completed layout changes
The frontend MUST persist drag and resize changes back to the backend when the user completes a layout
update. Undo and redo traversal MUST also persist the settled layout to the backend using the same
debounced path. Layout persistence MUST use `POST /api/panels/updateBatch` with `fields: ["layout"]`
rather than a direct PATCH to `PATCH /api/dashboards/:id` or the previous batch endpoint.

#### Scenario: Panel layout changes are saved
- **GIVEN** a dashboard with rendered panels
- **WHEN** the user drags or resizes panels in the grid
- **THEN** the frontend submits the updated panel layout via `POST /api/panels/updateBatch`
- **AND** a later reload of the same dashboard restores the saved arrangement

#### Scenario: Undone layout is persisted
- **GIVEN** the user has undone a layout change
- **WHEN** the layout debounce settles
- **THEN** the frontend submits the undone layout to the backend via `POST /api/panels/updateBatch`
- **AND** a later reload restores the undone arrangement

#### Scenario: Redone layout is persisted
- **GIVEN** the user has redone a layout change
- **WHEN** the layout debounce settles
- **THEN** the frontend submits the redone layout to the backend via `POST /api/panels/updateBatch`
- **AND** a later reload restores the redone arrangement
