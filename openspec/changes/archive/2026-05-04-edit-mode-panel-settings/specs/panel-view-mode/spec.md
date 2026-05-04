## MODIFIED Requirements

### Requirement: Edit button transitions to edit mode
The view mode header SHALL include an "Edit" button. Clicking it transitions the modal to edit mode, which shows the unified scrollable settings form (not a tab-based layout).

#### Scenario: Clicking Edit enters edit mode
- **WHEN** the user clicks the Edit button in view mode
- **THEN** the modal transitions to edit mode
- **AND** the unified scrollable settings form is visible
- **AND** the tab bar is not visible
- **AND** the footer Save/Cancel buttons are visible
