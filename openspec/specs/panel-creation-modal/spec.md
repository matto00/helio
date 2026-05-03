# panel-creation-modal Specification

## Purpose
Defines the two-step panel creation modal: type selection followed by title entry with live preview.
## Requirements
### Requirement: Panel creation opens a type-first modal
When the user initiates panel creation, the UI MUST open a modal dialog. The modal MUST display a type selection step before any other configuration is shown.

#### Scenario: Add panel button opens the modal
- **WHEN** the user clicks the "Add panel" button in the panel list header
- **THEN** a modal dialog opens
- **AND** the modal shows a panel type picker as the first and only step

#### Scenario: Empty state CTA opens the modal
- **WHEN** the user clicks the "Add panel" CTA in the empty panel list
- **THEN** the same panel creation modal opens at the type selection step

### Requirement: Modal type picker presents all available panel types
The type picker step MUST offer all available panel types as selectable options. No type SHALL be hidden or disabled by default.

#### Scenario: All panel types are visible on modal open
- **WHEN** the panel creation modal opens
- **THEN** the type picker shows options for: metric, chart, text, table, markdown, image, divider

#### Scenario: User selects a panel type and advances
- **WHEN** the user selects a panel type card
- **THEN** the selection is highlighted
- **AND** the user can proceed to the next step

### Requirement: Modal second step collects the panel title
After type selection, the modal MUST present a title input, a create button, and a live panel
preview pane. The form inputs SHALL be displayed in one column and the preview SHALL be displayed
in a second column on viewports 600 px and wider.

#### Scenario: Title step follows type selection
- **WHEN** the user has selected a type and proceeds
- **THEN** a title input field is shown
- **AND** a "Create panel" button is available
- **AND** a live preview pane is shown alongside the form displaying the selected panel type

#### Scenario: Create button submits with selected type
- **WHEN** the user enters a valid title and clicks "Create panel"
- **THEN** the frontend submits a panel-create request with the selected type and title
- **AND** the modal closes on success

### Requirement: Modal dismisses without creating a panel
The user MUST be able to cancel the modal at any step without creating a panel.

#### Scenario: User closes modal via close button
- **WHEN** the user clicks the close button on the modal
- **THEN** the modal closes
- **AND** no panel is created

#### Scenario: User closes modal via Escape key
- **WHEN** the modal is open and the user presses Escape
- **THEN** the modal closes
- **AND** no panel is created

### Requirement: Modal shows inline error on create failure
If the panel create API call fails, the modal MUST display an inline error message without closing.

#### Scenario: Create request fails
- **WHEN** the backend returns an error for the panel create request
- **THEN** an inline error message is shown inside the modal
- **AND** the modal remains open for the user to retry

### Requirement: Modal state resets on close
All modal-local state (selected type, entered title, error) MUST reset when the modal is closed, regardless of whether a panel was created.

#### Scenario: Modal resets after cancel
- **WHEN** the user cancels or closes the modal without creating a panel
- **AND** reopens the modal
- **THEN** the type picker step is shown with no type pre-selected
- **AND** any previously entered title is cleared

#### Scenario: Modal resets after successful create
- **WHEN** the user creates a panel and the modal closes
- **AND** the user opens the modal again
- **THEN** the type picker step is shown with no type pre-selected

