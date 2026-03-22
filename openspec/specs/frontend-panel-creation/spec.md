### Requirement: Frontend panel creation is backend-backed
The frontend MUST create panels through the backend API in the context of the selected dashboard. The create request MUST include the `type` selected by the user; when no type is explicitly chosen, `metric` is the default and SHALL be submitted.

#### Scenario: User creates a panel from the panel list
- **GIVEN** a dashboard is selected
- **WHEN** the user enters a panel title, optionally selects a type, and confirms create
- **THEN** the frontend submits a panel-create request to the backend
- **AND** the request includes the selected dashboard id
- **AND** the request includes the selected `type` (defaulting to `metric`)

#### Scenario: Panel create request carries type when provided
- **GIVEN** a `type` value is supplied to the create thunk
- **WHEN** the frontend submits the create request
- **THEN** the request body includes the `type` field with the provided value

### Requirement: Panel list refreshes after successful create
The frontend MUST refresh selected-dashboard panels after a successful panel creation.

#### Scenario: Panel create succeeds
- **GIVEN** panel create returns success
- **WHEN** the create flow completes
- **THEN** the frontend refreshes panels for the selected dashboard
- **AND** the newly created panel appears in rendered panel content

### Requirement: Inline panel creation exposes simple explicit feedback
The panel create flow MUST provide inline loading and failure feedback.

#### Scenario: Panel create fails
- **GIVEN** panel create mode is open
- **WHEN** the backend create request fails
- **THEN** an inline error message is shown
- **AND** the create action is re-enabled for retry
