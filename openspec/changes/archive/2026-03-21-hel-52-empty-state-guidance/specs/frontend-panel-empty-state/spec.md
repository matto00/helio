## ADDED Requirements

### Requirement: Empty state shown when a dashboard has no panels
The system SHALL display a meaningful empty state in the panel area when the active dashboard has been loaded successfully and contains zero panels.

#### Scenario: Empty state renders after successful load with no panels
- **WHEN** a dashboard is selected and panels have loaded with status `succeeded`
- **AND** the panel count is zero
- **THEN** the panel area displays an icon, the heading "No panels yet", descriptive subtext, and an "Add panel" button

#### Scenario: Empty state is not shown while panels are loading
- **WHEN** a dashboard is selected and panel status is `loading`
- **THEN** the empty state block is not visible

#### Scenario: Empty state is not shown when panels exist
- **WHEN** a dashboard is selected and one or more panels are present
- **THEN** the empty state block is not visible and the panel grid renders normally

### Requirement: Empty state CTA opens the panel create form
The system SHALL provide an "Add panel" button in the empty state that opens the same inline panel create form as the header `+` button.

#### Scenario: Clicking "Add panel" in empty state opens the create form
- **WHEN** the empty state is visible
- **AND** the user clicks the "Add panel" button
- **THEN** the inline panel create form becomes visible (identical to clicking the header `+` button)
