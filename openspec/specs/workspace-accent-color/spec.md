# workspace-accent-color Specification

## Purpose
User-selectable accent color from a curated preset palette that updates all accent CSS tokens immediately and persists across reloads via localStorage.
## Requirements
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
- **THEN** the previously selected color SHALL be restored
- **THEN** the accent CSS tokens SHALL be applied before or during first render to avoid a flash

#### Scenario: Accent color picker entry point is accessible
- **WHEN** the user opens the UserMenu popover
- **THEN** an accent color picker section SHALL be visible within the popover
- **THEN** swatches SHALL be keyboard-navigable and have accessible labels

### Requirement: Derived accent token computation
The system SHALL compute and apply all derived accent CSS variables when a color is selected, so no
accent surface requires per-component logic.

#### Scenario: All derived tokens are updated on selection
- **WHEN** the user selects an accent color
- **THEN** the following CSS custom properties SHALL be set on `:root`:
  `--app-accent`, `--app-accent-strong`, `--app-accent-surface`, `--app-accent-dim`,
  `--app-accent-mid`, `--app-bg-accent`
- **THEN** each derived token SHALL use the appropriate opacity matching the static theme.css values

#### Scenario: Reverting to default removes overrides
- **WHEN** the user selects the default orange preset
- **THEN** the runtime CSS variable overrides SHALL be removed or set to their default values
- **THEN** the result SHALL be visually identical to a fresh load with no stored preference

