# modal-dismiss-interactions Specification

## Purpose
TBD - created by archiving change creation-modal-accessibility. Update Purpose after archive.
## Requirements
### Requirement: Escape key dismisses the creation modal
The creation modal SHALL close when the user presses Escape. If the modal is in a dirty state
(a panel type has been selected, a template has been selected, or the title field is non-empty),
the system MUST show a discard confirmation before closing.

#### Scenario: Escape on clean modal closes immediately
- **WHEN** the creation modal is open
- **AND** the user has not selected a panel type, selected a template, or entered a title
- **AND** the user presses Escape
- **THEN** the modal closes without a confirmation prompt
- **AND** no panel is created

#### Scenario: Escape on dirty modal shows discard confirmation (confirmed)
- **WHEN** the creation modal is open
- **AND** the user has entered data (selected a type, selected a template, or typed a title)
- **AND** the user presses Escape
- **AND** the user confirms the discard prompt
- **THEN** the modal closes
- **AND** no panel is created

#### Scenario: Escape on dirty modal shows discard confirmation (cancelled)
- **WHEN** the creation modal is open
- **AND** the user has entered data
- **AND** the user presses Escape
- **AND** the user cancels the discard prompt
- **THEN** the modal remains open
- **AND** all previously entered data is preserved

### Requirement: Click outside the modal dismisses the creation modal
The creation modal SHALL close when the user clicks the backdrop area outside the modal content.
If the modal is dirty, the system MUST show a discard confirmation before closing.

#### Scenario: Click outside on clean modal closes immediately
- **WHEN** the creation modal is open
- **AND** the user has not entered any data
- **AND** the user clicks the area outside the modal content box
- **THEN** the modal closes without a confirmation prompt
- **AND** no panel is created

#### Scenario: Click outside on dirty modal shows discard confirmation (confirmed)
- **WHEN** the creation modal is open
- **AND** the user has entered data
- **AND** the user clicks outside the modal content box
- **AND** the user confirms the discard prompt
- **THEN** the modal closes
- **AND** no panel is created

#### Scenario: Click outside on dirty modal shows discard confirmation (cancelled)
- **WHEN** the creation modal is open
- **AND** the user has entered data
- **AND** the user clicks outside the modal content box
- **AND** the user cancels the discard prompt
- **THEN** the modal remains open
- **AND** all previously entered data is preserved

### Requirement: Focus is trapped within the creation modal while open
While the creation modal is open, keyboard focus SHALL NOT move to elements outside the modal.
Tab and Shift+Tab MUST cycle through focusable elements within the modal only.

#### Scenario: Tab cycles forward through modal focusable elements
- **WHEN** the creation modal is open
- **AND** focus is on the last focusable element inside the modal
- **AND** the user presses Tab
- **THEN** focus moves to the first focusable element inside the modal

#### Scenario: Shift+Tab cycles backward through modal focusable elements
- **WHEN** the creation modal is open
- **AND** focus is on the first focusable element inside the modal
- **AND** the user presses Shift+Tab
- **THEN** focus moves to the last focusable element inside the modal

