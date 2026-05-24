## ADDED Requirements

### Requirement: Dashboard header shows count and add controls only
The dashboard panel-list header SHALL show only the panel-count chip and the add-panel (+) button
when a dashboard is selected. Zoom controls SHALL NOT appear in the header.

#### Scenario: Dashboard header is simplified when dashboard is selected
- **WHEN** a dashboard is selected
- **THEN** the panel-list header shows only the panel-count chip and the add-panel (+) button
- **THEN** zoom controls are NOT in the header; they appear in the floating zoom widget
