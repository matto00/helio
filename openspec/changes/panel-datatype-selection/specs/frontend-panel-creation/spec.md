## MODIFIED Requirements

### Requirement: Frontend panel creation is backend-backed
The frontend MUST create panels through the backend API in the context of the selected dashboard. The
create request MUST include the `type` selected by the user in the type-first modal; there is no
default type assumed by the UI — the user MUST explicitly select a type before the create request is
submitted. For data-bound panel types (metric, chart, text, table), the create request MUST also
include the `dataTypeId` selected in the DataType picker step; the Create button SHALL be disabled
until a DataType is selected. Any optional type-specific config values entered in the name-entry step
MUST also be included in the create request payload.

#### Scenario: User creates a panel from the panel list
- **GIVEN** a dashboard is selected
- **WHEN** the user opens the panel creation modal, selects a data-bound type, selects a template, selects a DataType, enters a title, and confirms create
- **THEN** the frontend submits a panel-create request to the backend
- **AND** the request includes the selected dashboard id
- **AND** the request includes the type the user selected in the modal
- **AND** the request includes the dataTypeId the user selected in the DataType step

#### Scenario: Panel create request carries type when provided
- **GIVEN** a `type` value is supplied to the create thunk
- **WHEN** the frontend submits the create request
- **THEN** the request body includes the `type` field with the provided value

#### Scenario: Panel create request carries dataTypeId for data-bound types
- **GIVEN** a data-bound panel type is selected and a DataType has been chosen
- **WHEN** the frontend submits the create request
- **THEN** the request body includes the `dataTypeId` field with the chosen DataType's id

#### Scenario: Panel create request does not carry dataTypeId for non-data-bound types
- **GIVEN** a non-data-bound panel type (markdown, image, divider) is selected
- **WHEN** the frontend submits the create request
- **THEN** the request body does not include a `dataTypeId` field

#### Scenario: Panel create request carries type-specific config when provided
- **GIVEN** the user has entered one or more optional type-specific config values in the name-entry step
- **WHEN** the frontend submits the create request
- **THEN** the request body includes the type-specific config fields with the entered values

#### Scenario: Create button is disabled until DataType is selected for data-bound types
- **GIVEN** the user has reached the name-entry step for a data-bound panel type
- **WHEN** no DataType was selected (should not happen in normal flow but guards against state edge cases)
- **THEN** the Create button is disabled
