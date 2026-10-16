## MODIFIED Requirements

### Requirement: Save state indicator renders in the toolbar when a dashboard is open
The system SHALL display a save-state label whenever a dashboard is selected and the user is on the dashboard view: in the dashboard meta row above the phone boundary (where the meta row replaces the command bar), and in the command bar on the phone shell.

#### Scenario: Indicator not shown when no dashboard is selected
- **WHEN** the user is on the dashboard view with no dashboard selected
- **THEN** the save-state indicator is not rendered

#### Scenario: Indicator is shown when a dashboard is open
- **WHEN** the user is on the dashboard view with a dashboard selected
- **THEN** the save-state indicator is visible in the dashboard meta row after its facts at 1280px wide, and in the command bar at 375px wide
