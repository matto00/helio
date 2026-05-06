## MODIFIED Requirements

### Requirement: /sources route renders SourcesPage
The frontend SHALL register a `/sources` route via React Router that renders `SourcesPage`. The existing `/` route continues to render the dashboard panel view. Navigation between routes is provided by `NavLink` components in the app sidebar with `aria-label="Main navigation"`. `SourcesPage` SHALL render only the Type Registry section (TypeRegistryBrowser + TypeDetailPanel); it SHALL NOT render `DataSourceList` or `AddSourceModal`.

#### Scenario: Navigating to /sources shows SourcesPage with Type Registry only
- **WHEN** the user navigates to `/sources`
- **THEN** `SourcesPage` is rendered with the "Type Registry" section heading visible and no Data Sources section

#### Scenario: Navigating to / shows dashboard view
- **WHEN** the user is on `/sources` and clicks the Dashboards nav link
- **THEN** the panel list and dashboard controls are visible

## REMOVED Requirements

### Requirement: SourcesPage lists data sources
**Reason**: Data Sources listing has moved to the dedicated `DataSourcesPage` at `/data-sources`. `SourcesPage` is now Type Registry only.
**Migration**: Use `/data-sources` (rendered by `DataSourcesPage`) for all data source list, create, delete, and refresh interactions.

### Requirement: Two-step AddSourceModal with schema preview
**Reason**: `AddSourceModal` is now owned by `DataSourcesPage`. The modal itself is unchanged; only its mount point moves.
**Migration**: `AddSourceModal` is opened from `DataSourcesPage` at `/data-sources`.
