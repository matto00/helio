# dashboard-grantee-access Specification

## Purpose
How a named dashboard grantee (editor or viewer) lists, opens, and views or edits a dashboard shared with them in the signed-in app, reading panel data only through per-panel routes.

## Requirements

### Requirement: The dashboard list includes named-grant dashboards with the caller's role

`GET /api/dashboards?include=shared` SHALL return the dashboards the caller owns and the dashboards on which the caller holds a named `editor` or `viewer` grant, paged and counted over that union, each item carrying `accessRole` (`owner`, `editor` or `viewer`). A dashboard visible only through a public grant or a share token SHALL NOT be listed.

#### Scenario: A viewer grantee sees the shared dashboard in their list

- **WHEN** a user holding a named `viewer` grant on another user's dashboard requests `GET /api/dashboards?include=shared`
- **THEN** the response includes that dashboard with `accessRole: "viewer"`

#### Scenario: Without the opt-in the list is unchanged

- **WHEN** a viewer grantee requests `GET /api/dashboards` without `include=shared`
- **THEN** the shared dashboard is not in the response and every item carries `accessRole: "owner"`

#### Scenario: A public-only grant is not listed

- **WHEN** a dashboard has only a public viewer grant and a signed-in non-owner requests `GET /api/dashboards?include=shared`
- **THEN** that dashboard is not in the response

#### Scenario: Owned dashboards are marked owner

- **WHEN** an owner requests `GET /api/dashboards`
- **THEN** each owned dashboard carries `accessRole: "owner"`

### Requirement: A grantee opens a shared dashboard in the signed-in app

The signed-in app SHALL open `/dashboards/:id` for any dashboard in the caller's list, including shared ones, and SHALL still show "Dashboard not found" for a dashboard the caller cannot access.

#### Scenario: Viewer grantee opens the dashboard

- **WHEN** a viewer grantee navigates to `/dashboards/:id` of the shared dashboard
- **THEN** the dashboard's panels render and "Dashboard not found" is not shown

#### Scenario: Stranger still gets not-found

- **WHEN** a signed-in user with no grant navigates to `/dashboards/:id`
- **THEN** "Dashboard not found" is shown

### Requirement: Shared dashboards are marked in the list

Dashboards whose `accessRole` is not `owner` SHALL show a "Shared" marker in the dashboards list/sidebar; owned dashboards SHALL NOT.

#### Scenario: Shared marker

- **WHEN** a grantee views their dashboards list
- **THEN** the shared dashboard shows a "Shared" marker and their own dashboards do not

### Requirement: Viewers get a read-only shell; editors get only what the server permits

On a dashboard whose `accessRole` is `viewer`, the shell SHALL NOT offer any editing affordance. On a dashboard whose `accessRole` is `editor`, the shell SHALL offer editing but SHALL NOT offer owner-only actions (share, delete, duplicate).

#### Scenario: Viewer sees no editing controls

- **WHEN** a viewer grantee opens the shared dashboard
- **THEN** no layout-edit, add-panel, rename, appearance, share, delete or duplicate control is offered

#### Scenario: Editor can rename a panel

- **WHEN** an editor grantee renames a panel on the shared dashboard
- **THEN** the change persists

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

### Requirement: Owner semantics in the app use owned dashboards only

The app's default landing dashboard and onboarding progress SHALL consider only dashboards the user owns.

#### Scenario: A newer shared dashboard does not become the landing dashboard

- **WHEN** a user who owns a dashboard and holds a grant on a more recently updated dashboard signs in
- **THEN** the app lands on their own dashboard

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
