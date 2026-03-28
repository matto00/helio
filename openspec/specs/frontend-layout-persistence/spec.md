## ADDED Requirements

### Requirement: The frontend hydrates the grid from saved dashboard layouts
The frontend MUST load saved dashboard layout state into the panel grid when a dashboard is selected.

#### Scenario: Selected dashboard has a saved layout
- **GIVEN** a selected dashboard includes a saved `layout`
- **WHEN** the dashboard panels are rendered
- **THEN** the grid uses the saved positions and sizes for supported breakpoints
- **AND** the rendered layout is not reset to generated defaults unless required for missing entries

### Requirement: The frontend persists completed layout changes
The frontend MUST persist drag and resize changes back to the backend when the user completes a layout update. Undo and redo traversal MUST also persist the settled layout to the backend using the same debounced path.

#### Scenario: Panel layout changes are saved
- **GIVEN** a dashboard with rendered panels
- **WHEN** the user drags or resizes panels in the grid
- **THEN** the frontend submits the updated dashboard `layout`
- **AND** a later reload of the same dashboard restores the saved arrangement

#### Scenario: Undone layout is persisted
- **GIVEN** the user has undone a layout change
- **WHEN** the layout debounce settles
- **THEN** the frontend submits the undone layout to the backend
- **AND** a later reload restores the undone arrangement

#### Scenario: Redone layout is persisted
- **GIVEN** the user has redone a layout change
- **WHEN** the layout debounce settles
- **THEN** the frontend submits the redone layout to the backend
- **AND** a later reload restores the redone arrangement

### Requirement: Layout persistence remains robust as panels change
The frontend MUST safely reconcile saved layouts with the currently loaded panel collection.

#### Scenario: Saved layout is incomplete or stale
- **GIVEN** a dashboard layout is missing entries for some panels or includes removed panel ids
- **WHEN** the dashboard panels are rendered
- **THEN** stale panel ids are ignored
- **AND** missing panel entries receive generated fallback positions
- **AND** the resulting layout remains renderable across supported breakpoints
