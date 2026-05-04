## MODIFIED Requirements

### Requirement: Edit button transitions to edit mode
The view mode header SHALL include an "Edit" button. Clicking it transitions the modal to edit mode,
which shows the existing tab-based editing UI (Appearance tab active by default). Additionally,
pressing the `E` keyboard shortcut while in view mode SHALL also transition to edit mode (see
`panel-detail-keyboard-shortcuts` capability).

#### Scenario: Clicking Edit enters edit mode
- **WHEN** the user clicks the Edit button in view mode
- **THEN** the modal transitions to edit mode
- **AND** the tab bar is visible with the Appearance tab selected
- **AND** the footer Save/Cancel buttons are visible

#### Scenario: E key enters edit mode
- **WHEN** the modal is in view mode
- **AND** focus is not on a form input
- **AND** the user presses the E key
- **THEN** the modal transitions to edit mode
- **AND** the tab bar is visible with the Appearance tab selected
- **AND** the footer Save/Cancel buttons are visible
