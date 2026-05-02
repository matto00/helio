## MODIFIED Requirements

### Requirement: Dashboard zoom level UI in PanelList
The system SHALL provide zoom level controls (increase, decrease, reset) in the `PanelList` header
area, visible when a dashboard is selected and has panels. Zoom is applied as a CSS scale transform
to the panel grid, clamped to [0.5, 2.0]. The current zoom level SHALL be passed to `PanelGrid` as
a `zoomLevel` prop so that the underlying `react-grid-layout` `<Responsive>` component can receive
it as `positionStrategy` via `createScaledStrategy(zoomLevel)` from `react-grid-layout/core`, correcting drag and resize coordinate offsets at all non-100% zoom levels. In `react-grid-layout@2.2.2` the `positionStrategy` API supersedes the legacy `transformScale` prop.

#### Scenario: Zoom controls are visible when a dashboard is selected
- **WHEN** a dashboard is selected and panels are rendered
- **THEN** zoom in (+), zoom out (-), and reset (100%) buttons SHALL be visible in the PanelList header

#### Scenario: Zoom out decreases the panel grid scale
- **WHEN** the user clicks the zoom out (-) button
- **THEN** the panel grid SHALL render at a smaller CSS scale (min: 0.5)

#### Scenario: Zoom in increases the panel grid scale
- **WHEN** the user clicks the zoom in (+) button
- **THEN** the panel grid SHALL render at a larger CSS scale (max: 2.0)

#### Scenario: Reset restores 100% zoom
- **WHEN** the user clicks the reset button
- **THEN** the panel grid scale SHALL return to 1.0

#### Scenario: Zoom change dispatches updateUserPreferences
- **WHEN** the user changes the zoom level while authenticated
- **THEN** `updateUserPreferences` SHALL be dispatched with `{ fields: ["zoomLevel"], user: { zoomLevel: <n>, dashboardId: "<id>" } }`

#### Scenario: zoomLevel prop is passed to PanelGrid
- **WHEN** the panel grid is rendered at a non-default zoom level
- **THEN** `PanelGrid` SHALL receive a `zoomLevel` prop equal to the current zoom value

#### Scenario: Drag works correctly at 50% zoom
- **WHEN** the user drags a panel handle at 50% zoom
- **THEN** the panel SHALL follow the pointer correctly without coordinate offset errors

#### Scenario: Drag works correctly at 75% zoom
- **WHEN** the user drags a panel handle at 75% zoom
- **THEN** the panel SHALL follow the pointer correctly without coordinate offset errors

#### Scenario: Drag works correctly at 125% zoom
- **WHEN** the user drags a panel handle at 125% zoom
- **THEN** the panel SHALL follow the pointer correctly without coordinate offset errors

#### Scenario: Drag works correctly at 150% zoom
- **WHEN** the user drags a panel handle at 150% zoom
- **THEN** the panel SHALL follow the pointer correctly without coordinate offset errors

#### Scenario: Resize works correctly at non-100% zoom
- **WHEN** the user resizes a panel at any supported zoom level other than 100%
- **THEN** the resize handle SHALL track the pointer correctly without coordinate offset errors
