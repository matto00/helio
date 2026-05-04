## ADDED Requirements

### Requirement: Edit mode shows a single unified scrollable settings form
When the panel detail modal transitions to edit mode, the modal body SHALL display a single scrollable form containing all applicable settings sections for the panel's type — with no tab bar.

#### Scenario: Edit mode shows all sections without tabs
- **WHEN** the user clicks the Edit button in the panel detail modal
- **THEN** the modal shows a single scrollable settings form
- **AND** the tab bar is not visible
- **AND** the Appearance section is visible at the top of the form

#### Scenario: Data-capable panels show Appearance and Data sections
- **WHEN** a metric or chart panel's edit mode is open
- **THEN** the form contains an Appearance section and a Data section (with type binding, field mapping, and refresh interval)
- **AND** no tab bar is present

#### Scenario: Markdown panels show Appearance and Content sections
- **WHEN** a markdown panel's edit mode is open
- **THEN** the form contains an Appearance section and a Content section (markdown textarea)
- **AND** no Data section or tab bar is present

#### Scenario: Image panels show Appearance and Image sections
- **WHEN** an image panel's edit mode is open
- **THEN** the form contains an Appearance section and an Image section (URL and fit controls)
- **AND** no Data section or tab bar is present

#### Scenario: Divider panels show Appearance and Divider sections
- **WHEN** a divider panel's edit mode is open
- **THEN** the form contains an Appearance section and a Divider section (orientation, weight, color)
- **AND** no Data section or tab bar is present

### Requirement: Edit mode Appearance section includes a title field
The Appearance section in edit mode SHALL include a text input for the panel title at the top of the section.

#### Scenario: Title field is pre-filled with the current panel title
- **WHEN** edit mode opens
- **THEN** the title input contains the panel's current title

#### Scenario: Saving with a changed title updates the panel title
- **WHEN** the user changes the title field and saves
- **THEN** the panel title is updated via the patch dispatch

### Requirement: Edit mode has a single unified Save button
Edit mode SHALL have a single Save button in the footer that, when clicked, submits all dirty sections and closes the modal on full success.

#### Scenario: Save dispatches all dirty section updates
- **WHEN** the user has modified appearance fields and data binding fields and clicks Save
- **THEN** all changed sections are persisted in sequence
- **AND** the modal closes after all saves succeed

#### Scenario: Save shows section-level inline error on failure
- **WHEN** saving one section fails
- **THEN** an inline error is shown adjacent to that section
- **AND** the modal remains open

#### Scenario: Save button is disabled while saving
- **WHEN** the save is in progress
- **THEN** the Save button is disabled and shows a saving indicator
