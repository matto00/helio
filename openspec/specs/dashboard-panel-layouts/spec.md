## ADDED Requirements

### Requirement: Dashboard resources expose responsive panel layout state
Dashboard resources MUST expose a nested `layout` object that stores panel placement by responsive breakpoint.

#### Scenario: Dashboard response includes layout object
- **WHEN** a client fetches dashboard resources
- **THEN** each dashboard response includes a `layout` object
- **AND** the layout object is represented separately from `appearance` and `meta`
- **AND** the layout object includes supported breakpoint collections for saved panel placement

### Requirement: Dashboard layout state is persisted through updates
The backend MUST persist dashboard layout changes so later reads return the saved arrangement.

#### Scenario: Dashboard layout is updated
- **GIVEN** an existing dashboard with panels
- **WHEN** a client submits an update that changes the dashboard `layout`
- **THEN** the dashboard stores the updated panel positions and sizes
- **AND** a later fetch for that dashboard returns the saved `layout`
- **AND** the dashboard `meta.lastUpdated` is refreshed

### Requirement: Dashboard layout contract is validated
The dashboard schema MUST validate the nested layout object and saved layout item shape.

#### Scenario: Dashboard schema defines layout
- **WHEN** dashboard payloads are validated against the schema
- **THEN** the schema requires a `layout` object
- **AND** layout items validate the supported grid fields for each breakpoint
