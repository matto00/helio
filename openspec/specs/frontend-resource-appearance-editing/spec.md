## ADDED Requirements

### Requirement: Users can edit panel appearance from the frontend
The frontend MUST provide controls for editing supported panel appearance settings and apply saved values to rendered panels. The panel appearance controls MUST be hosted in the Appearance tab of the panel detail modal (not a popover).

#### Scenario: Panel appearance is customized
- **GIVEN** a dashboard with panels is selected
- **WHEN** the user opens the panel detail modal and changes appearance controls in the Appearance tab
- **THEN** the frontend submits the updated panel `appearance`
- **AND** the rendered panel reflects the saved background, color, and transparency settings
