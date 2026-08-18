## MODIFIED Requirements

### Requirement: Workspace accent color selection
The system SHALL allow users to select an accent color from a curated set of preset swatches that
immediately updates all accent surfaces across the application.

#### Scenario: Default accent color on first load
- **WHEN** the app loads and no accent color preference is stored in localStorage
- **THEN** the accent color SHALL default to `#f97316` (orange)

#### Scenario: User selects a preset accent color
- **WHEN** the user clicks a color swatch in the accent color picker
- **THEN** `--app-accent` and all derived accent tokens SHALL be updated on `:root` immediately
- **THEN** all accent surfaces (dot-grid, nav active state, sidebar active, panel hover borders, chart bars, buttons, badges) SHALL reflect the new color

#### Scenario: Preset palette coverage
- **WHEN** the accent color picker is displayed
- **THEN** at least 6 preset color swatches SHALL be visible
- **THEN** the currently selected swatch SHALL be visually indicated (e.g. ring or checkmark)

#### Scenario: Accent color persists across reloads
- **WHEN** the user selects an accent color and reloads the page
- **THEN** the previously selected color SHALL be restored from the backend (or localStorage as fallback)
- **THEN** the accent CSS tokens SHALL be applied before or during first render to avoid a flash

#### Scenario: Accent color change dispatches updateUserPreferences when authenticated
- **WHEN** the user selects an accent color and is authenticated
- **THEN** `updateUserPreferences` is dispatched with `{ fields: ["accentColor"], user: { accentColor: "<color>" } }`
- **AND** localStorage is also updated as a fast-restore fallback

#### Scenario: Backend preference takes precedence on load
- **WHEN** the app completes authentication (rehydrateAuth, login, or register resolves)
- **AND** the returned user object has `preferences.accentColor`
- **THEN** the accent color is updated to the backend value regardless of what is in localStorage

#### Scenario: Accent color picker entry point is accessible
- **WHEN** the user opens the `/settings` page
- **THEN** an "Appearance" section SHALL be visible containing the accent color picker
- **THEN** swatches SHALL be keyboard-navigable and have accessible labels
