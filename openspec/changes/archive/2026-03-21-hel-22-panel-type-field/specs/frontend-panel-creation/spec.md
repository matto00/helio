## MODIFIED Requirements

### Requirement: Frontend panel creation is backend-backed
The frontend MUST create panels through the backend API in the context of the selected dashboard. The create request MUST include a `type` field when one is explicitly provided; when omitted, the backend default (`metric`) applies.

#### Scenario: User creates a panel from the panel list
- **GIVEN** a dashboard is selected
- **WHEN** the user enters a panel title and confirms create
- **THEN** the frontend submits a panel-create request to the backend
- **AND** the request includes the selected dashboard id

#### Scenario: Panel create request carries type when provided
- **GIVEN** a `type` value is supplied to the create thunk
- **WHEN** the frontend submits the create request
- **THEN** the request body includes the `type` field with the provided value
