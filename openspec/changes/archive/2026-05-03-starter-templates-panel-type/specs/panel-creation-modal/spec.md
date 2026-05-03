## MODIFIED Requirements

### Requirement: Modal second step collects the panel title
After type selection, the modal MUST present a template picker as Step 2 before the title form (Step 3).
The original "second step is the title form" is replaced by the template-select step inserting between
type selection and title entry.

#### Scenario: Template step follows type selection
- **WHEN** the user selects a panel type card
- **THEN** the template-select step is shown
- **AND** template cards for that panel type are displayed
- **AND** a "Start blank" card is shown at the end of the grid

#### Scenario: Template selection advances to name entry
- **WHEN** the user selects a template card or the "Start blank" card
- **THEN** the name-entry step is shown

#### Scenario: User can navigate back from template step
- **WHEN** the user is on the template-select step
- **AND** clicks the Back button
- **THEN** the type-select step is shown
- **AND** no template selection is retained

### Requirement: Modal state resets on close
All modal-local state (selected type, selected template, entered title, error) MUST reset when the modal
is closed, regardless of whether a panel was created.

#### Scenario: Modal resets after cancel
- **WHEN** the user cancels or closes the modal without creating a panel
- **AND** reopens the modal
- **THEN** the type picker step is shown with no type pre-selected
- **AND** any previously selected template is cleared
- **AND** any previously entered title is cleared

#### Scenario: Modal resets after successful create
- **WHEN** the user creates a panel and the modal closes
- **AND** the user opens the modal again
- **THEN** the type picker step is shown with no type pre-selected
