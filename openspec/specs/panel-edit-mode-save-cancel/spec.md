# panel-edit-mode-save-cancel Specification

## Purpose
TBD - created by archiving change explicit-save-cancel-edit. Update Purpose after archive.
## Requirements
### Requirement: Save button commits all staged changes via the API and returns to view mode
In edit mode the modal footer SHALL include a Save button. Clicking Save MUST submit all staged changes for the active tab to the backend via the existing PATCH /api/panels/:id endpoint and transition the modal back to view mode on success.

#### Scenario: Save appearance returns to view mode
- **WHEN** the user modifies appearance values in edit mode and clicks Save
- **THEN** the appearance update is submitted to the backend
- **AND** the modal transitions to view mode (not closed)
- **AND** the tab bar is no longer visible

#### Scenario: Save content returns to view mode
- **WHEN** the user modifies markdown content in edit mode and clicks Save
- **THEN** the content update is submitted to the backend
- **AND** the modal transitions to view mode on success

#### Scenario: Save image settings returns to view mode
- **WHEN** the user modifies the image URL or fit in edit mode and clicks Save
- **THEN** the image settings are submitted to the backend
- **AND** the modal transitions to view mode on success

#### Scenario: Save divider settings returns to view mode
- **WHEN** the user modifies divider settings in edit mode and clicks Save
- **THEN** the divider settings are submitted to the backend
- **AND** the modal transitions to view mode on success

#### Scenario: Save data binding returns to view mode
- **WHEN** the user modifies the data binding in edit mode and clicks Save
- **THEN** the data binding update is submitted to the backend
- **AND** the modal transitions to view mode on success

#### Scenario: Save shows loading state during submission
- **WHEN** the user clicks Save and the API request is in flight
- **THEN** the Save button is disabled and shows "Saving..." text

#### Scenario: Save error stays in edit mode
- **WHEN** the API request fails after clicking Save
- **THEN** an inline error message is displayed
- **AND** the modal remains in edit mode so the user can retry

### Requirement: Cancel button discards staged changes and returns to view mode
In edit mode the modal footer SHALL include a Cancel button. Clicking Cancel MUST return the modal to view mode, discarding any staged changes. If the user has unsaved changes a confirmation prompt SHALL be shown before discarding.

#### Scenario: Clean cancel returns to view mode immediately
- **GIVEN** no changes have been made since entering edit mode
- **WHEN** the user clicks Cancel
- **THEN** the modal transitions to view mode without a discard warning
- **AND** form state is reset to the panel's current persisted values

#### Scenario: Dirty cancel shows discard confirmation
- **GIVEN** the user has staged changes in any form field
- **WHEN** the user clicks Cancel
- **THEN** an inline discard warning is shown

#### Scenario: Confirming discard returns to view mode
- **GIVEN** the discard warning is shown
- **WHEN** the user clicks "Discard"
- **THEN** the modal transitions to view mode
- **AND** form state is reset to the panel's current persisted values

#### Scenario: Keeping editing dismisses the discard warning
- **GIVEN** the discard warning is shown
- **WHEN** the user clicks "Keep editing"
- **THEN** the discard warning is dismissed and the modal remains in edit mode

### Requirement: Escape key in edit mode triggers the cancel flow
While the modal is in edit mode pressing Escape SHALL behave identically to clicking Cancel — returning to view mode with a discard confirmation if the form is dirty.

#### Scenario: Escape with no changes returns to view mode
- **GIVEN** no changes have been made since entering edit mode
- **WHEN** the user presses Escape
- **THEN** the modal transitions to view mode immediately

#### Scenario: Escape with unsaved changes shows discard warning
- **GIVEN** the user has staged changes
- **WHEN** the user presses Escape
- **THEN** the inline discard warning is shown

### Requirement: Unsaved changes indicator is displayed in the modal header during edit mode
When the modal is in edit mode and any form field value differs from the panel's persisted value, the modal header SHALL display a visual "Unsaved changes" indicator.

#### Scenario: Indicator appears after making a change
- **GIVEN** the modal is in edit mode with no staged changes
- **WHEN** the user modifies any field
- **THEN** an "Unsaved changes" indicator becomes visible in the modal header

#### Scenario: Indicator not shown when no changes are staged
- **GIVEN** the modal is in edit mode
- **WHEN** no form fields have been changed from their initial values
- **THEN** no unsaved-changes indicator is visible

#### Scenario: Indicator disappears on successful save
- **GIVEN** the unsaved-changes indicator is visible
- **WHEN** the user clicks Save and the API call succeeds
- **THEN** the modal transitions to view mode where the indicator is not shown

### Requirement: Changes do not auto-save in edit mode
Field changes in edit mode SHALL NOT trigger any API call or Redux accumulation until the user explicitly clicks Save.

#### Scenario: Changing a field does not dispatch an API call
- **WHEN** the user modifies an appearance, content, image, divider, or data binding field in edit mode
- **THEN** no PATCH request is made to the backend until Save is clicked

