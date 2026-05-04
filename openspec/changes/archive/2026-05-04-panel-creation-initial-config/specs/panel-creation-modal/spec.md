## MODIFIED Requirements

### Requirement: Modal second step selects a template, third step names the panel
After type selection, the modal MUST present a template picker as Step 2 before the title/config form
(Step 3). The title/config form (Step 3) MUST display a live panel preview pane alongside the form
inputs. The form SHALL be displayed in one column and the preview in a second column on viewports
600 px and wider. Step 3 MUST also render optional type-specific configuration fields below the title
input as defined by the panel-creation-type-config spec.

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
