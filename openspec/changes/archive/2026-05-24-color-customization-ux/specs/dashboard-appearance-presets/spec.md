## ADDED Requirements

### Requirement: Dashboard appearance editor shows curated presets
The system SHALL provide a set of curated background + grid-background color presets that the user can
apply with a single click in the dashboard appearance editor.

#### Scenario: Preset strip is visible in the editor
- **WHEN** the user opens the dashboard appearance editor
- **THEN** a row of named preset swatches SHALL be displayed above the manual color pickers

#### Scenario: Clicking a preset applies its colors
- **WHEN** the user clicks a preset swatch in the editor
- **THEN** the background and gridBackground fields SHALL be updated to the preset's values
- **AND** the live-preview swatches SHALL update immediately

#### Scenario: Preset palette coverage
- **WHEN** the dashboard appearance editor is opened
- **THEN** at least 6 preset entries SHALL be available
