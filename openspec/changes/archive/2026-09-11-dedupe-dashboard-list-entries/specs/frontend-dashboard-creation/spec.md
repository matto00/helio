## MODIFIED Requirements

### Requirement: Frontend dashboard creation is backend-backed
The frontend MUST create dashboards through the backend API rather than local-only state
scaffolding, and MUST NOT end up with more than one entry for the same dashboard id in frontend
state regardless of how the create response and any concurrent dashboards list fetch interleave.

#### Scenario: User creates a dashboard from the dashboard list
- **GIVEN** the dashboard list is visible
- **WHEN** the user enters a dashboard name and confirms create
- **THEN** the frontend submits a dashboard-create request to the backend
- **AND** the created dashboard from the backend response is added to frontend state

#### Scenario: A dashboards list refetch resolves concurrently with a create
- **GIVEN** a dashboard create request is in flight
- **AND** a dashboards list fetch is also in flight
- **WHEN** both requests resolve, in either order, and the list response already contains the
  newly created dashboard
- **THEN** frontend state contains exactly one entry for that dashboard id
- **AND** exactly one dashboard-list button renders for that dashboard's name
