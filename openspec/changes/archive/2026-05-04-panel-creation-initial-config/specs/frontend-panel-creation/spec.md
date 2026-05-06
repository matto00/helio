## MODIFIED Requirements

### Requirement: Frontend panel creation is backend-backed
The frontend MUST create panels through the backend API in the context of the selected dashboard. The create request MUST include the `type` selected by the user in the type-first modal; there is no default type assumed by the UI — the user MUST explicitly select a type before the create request is submitted. Any optional type-specific config values entered in step 3 MUST also be included in the create request payload.

#### Scenario: User creates a panel from the panel list
- **GIVEN** a dashboard is selected
- **WHEN** the user opens the panel creation modal, selects a type, enters a title, and confirms create
- **THEN** the frontend submits a panel-create request to the backend
- **AND** the request includes the selected dashboard id
- **AND** the request includes the type the user selected in the modal

#### Scenario: Panel create request carries type when provided
- **GIVEN** a `type` value is supplied to the create thunk
- **WHEN** the frontend submits the create request
- **THEN** the request body includes the `type` field with the provided value

#### Scenario: Panel create request carries type-specific config when provided
- **GIVEN** the user has entered one or more optional type-specific config values in step 3
- **WHEN** the frontend submits the create request
- **THEN** the request body includes the type-specific config fields with the entered values

### Requirement: Panel list refreshes after successful create
The frontend MUST refresh selected-dashboard panels after a successful panel creation.

#### Scenario: Panel create succeeds
- **GIVEN** panel create returns success
- **WHEN** the create flow completes
- **THEN** the frontend refreshes panels for the selected dashboard
- **AND** the newly created panel appears in rendered panel content

### Requirement: Inline panel creation exposes simple explicit feedback
The panel create modal MUST provide inline loading and failure feedback within the modal dialog.

#### Scenario: Panel create fails
- **GIVEN** the panel creation modal is open at the title step
- **WHEN** the backend create request fails
- **THEN** an inline error message is shown inside the modal
- **AND** the create action is re-enabled for retry
