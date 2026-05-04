## MODIFIED Requirements

### Requirement: Edit button transitions to edit mode
The view mode header SHALL include an "Edit" button. Clicking it transitions the modal to edit mode, which shows the existing tab-based editing UI (Appearance tab active by default). When the user Saves or Cancels in edit mode, the modal returns to view mode — the modal does not close as part of the Save/Cancel flow.

#### Scenario: Clicking Edit enters edit mode
- **WHEN** the user clicks the Edit button in view mode
- **THEN** the modal transitions to edit mode
- **AND** the tab bar is visible with the Appearance tab selected
- **AND** the footer Save/Cancel buttons are visible

#### Scenario: Save in edit mode returns to view mode
- **WHEN** the user completes a save in edit mode
- **THEN** the modal transitions back to view mode
- **AND** the Edit button is visible again

#### Scenario: Cancel in edit mode returns to view mode
- **WHEN** the user cancels or discards changes in edit mode
- **THEN** the modal transitions back to view mode
- **AND** the Edit button is visible again
