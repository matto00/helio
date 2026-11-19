## MODIFIED Requirements

### Requirement: Non-owned dashboards read panel data only through per-panel routes

When displaying a dashboard the caller does not own, the client SHALL read panel content only through the dashboard-scoped per-panel routes and SHALL NOT request `/api/outputs/*` or `/api/pipelines/*`. Viewer controls, distinct values, filter capabilities, rows with sort and filter, cross-filter, history and compare sparklines, insight bodies and provenance SHALL be offered through those routes. Panel features not available through per-panel routes SHALL be hidden rather than shown broken.

#### Scenario: Viewer sees Output panel rows without Output routes

- **WHEN** a viewer grantee with no pipeline grant opens a shared dashboard containing an Output panel
- **THEN** the panel shows its rows, no request to `/api/outputs/*` or `/api/pipelines/*` is made, and no `/api/*` response is an error

#### Scenario: Viewer uses a panel's viewer controls

- **WHEN** a viewer grantee picks a value in a panel's dropdown control on a shared dashboard
- **THEN** the options come from the per-panel distinct-values route, the rows are re-read from the per-panel rows route with that filter, and no request to `/api/outputs/*` is made

#### Scenario: History, insight and provenance on a shared dashboard

- **WHEN** a dashboard-only grantee views a metric panel with a compare sparkline, an insight panel, and opens a panel's provenance
- **THEN** each is read from the per-panel `history`, `insight` and `provenance` routes and renders, with no request to `/api/outputs/*`

#### Scenario: Detail view offers controls and provenance

- **WHEN** a dashboard-only grantee opens an Output panel's detail view
- **THEN** the view shows the panel's viewer controls (options from per-panel distinct values) and its provenance, read through per-panel routes

## ADDED Requirements

### Requirement: Grantee table sort and filter split between server and browser

On a non-owned dashboard, a table panel's sort, column filters and filters from viewer controls on the panel's own control columns SHALL be applied by the per-panel rows route; sort, column filters and quick search on any other column SHALL be applied to the loaded rows in the browser with the loaded-scope disclosure. The client SHALL NOT send the per-panel rows route a column outside the panel's controls.

#### Scenario: Sort on a control column goes to the server

- **WHEN** a grantee sorts a shared table panel by a column that is one of the panel's control columns
- **THEN** the per-panel rows request carries that sort

#### Scenario: Sort on another column stays in the browser

- **WHEN** a grantee sorts a shared table panel by a column that is not one of its control columns
- **THEN** no request carries that sort, the loaded rows are sorted in the browser, and, when not every row is loaded, a disclosure says the sort covers only the loaded rows

#### Scenario: Quick search stays in the browser

- **WHEN** a grantee types in a shared table panel's quick search
- **THEN** the loaded rows are narrowed in the browser, no request carries `quick`, and, when not every row is loaded, a disclosure (or, with zero matches, the empty state) says only the loaded rows were searched

### Requirement: Cross-filter on a non-control column narrows loaded rows

On a non-owned dashboard, a cross-filter whose dimension is one of the target panel's control columns and that the panel's per-panel filter capabilities allow as `eq` SHALL be sent to the per-panel rows route; any other cross-filter that applies to the panel SHALL narrow the panel's loaded rows in the browser with the existing loaded-scope disclosure.

#### Scenario: Cross-filter on a non-control column

- **WHEN** a grantee cross-filters a shared dashboard by a dimension that a target panel uses but does not control
- **THEN** that panel narrows its loaded rows in the browser, shows the loaded-scope disclosure, and sends no request naming the dimension

### Requirement: The role is read per panel

The client SHALL decide whether a panel reads through Output routes or per-panel routes from the role on that panel's own dashboard, never from the currently selected dashboard.

#### Scenario: Switching from a shared dashboard to an owned one

- **WHEN** a grantee switches from a shared dashboard to one they own while the shared dashboard's panels are still mounted
- **THEN** no request to `/api/outputs/*` or `/api/pipelines/*` is made for a panel of the shared dashboard

### Requirement: Grantees never reach history payload rows

A dashboard-only grantee SHALL NOT be able to read history payload rows: `/api/outputs/:id/history/:point/rows` SHALL return `404` to them, the per-panel history response SHALL carry no point `id` or `hasPayload`, and no per-panel payload route SHALL exist.

#### Scenario: Viewer requests payload rows directly

- **WHEN** a dashboard-only viewer requests `/api/outputs/:id/history/:point/rows` for a panel's Output under the non-BYPASSRLS application role
- **THEN** the response is `404`

### Requirement: Insight refresh is not offered to non-owners

The card-header Refresh control of an insight panel SHALL NOT be shown on a dashboard the caller does not own.

#### Scenario: Grantee sees no insight Refresh

- **WHEN** a grantee views an insight panel on a shared dashboard
- **THEN** the card header shows no Refresh control for it
