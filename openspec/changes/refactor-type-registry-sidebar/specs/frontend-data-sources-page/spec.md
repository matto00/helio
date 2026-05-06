## REMOVED Requirements

### Requirement: TypeRegistryBrowser with inline TypeDetailPanel
**Reason**: Type Registry has been extracted into its own top-level sidebar section and route
(`/registry`). It is no longer rendered as a section within `SourcesPage`.
**Migration**: Navigate to the "Type Registry" sidebar entry at `/registry` to access all
data-type list, detail, and management functionality. `TypeRegistryBrowser` and `TypeDetailPanel`
components are unchanged and are now hosted by `TypeRegistryPage`.

## MODIFIED Requirements

### Requirement: /sources route renders SourcesPage
The frontend SHALL register a `/sources` route via React Router that renders `SourcesPage`. The
existing `/` route continues to render the dashboard panel view. Navigation between the routes is
provided by `NavLink` components in the app sidebar with `aria-label="Main navigation"`.

#### Scenario: Navigating to /sources shows SourcesPage
- **WHEN** the user navigates to `/sources`
- **THEN** `SourcesPage` is rendered with the "Data Sources" section heading visible

#### Scenario: Navigating to / shows dashboard view
- **WHEN** the user is on `/sources` and clicks the Dashboards nav link
- **THEN** the panel list and dashboard controls are visible

### Requirement: SourcesPage lists data sources
`SourcesPage` SHALL dispatch `fetchSources` on mount. When sources are loaded, `DataSourceList`
renders one row per source showing: name, sourceType badge, Refresh and Delete action buttons.
`SourcesPage` SHALL NOT dispatch `fetchDataTypes` — that responsibility belongs to `TypeRegistryPage`.

#### Scenario: Empty sources state
- **WHEN** `GET /api/data-sources` returns an empty list
- **THEN** "No data sources yet. Add one to get started." is displayed

#### Scenario: Delete with confirmation
- **WHEN** the user clicks the Delete button for a source
- **THEN** a confirmation prompt ("Delete?") appears before the source is removed

#### Scenario: Refresh updates the DataType
- **WHEN** the user clicks the Refresh button for a source
- **THEN** `POST /api/sources/:id/refresh` or `POST /api/data-sources/:id/refresh` is called and `fetchDataTypes` is dispatched on success
