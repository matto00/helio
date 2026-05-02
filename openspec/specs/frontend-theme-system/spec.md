## Purpose
Defines requirements for the frontend light/dark theme system, including the default theme, user toggle control location, and theme token standards.
## Requirements
### Requirement: Persistent frontend light/dark theme system
The system SHALL provide a frontend theme system with dark mode as the default and a user-toggleable light mode. The theme toggle control SHALL be located inside the UserMenu popover, not as a standalone button in the command bar.

#### Scenario: Dark mode is the default theme
- **WHEN** the app loads without a stored theme preference
- **THEN** the frontend renders using the dark theme

#### Scenario: User toggles the active theme
- **WHEN** the user activates the theme toggle inside the UserMenu popover
- **THEN** the app updates to the selected light or dark theme

#### Scenario: Theme preference persists across reloads
- **WHEN** a user has previously selected a theme
- **THEN** the frontend restores that theme on the next load

#### Scenario: Theme toggle found inside popover
- **WHEN** the UserMenu popover is open
- **THEN** a theme toggle control is visible and functional within the popover

#### Scenario: No standalone theme toggle in command bar
- **WHEN** the user views the app header
- **THEN** no separate theme toggle button is rendered outside the UserMenu popover

### Requirement: Reusable theme tokens
The system SHALL expose reusable styling tokens for shared frontend surfaces and interactions. Accent
tokens (`--app-accent` and its derived variants) SHALL additionally support runtime override via
user-selected accent color, applied through inline style properties on `:root`.

#### Scenario: Shared surfaces use centralized theme tokens
- **WHEN** the app shell, sidebar, or panel surfaces are styled
- **THEN** they use centralized theme tokens instead of hardcoded one-off values

#### Scenario: Runtime accent override takes effect immediately
- **WHEN** the user selects a new accent color
- **THEN** `document.documentElement.style.setProperty` SHALL update `--app-accent` and all derived
  accent tokens immediately without a page reload

#### Scenario: Accent token override survives theme switch
- **WHEN** the user switches between dark and light themes after having set a custom accent color
- **THEN** the custom accent color SHALL remain applied across the theme switch

### Requirement: Theme tokens reflect the chosen visual identity
The system SHALL expose `--app-*` token values in both dark and light themes that reflect the palette, typography, and aesthetic of the chosen
Helio visual identity direction rather than generic defaults.

#### Scenario: Dark theme uses the chosen visual identity palette
- **WHEN** `[data-theme="dark"]` is applied
- **THEN** the `--app-*` token values SHALL reflect the chosen dark palette and font stack from the selected visual direction

#### Scenario: Light theme uses the chosen visual identity palette
- **WHEN** `[data-theme="light"]` is applied
- **THEN** the `--app-*` token values SHALL reflect the chosen light palette and font stack from the selected visual direction

### Requirement: Design token vocabulary in theme.css
The `theme.css` `:root` block SHALL include the full design token vocabulary from the Helio design system handoff: type scale tokens (`--text-micro` through `--text-3xl`), semantic role tokens (`--h1-size`, `--eyebrow-*`), spacing scale tokens (`--space-1` through `--space-10`), `--app-radius-pill`, and `--font-mono`.

#### Scenario: Extended token set is available globally
- **WHEN** any component references a design token such as `--text-sm`, `--space-4`, or `--app-radius-pill`
- **THEN** the value SHALL resolve correctly because the token is defined on `:root` in `theme.css`

### Requirement: Typography utility classes in theme.css
The `theme.css` file SHALL define `.eyebrow`, `.wordmark`, and `.mono` utility classes for consistent application of typographic roles across the UI.

#### Scenario: Utility classes can be applied to any element
- **WHEN** a component applies the class `eyebrow`, `wordmark`, or `mono`
- **THEN** the appropriate typographic styles SHALL be applied without requiring additional component-specific CSS

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

### Requirement: Dashboard zoom level is restored from backend on dashboard load
The system SHALL restore the saved zoom level for the selected dashboard from the user's preferences
when a dashboard is loaded.

#### Scenario: Zoom level is restored when switching to a dashboard
- **WHEN** a dashboard is selected
- **AND** the current user has a saved zoom level for that dashboard in `preferences.zoomLevels`
- **THEN** the panel grid SHALL render at the saved zoom level

#### Scenario: Default zoom when no saved level exists
- **WHEN** a dashboard is selected
- **AND** no saved zoom level exists for that dashboard
- **THEN** the panel grid SHALL render at zoom level 1.0 (100%)

