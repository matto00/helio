## MODIFIED Requirements

### Requirement: Save persists appearance and closes the modal
Clicking Save MUST dispatch the appearance update to the backend and transition the modal to view mode on success. The modal SHALL NOT close after a save.

#### Scenario: Save submits appearance changes and returns to view mode
- **WHEN** the user modifies appearance values and clicks Save
- **THEN** the appearance update is submitted to the backend
- **AND** the modal transitions to view mode (tab bar hidden, footer hidden)
- **AND** the modal does not close

### Requirement: Modal dismisses on Escape, backdrop click, and Cancel
The modal MUST close when the user presses Escape (in view mode), clicks the backdrop (in view mode), or clicks the close (✕) button — with a discard warning if there are unsaved changes and the modal is in edit mode. In edit mode, Escape and Cancel return to view mode (not close the modal); see the `panel-edit-mode-save-cancel` capability for the full Cancel/Esc flow.

#### Scenario: Escape closes the modal from view mode
- **GIVEN** the modal is in view mode
- **WHEN** the user presses Escape
- **THEN** the modal closes immediately

#### Scenario: Backdrop click closes the modal from view mode
- **GIVEN** the modal is in view mode and no changes have been made
- **WHEN** the user clicks outside the modal content area
- **THEN** the modal closes

#### Scenario: Dismiss with unsaved changes from edit mode shows a warning
- **GIVEN** the user has changed a value in edit mode
- **WHEN** the user presses Escape or clicks Cancel
- **THEN** an inline discard warning is shown instead of closing or returning to view mode immediately

#### Scenario: Confirming discard returns to view mode
- **GIVEN** the discard warning is shown
- **WHEN** the user confirms discard
- **THEN** the modal transitions to view mode and changes are not persisted
