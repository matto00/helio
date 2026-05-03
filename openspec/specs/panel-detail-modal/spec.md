# panel-detail-modal Specification

## Purpose
The panel detail modal provides panel-level customization (appearance and data configuration) accessible from the panel actions menu and from a direct click on the panel card body.
## Requirements
### Requirement: Panel detail modal opens from the actions menu
The "Customize" action in the panel actions menu MUST open the panel detail modal for that panel. Panel body click is also a trigger — see the ADDED requirement below.

#### Scenario: Customize action opens the modal
- **WHEN** the user clicks "Customize" in a panel's actions menu
- **THEN** the panel detail modal opens with the panel's title in the header

### Requirement: Panel detail modal has Appearance and Data tabs
The modal MUST present an Appearance tab and a Data tab. The Appearance tab MUST be active by default.

#### Scenario: Appearance tab is active on open
- **WHEN** the modal opens
- **THEN** the Appearance tab is selected and its content is visible

#### Scenario: User switches to the Data tab
- **WHEN** the user clicks the Data tab
- **THEN** the Data tab content is shown and Appearance tab content is hidden

### Requirement: Data tab shows a placeholder
The Data tab MUST display a placeholder message indicating data source connectivity is not yet available.

#### Scenario: Data tab shows placeholder text
- **WHEN** the Data tab is active
- **THEN** a message such as "Connect a data source to display real content" is visible

### Requirement: Modal dismisses on Escape, backdrop click, and Cancel
The modal MUST close when the user presses Escape, clicks the backdrop, or clicks Cancel — with a discard warning if there are unsaved changes.

#### Scenario: Escape closes a clean modal
- **GIVEN** no appearance changes have been made
- **WHEN** the user presses Escape
- **THEN** the modal closes

#### Scenario: Backdrop click closes a clean modal
- **GIVEN** no appearance changes have been made
- **WHEN** the user clicks outside the modal content area
- **THEN** the modal closes

#### Scenario: Dismiss with unsaved changes shows a warning
- **GIVEN** the user has changed an appearance value
- **WHEN** the user presses Escape or clicks Cancel
- **THEN** an inline discard warning is shown instead of immediately closing

#### Scenario: Confirming discard closes the modal
- **GIVEN** the discard warning is shown
- **WHEN** the user confirms discard
- **THEN** the modal closes and changes are not persisted

### Requirement: Save persists appearance and closes the modal
Clicking Save MUST dispatch the appearance update and close the modal on success.

#### Scenario: Save submits appearance changes
- **WHEN** the user modifies appearance values and clicks Save
- **THEN** the appearance update is submitted to the backend
- **AND** the modal closes on success

### Requirement: Panel detail modal opens from the panel body click
The panel detail modal MUST also open when the user clicks the panel card body (not on an interactive control), as defined in the `panel-body-click` capability. Both triggers open the same modal.

#### Scenario: Panel body click opens the modal
- **WHEN** the user clicks the panel body (not on a drag handle, actions menu, title input, or resize handle)
- **THEN** the panel detail modal opens for that panel

