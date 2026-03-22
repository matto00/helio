## MODIFIED Requirements

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
