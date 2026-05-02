## ADDED Requirements

### Requirement: ThemeProvider applies backend accent color after auth resolves
The system SHALL apply the backend-sourced accent color to the ThemeProvider state when the auth
state transitions to `authenticated`, overriding the initial localStorage/default value.

#### Scenario: Auth completion triggers accent color sync
- **WHEN** the Redux auth state transitions to `"authenticated"` with a user that has `preferences.accentColor`
- **THEN** `setAccentColor` is called with the backend value
- **AND** the CSS accent tokens are updated accordingly

#### Scenario: No flash of wrong color on first render
- **WHEN** the app first renders before authentication resolves
- **THEN** the accent color is sourced from localStorage (synchronous) to avoid a flash
- **AND** it is updated to the backend value only after auth completes

### Requirement: Dashboard zoom level UI in PanelList
The system SHALL provide zoom level controls (increase, decrease, reset) in the `PanelList` header
area, visible when a dashboard is selected and has panels.

#### Scenario: Zoom controls are visible when a dashboard is selected
- **WHEN** a dashboard is selected and panels are rendered
- **THEN** zoom in (+), zoom out (-), and reset (100%) buttons are visible in the PanelList header

#### Scenario: Zoom out decreases the panel grid scale
- **WHEN** the user clicks the zoom out (−) button
- **THEN** the panel grid renders at a smaller CSS scale (min: 0.5)

#### Scenario: Zoom in increases the panel grid scale
- **WHEN** the user clicks the zoom in (+) button
- **THEN** the panel grid renders at a larger CSS scale (max: 2.0)

#### Scenario: Reset restores 100% zoom
- **WHEN** the user clicks the reset button
- **THEN** the panel grid scale returns to 1.0

#### Scenario: Zoom change dispatches updateUserPreferences
- **WHEN** the user changes the zoom level while authenticated
- **THEN** `updateUserPreferences` is dispatched with `{ fields: ["zoomLevel"], user: { zoomLevel: <n>, dashboardId: "<id>" } }`

### Requirement: Dashboard zoom level is restored from backend on dashboard load
The system SHALL restore the saved zoom level for the selected dashboard from the user's preferences
when a dashboard is loaded.

#### Scenario: Zoom level is restored when switching to a dashboard
- **WHEN** a dashboard is selected
- **AND** the current user has a saved zoom level for that dashboard in `preferences.zoomLevels`
- **THEN** the panel grid renders at the saved zoom level

#### Scenario: Default zoom when no saved level exists
- **WHEN** a dashboard is selected
- **AND** no saved zoom level exists for that dashboard
- **THEN** the panel grid renders at zoom level 1.0 (100%)
