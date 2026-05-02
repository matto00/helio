## ADDED Requirements

### Requirement: Panel grid scales with zoom level
The panel grid container SHALL have a CSS `scale(zoomLevel)` transform applied
with `transform-origin: top left`. The container SHALL compensate its logical
dimensions by setting `width: (100 / zoomLevel)%` and
`height: (100 / zoomLevel)%` so the scaled content fills the parent viewport.

#### Scenario: Default zoom — no transform compensation needed
- **WHEN** zoom level is 1.0
- **THEN** the container has `transform: scale(1)`, `width: 100%`, `height: 100%`

#### Scenario: Zoomed in
- **WHEN** zoom level is set to 1.5
- **THEN** the container has `transform: scale(1.5)`, `width: ~66.67%`, `height: ~66.67%`

#### Scenario: Zoomed out
- **WHEN** zoom level is set to 0.5
- **THEN** the container has `transform: scale(0.5)`, `width: 200%`, `height: 200%`

### Requirement: Panel area clips overflow content
The `.panel-list` container SHALL apply `overflow: hidden` so that zoomed-in
panel content does not spill outside the dashboard panel column.

#### Scenario: Zoomed-in content is clipped
- **WHEN** zoom level is greater than 1.0
- **THEN** panel grid content that extends past the panel column boundary is not visible

### Requirement: Zoom controls appear when a dashboard is selected
The header SHALL show Zoom In, Zoom Out, and Reset Zoom buttons along with a
current-level percentage label when a dashboard is selected.

#### Scenario: Dashboard selected
- **WHEN** a dashboard is selected
- **THEN** zoom in (+), zoom out (−), and reset buttons are rendered in the header

#### Scenario: No dashboard selected
- **WHEN** no dashboard is selected
- **THEN** zoom controls are not rendered

### Requirement: Zoom level range is 0.5 to 2.0
The zoom level SHALL be clamped to the range [0.5, 2.0] in 0.1-unit increments.
Zoom In is disabled at 2.0; Zoom Out is disabled at 0.5.

#### Scenario: At maximum zoom
- **WHEN** zoom level is 2.0
- **THEN** Zoom In button is disabled

#### Scenario: At minimum zoom
- **WHEN** zoom level is 0.5
- **THEN** Zoom Out button is disabled

### Requirement: Zoom level is persisted per dashboard
When the user changes the zoom level, the new value SHALL be dispatched to
`updateUserPreferences` with `fields: ["zoomLevel"]` and the dashboard ID.
On dashboard change, the zoom level SHALL be restored from
`currentUser.preferences.zoomLevels[dashboardId]`.

#### Scenario: User changes zoom
- **WHEN** user clicks Zoom In or Zoom Out
- **THEN** `updateUserPreferences` is dispatched with the new zoom value

#### Scenario: Dashboard selection changes
- **WHEN** user switches to a different dashboard
- **THEN** zoom level is restored from the saved preference for that dashboard, defaulting to 1.0
