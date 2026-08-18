# settings-preferences-ui Specification

## Purpose
The `/settings` page (reached from the account menu) hosts two sibling sections with distinct save
models. The "Preferences" section is the view/edit surface for default series colors, default panel
style, and naming conventions, with an explicit-save, read-modify-write editing model that preserves
`extras` and any editor-unexposed or non-string values it doesn't have a control for, rather than
silently dropping or coercing them on save. The "Appearance" section hosts the accent color picker,
which applies immediately on selection with no explicit Save step — a separate, persisted preference
with its own save model, kept out of the "Preferences" form's explicit-Save flow. See
`workspace-accent-color`.
## Requirements
### Requirement: Settings page is reachable from the account menu
The application SHALL expose a `/settings` route, reachable via a new "Settings" item in the
existing account menu (`UserMenu`).

#### Scenario: Navigating to settings
- **WHEN** an authenticated user opens the account menu and selects "Settings"
- **THEN** the application navigates to `/settings` and renders the settings page

#### Scenario: Settings route requires authentication
- **WHEN** an unauthenticated visitor navigates to `/settings`
- **THEN** they are redirected the same way any other protected route redirects unauthenticated
  visitors

### Requirement: Preferences editor loads and displays the caller's stored preferences
The settings page SHALL fetch the caller's preferences on mount and display default series
colors, default panel style (background, text color, transparency), and naming conventions.

#### Scenario: Loading state
- **WHEN** the settings page mounts
- **THEN** a loading indicator is shown while the preferences fetch is in flight

#### Scenario: Populated preferences render
- **WHEN** the preferences fetch succeeds for a caller with stored values
- **THEN** the editor displays the stored `defaultSeriesColors`, `defaultPanelStyle`
  (background/color/transparency), and `namingConventions` entries

#### Scenario: Empty preferences render sensible defaults
- **WHEN** the preferences fetch succeeds for a caller with no stored preferences
- **THEN** the editor renders with empty/default field values, not an error state

#### Scenario: Fetch failure shows an error
- **WHEN** the preferences fetch fails
- **THEN** the settings page shows an error message rather than a blank or broken editor

### Requirement: Saving preferences persists edits and preserves unexposed fields
Saving the preferences editor SHALL persist the edited `defaultSeriesColors`,
`defaultPanelStyle`, and `namingConventions` fields via `PUT /api/preferences`, while preserving
any previously-stored `extras` content and any `defaultPanelStyle` keys the editor does not
expose, unchanged.

#### Scenario: Edits persist across reload
- **WHEN** a user edits their preferences and saves
- **AND** the page is reloaded
- **THEN** the reloaded editor reflects the saved values

#### Scenario: extras is preserved on save
- **WHEN** a caller's stored preferences include `extras` content set by another client
- **AND** the user edits and saves their preferences through this UI
- **THEN** the persisted `extras` content is unchanged

#### Scenario: A non-string namingConventions value is preserved, not coerced
- **WHEN** a caller's stored `namingConventions` includes a key whose value is not a JSON string
  (e.g. a boolean)
- **AND** the user edits and saves their preferences through this UI without touching that key
- **THEN** the persisted value for that key is unchanged — neither dropped nor coerced to a
  string

#### Scenario: Save failure surfaces an error without losing the user's edits
- **WHEN** the save request fails
- **THEN** an error is shown and the form retains the user's in-progress edits (not reverted to
  the last-fetched values)

### Requirement: Settings page includes an Appearance section with the accent color picker
The `/settings` page SHALL render an "Appearance" section, separate from the "Preferences" section,
containing the accent color picker. Selecting a swatch SHALL apply immediately (no explicit Save
step), matching the picker's existing immediate-apply behavior.

#### Scenario: Appearance section renders on settings load
- **WHEN** the `/settings` page renders
- **THEN** an "Appearance" section is visible containing the accent color picker with the current accent color indicated

#### Scenario: Selecting an accent swatch applies immediately
- **WHEN** the user clicks an accent swatch in the Appearance section
- **THEN** the accent color is applied immediately across the app, with no separate Save action required

#### Scenario: Appearance section is independent of the Preferences form's Save state
- **WHEN** the user has unsaved edits in the "Preferences" section's form
- **THEN** selecting an accent swatch in "Appearance" does not require or trigger the "Save preferences" action, and does not affect the Preferences form's pending edits

