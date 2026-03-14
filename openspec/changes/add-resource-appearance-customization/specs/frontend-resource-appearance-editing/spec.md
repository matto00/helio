## ADDED Requirements

### Requirement: Users can edit dashboard appearance from the frontend
The frontend MUST provide controls for editing supported dashboard appearance settings and apply saved values to the dashboard shell.

#### Scenario: Dashboard background is customized
- **GIVEN** a dashboard is selected
- **WHEN** the user changes the dashboard appearance controls
- **THEN** the frontend submits the updated dashboard `appearance`
- **AND** the rendered dashboard shell reflects the saved background settings

### Requirement: Users can edit panel appearance from the frontend
The frontend MUST provide controls for editing supported panel appearance settings and apply saved values to rendered panels.

#### Scenario: Panel appearance is customized
- **GIVEN** a dashboard with panels is selected
- **WHEN** the user changes a panel's appearance controls
- **THEN** the frontend submits the updated panel `appearance`
- **AND** the rendered panel reflects the saved background, color, and transparency settings

### Requirement: Appearance editing remains compatible with the theme system
The frontend MUST layer resource appearance settings on top of the shared light/dark theme without breaking baseline readability and layout styling.

#### Scenario: Appearance settings are applied under different themes
- **GIVEN** a dashboard or panel with saved appearance overrides
- **WHEN** the user switches between light and dark theme modes
- **THEN** the app still uses the shared theme tokens as the base presentation
- **AND** resource appearance overrides remain applied where supported
