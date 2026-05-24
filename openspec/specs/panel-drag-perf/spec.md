# panel-drag-perf Specification

## Purpose
TBD - created by archiving change panel-drag-perf-fix. Update Purpose after archive.
## Requirements
### Requirement: Panel drag renders only the dragged panel
During an active drag operation on the panel grid, the system SHALL limit React re-renders so that
non-dragged panels do not re-render on each drag tick. Only the panel being dragged and the grid
wrapper component SHALL re-render per drag frame.

#### Scenario: Drag with 10 panels
- **WHEN** a user drags a panel on a dashboard with 10 or more panels
- **THEN** only the dragged panel and the grid container re-render per mouse-move tick (verified via React Profiler)

#### Scenario: Non-dragged panels remain stable
- **WHEN** a user is actively dragging one panel
- **THEN** the content (body) of all other panels SHALL NOT re-render during the drag motion

### Requirement: Layout persistence is unchanged during drag
The 250ms debounced layout-persistence write to the backend SHALL continue to fire after drag ends,
exactly as before. The drag-freeze optimization SHALL NOT suppress the `onLayoutChange` callback or
the persistence debounce.

#### Scenario: Layout saved after drag
- **WHEN** a user drags a panel to a new position and releases
- **THEN** the new layout is persisted to the backend within the debounce window (250ms after drag stop)

### Requirement: Zoom interactions are unaffected
The scaled position strategy for zoomed dashboards (HEL-153) SHALL continue to function correctly when
panel memoization is active.

#### Scenario: Drag at non-default zoom
- **WHEN** a user drags a panel on a dashboard displayed at a zoom level other than 1.0
- **THEN** the panel tracks the cursor correctly with no coordinate offset jump

