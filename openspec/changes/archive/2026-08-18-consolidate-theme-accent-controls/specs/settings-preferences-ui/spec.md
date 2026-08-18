## ADDED Requirements

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
