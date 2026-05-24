## MODIFIED Requirements

### Requirement: Polished dashboard shell styling
The system SHALL render the existing dashboard experience with a more polished modern visual shell.

#### Scenario: Dashboard shell uses polished structured layout
- **WHEN** the frontend renders the dashboard page
- **THEN** the app shell presents a structured header, sidebar, and content area with a polished layout
- **THEN** the main dashboard content spans most of the viewport width

#### Scenario: Dashboard header shows count and add controls only
- **WHEN** a dashboard is selected
- **THEN** the panel-list header shows only the panel-count chip and the add-panel (+) button
- **THEN** zoom controls are NOT in the header; they appear in the floating zoom widget

#### Scenario: Surfaces use rounded premium styling
- **WHEN** the frontend renders dashboard and panel surfaces
- **THEN** those surfaces use rounded edges, subtle depth, and restrained visual treatment
