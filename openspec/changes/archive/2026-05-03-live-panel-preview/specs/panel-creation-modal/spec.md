## MODIFIED Requirements

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
