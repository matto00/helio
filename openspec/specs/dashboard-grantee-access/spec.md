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

When displaying a dashboard the caller does not own, the client SHALL read panel content only through the dashboard-scoped per-panel routes and SHALL NOT request `/api/outputs/*` or `/api/pipelines/*`; panel features not available through per-panel routes SHALL be hidden rather than shown broken.

#### Scenario: Viewer sees Output panel rows without Output routes

- **WHEN** a viewer grantee with no pipeline grant opens a shared dashboard containing an Output panel
- **THEN** the panel shows its rows, no request to `/api/outputs/*` or `/api/pipelines/*` is made, and no `/api/*` response is an error

### Requirement: Owner semantics in the app use owned dashboards only

The app's default landing dashboard and onboarding progress SHALL consider only dashboards the user owns.

#### Scenario: A newer shared dashboard does not become the landing dashboard

- **WHEN** a user who owns a dashboard and holds a grant on a more recently updated dashboard signs in
- **THEN** the app lands on their own dashboard
