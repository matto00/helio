## MODIFIED Requirements

### Requirement: Dashboard appearance editor shows live-preview swatches
The editor SHALL display resolved (blended) swatch colors that reflect what the dashboard will actually
look like, rather than the raw picker hex values.

#### Scenario: Preview swatches show blended result
- **WHEN** the user has selected background and gridBackground colors
- **THEN** the preview swatches SHALL display the colors produced by `resolveDashboardBackground`
  and `resolveDashboardGridBackground` for the current theme
- **AND** the swatches SHALL update in real-time as the picker values change

### Requirement: Dashboard appearance editor warns on low-contrast combinations
The editor SHALL display an inline contrast warning when the resolved background color produces insufficient
contrast against the default text color.

#### Scenario: Contrast warning appears for low-contrast background
- **WHEN** the resolved dashboard background color has a contrast ratio below 4.5:1 against the
  theme's default text color
- **THEN** an inline warning message SHALL be displayed below the color pickers
- **AND** the user SHALL still be able to save the selection (warning is advisory, not blocking)

#### Scenario: No contrast warning for transparent background
- **WHEN** the background field is set to "transparent"
- **THEN** no contrast warning SHALL be displayed
