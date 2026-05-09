## MODIFIED Requirements

### Requirement: Modal second step selects a template, third step (data-bound types only) selects a DataType, final step names the panel
After type selection, the modal MUST present a template picker as Step 2 before advancing. For
data-bound panel types (metric, chart, text, table), a DataType picker step (Step 3) MUST follow
template selection before the title/config form (Step 4). For non-data-bound types (markdown, image,
divider), template selection MUST advance directly to the title/config form (Step 3). The title/config
form MUST display a live panel preview pane alongside the form inputs. The form SHALL be displayed in
one column and the preview in a second column on viewports 600 px and wider. The name-entry step
MUST also render optional type-specific configuration fields below the title input as defined by the
panel-creation-type-config spec.

#### Scenario: Template step follows type selection
- **WHEN** the user selects a panel type card
- **THEN** the template-select step is shown
- **AND** template cards for that panel type are displayed
- **AND** a "Start blank" card is shown at the end of the grid

#### Scenario: DataType step follows template selection for data-bound types
- **WHEN** the user selects a template card (or Start blank) for a data-bound panel type (metric, chart, text, table)
- **THEN** the DataType picker step is shown

#### Scenario: Name-entry step follows template selection for non-data-bound types
- **WHEN** the user selects a template card (or Start blank) for a non-data-bound panel type (markdown, image, divider)
- **THEN** the name-entry step is shown directly

#### Scenario: Name-entry step follows DataType selection for data-bound types
- **WHEN** the user selects a DataType and clicks Next on the DataType step
- **THEN** the name-entry step is shown

#### Scenario: User can navigate back from template step
- **WHEN** the user is on the template-select step
- **AND** clicks the Back button
- **THEN** the type-select step is shown
- **AND** no template selection is retained

#### Scenario: User can navigate back from DataType step
- **WHEN** the user is on the DataType picker step
- **AND** clicks the Back button
- **THEN** the template-select step is shown
- **AND** no DataType selection is retained

### Requirement: Modal state MUST reset on close including selected DataType
The modal MUST reset all local state (selected type, selected template, selected DataType, entered
title, error) when the modal is closed, regardless of whether a panel was created.

#### Scenario: Modal resets after cancel
- **WHEN** the user cancels or closes the modal without creating a panel
- **AND** reopens the modal
- **THEN** the type picker step is shown with no type pre-selected
- **AND** any previously selected template is cleared
- **AND** any previously selected DataType is cleared
- **AND** any previously entered title is cleared

#### Scenario: Modal resets after successful create
- **WHEN** the user creates a panel and the modal closes
- **AND** the user opens the modal again
- **THEN** the type picker step is shown with no type pre-selected
