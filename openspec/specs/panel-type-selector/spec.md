## Purpose
Defines the panel type selector control available in the panel create form and its reset behavior.
## Requirements
### Requirement: Panel create form includes a type selector
The panel create form MUST present a type selector control offering all available panel types
(`metric`, `chart`, `text`, `table`, `image`) with `metric` pre-selected.

#### Scenario: Type selector appears when create form opens
- **WHEN** the user opens the panel create form
- **THEN** a type selector is visible with all five type options including `image`
- **AND** `metric` is the pre-selected option

#### Scenario: User selects a non-default type
- **WHEN** the user selects `chart` from the type selector
- **AND** submits the form with a valid title
- **THEN** the created panel has `type: "chart"`

#### Scenario: User selects image type
- **WHEN** the user selects `image` from the type selector
- **AND** submits the form with a valid title
- **THEN** the created panel has `type: "image"`

#### Scenario: User submits without changing the type
- **WHEN** the user submits the create form without interacting with the type selector
- **THEN** the created panel has `type: "metric"`

### Requirement: Type selector resets on form dismiss
The type selector MUST reset to `metric` when the create form is closed (whether by cancel or successful submission).

#### Scenario: Selector resets after successful create
- **GIVEN** the user selected `table` and created a panel
- **WHEN** the create form closes
- **AND** the user reopens the create form
- **THEN** the type selector shows `metric` as the selected option

#### Scenario: Selector resets on cancel
- **GIVEN** the user selected `image` in the type selector
- **WHEN** the user cancels the create form
- **AND** reopens it
- **THEN** the type selector shows `metric` as the selected option

