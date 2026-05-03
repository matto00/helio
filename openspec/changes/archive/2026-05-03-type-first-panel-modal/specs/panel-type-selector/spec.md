## MODIFIED Requirements

### Requirement: Panel create modal includes a type picker as step one
The panel creation modal MUST present a type picker as its first step, offering all available panel types. The type picker SHALL be the only content on step one; no title input or other fields SHALL appear at this step.

#### Scenario: Type picker appears when creation modal opens
- **WHEN** the user opens the panel creation modal
- **THEN** a type picker is visible with all available type options: metric, chart, text, table, markdown, image, divider
- **AND** no type is pre-selected

#### Scenario: User selects a non-default type and creates
- **WHEN** the user selects `chart` from the type picker
- **AND** proceeds to the title step and submits with a valid title
- **THEN** the created panel has `type: "chart"`

#### Scenario: User selects image type
- **WHEN** the user selects `image` from the type picker
- **AND** proceeds to the title step and submits with a valid title
- **THEN** the created panel has `type: "image"`

#### Scenario: User must select a type before proceeding
- **WHEN** the panel creation modal opens
- **THEN** no type is pre-selected
- **AND** the user cannot proceed to the title step until a type is chosen

## MODIFIED Requirements

### Requirement: Type picker resets on modal close
The type picker MUST reset to an unselected state when the modal is closed, whether by cancel, Escape, or successful submission.

#### Scenario: Picker resets after successful create
- **GIVEN** the user selected `table` and created a panel
- **WHEN** the modal closes
- **AND** the user reopens the creation modal
- **THEN** the type picker shows no type pre-selected

#### Scenario: Picker resets on cancel
- **GIVEN** the user selected `image` in the type picker
- **WHEN** the user cancels or closes the modal
- **AND** reopens it
- **THEN** the type picker shows no type pre-selected
