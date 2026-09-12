## Purpose
Defines the frontend dashboard creation flow: creating dashboards through the backend API, selecting the newly created dashboard, and surfacing inline loading and failure feedback.

## Requirements

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

### Requirement: Newly created dashboard becomes active
The frontend MUST select a newly created dashboard after successful creation.

#### Scenario: Dashboard create succeeds
- **GIVEN** a dashboard create request succeeds
- **WHEN** the backend returns the created dashboard
- **THEN** that dashboard is set as the active selection
- **AND** selection-driven panel loading behavior continues to use the active dashboard id

### Requirement: Inline creation flow exposes explicit simple feedback
The dashboard creation flow MUST provide simple inline feedback for loading and failure states.

#### Scenario: Dashboard create fails
- **GIVEN** dashboard create mode is open
- **WHEN** the backend create request fails
- **THEN** the frontend renders an inline error state
- **AND** the submit action is re-enabled so the user can retry
