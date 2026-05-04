# panel-view-mode Specification

## Purpose
TBD - created by archiving change view-mode-fullscreen-panel. Update Purpose after archive.
## Requirements
### Requirement: Panel detail modal defaults to view mode on open
When the panel detail modal opens (from the actions menu or from a panel body click), it SHALL default to view mode. View mode renders the panel's content at the maximum available size within the modal body and hides all editing controls.

#### Scenario: Modal opens in view mode
- **WHEN** the user opens the panel detail modal
- **THEN** the modal body shows the panel's rendered content filling the available area
- **AND** the tab bar (Appearance, Data, Content, Image, Divider tabs) is not visible
- **AND** the footer Save/Cancel buttons are not visible

### Requirement: View mode is read-only
In view mode the modal SHALL present no input controls. The only interactive elements are the close button and the Edit button.

#### Scenario: No form controls visible in view mode
- **WHEN** the modal is in view mode
- **THEN** no form inputs, selects, or textareas related to editing are visible

### Requirement: Edit button transitions to edit mode
The view mode header SHALL include an "Edit" button. Clicking it transitions the modal to edit mode,
which shows the unified scrollable settings form (not a tab-based layout). Additionally,
pressing the `E` keyboard shortcut while in view mode SHALL also transition to edit mode (see
`panel-detail-keyboard-shortcuts` capability).

#### Scenario: Clicking Edit enters edit mode
- **WHEN** the user clicks the Edit button in view mode
- **THEN** the modal transitions to edit mode
- **AND** the unified scrollable settings form is visible
- **AND** the tab bar is not visible
- **AND** the footer Save/Cancel buttons are visible

#### Scenario: E key enters edit mode
- **WHEN** the modal is in view mode
- **AND** focus is not on a form input
- **AND** the user presses the E key
- **THEN** the modal transitions to edit mode
- **AND** the unified scrollable settings form is visible
- **AND** the tab bar is not visible
- **AND** the footer Save/Cancel buttons are visible

### Requirement: Close from view mode requires no confirmation
Closing the modal while in view mode (via the close button, Escape, or backdrop click) SHALL close immediately with no discard warning, because view mode involves no editable state.

#### Scenario: Close from view mode is immediate
- **GIVEN** the modal is in view mode
- **WHEN** the user clicks the close button or presses Escape
- **THEN** the modal closes immediately without showing a discard warning

