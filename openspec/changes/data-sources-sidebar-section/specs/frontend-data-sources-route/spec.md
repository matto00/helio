## ADDED Requirements

### Requirement: /data-sources route renders DataSourcesPage
The frontend SHALL register a `/data-sources` route via React Router that renders `DataSourcesPage`. The sidebar SHALL include a "Data Sources" `NavLink` pointing to `/data-sources` within the `aria-label="Main navigation"` landmark, positioned between the Dashboards entry and the Sources (Type Registry) entry.

#### Scenario: Navigating to /data-sources shows DataSourcesPage
- **WHEN** the user navigates to `/data-sources`
- **THEN** `DataSourcesPage` is rendered showing the data source list and an "Add source" button

#### Scenario: Data Sources nav link is present in sidebar
- **WHEN** the sidebar is rendered
- **THEN** a "Data Sources" nav link is visible in the main navigation

#### Scenario: Data Sources nav link is active when on /data-sources
- **WHEN** the current route is `/data-sources`
- **THEN** the "Data Sources" nav link has the active state applied

### Requirement: DataSourcesPage fetches and lists data sources
`DataSourcesPage` SHALL dispatch `fetchSources` and `fetchDataTypes` on mount. When sources are loaded, `DataSourceList` renders one row per source showing: name, sourceType badge, Refresh and Delete action buttons.

#### Scenario: Empty sources state on DataSourcesPage
- **WHEN** `GET /api/data-sources` returns an empty list
- **THEN** "No data sources yet. Add one to get started." is displayed on `DataSourcesPage`

#### Scenario: Delete with confirmation on DataSourcesPage
- **WHEN** the user clicks the Delete button for a source on `DataSourcesPage`
- **THEN** a confirmation prompt ("Delete?") appears before the source is removed

#### Scenario: Refresh updates the DataType from DataSourcesPage
- **WHEN** the user clicks the Refresh button for a source on `DataSourcesPage`
- **THEN** the refresh endpoint is called and `fetchDataTypes` is dispatched on success

### Requirement: DataSourcesPage includes AddSourceModal
`DataSourcesPage` SHALL include an "Add source" button that opens `AddSourceModal` with all existing functionality (REST API, CSV, and Manual/Static tabs).

#### Scenario: Add source button opens modal on DataSourcesPage
- **WHEN** the user clicks "Add source" on `DataSourcesPage`
- **THEN** `AddSourceModal` opens with source type selection visible

#### Scenario: Creating a source from DataSourcesPage refreshes the list
- **WHEN** the user completes the AddSourceModal flow and clicks "Create source"
- **THEN** the new source appears in the list on `DataSourcesPage`
