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

### Requirement: The assistant's workspace search and context include named-grant dashboards with the caller's role

The assistant's `find` search, the workspace context (`GET /api/workspace/context`, and the grounding the assistant,
dashboard authoring and refinement build from it) SHALL include the dashboards the caller owns and the dashboards on
which the caller holds a named `editor` or `viewer` grant, each carrying `accessRole` (`owner`, `editor` or `viewer`).
A dashboard visible only through a public grant or a share token SHALL NOT be included. The context's dashboard count
SHALL count that same union.

#### Scenario: A viewer grantee's context lists the shared dashboard as viewer

- **WHEN** a user holding a named `viewer` grant on another user's dashboard requests the workspace context
- **THEN** the dashboards include that dashboard with `accessRole: "viewer"` and its real panel count

#### Scenario: The assistant's find returns a shared dashboard with its role

- **WHEN** an `editor` grantee's assistant searches for the shared dashboard by name
- **THEN** the result includes that dashboard and states the caller's role `editor`

#### Scenario: A public-only dashboard is excluded

- **WHEN** a dashboard has only a public viewer grant and a signed-in non-owner's context or search is assembled
- **THEN** that dashboard is not included

#### Scenario: A stranger sees nothing of another user's dashboards

- **WHEN** a user with no grant requests the workspace context or searches by the dashboard's name
- **THEN** the other user's dashboard is absent

### Requirement: A shared dashboard's detail exposes only what the dashboard grant allows

The assistant's dashboard detail SHALL be available for a dashboard the caller owns or holds a named grant on, with
the caller's role, and SHALL be not found otherwise. For a caller who holds no grant on a panel's pipeline, the detail
SHALL give each panel's id, title, kind and bound Output id only: no Output pipeline id, columns, sample rows or row
data. The assistant's Output detail SHALL remain owner-only, so a dashboard-only grantee cannot read a shared
dashboard's Output rows through the assistant. These facts SHALL hold when the database enforces row-level security
(the non-BYPASSRLS application role).

#### Scenario: Viewer reads the shared dashboard's detail without Output data

- **WHEN** a dashboard-only viewer grantee's assistant fetches the shared dashboard's detail
- **THEN** it returns the panels with `accessRole: "viewer"`, and no panel carries an Output pipeline id

#### Scenario: Viewer cannot read the bound Output through the assistant

- **WHEN** the same viewer's assistant fetches the bound Output's detail by id
- **THEN** the result is not found and no rows are returned

#### Scenario: A dashboard-only grantee cannot read the shared dashboard's Output routes

- **WHEN** a dashboard-only viewer or editor grantee requests `GET /api/outputs/:id/rows` for an Output bound to a panel
  on the shared dashboard, with row-level security enforced
- **THEN** the response is the same not-found as an unknown id and no rows are returned

### Requirement: The assistant never proposes an edit the caller's role forbids

The assistant SHALL be told each dashboard's role and that a `viewer` dashboard is read-only and owner-only actions are
unavailable to an `editor`. The server SHALL be the authority: a proposed patch set that edits, creates panels on, or
deletes panels of a dashboard where the caller is a `viewer`, or that deletes a dashboard the caller does not own,
SHALL be refused before any proposal is captured, with a message naming the reason. The same refusal SHALL apply when
such a patch set is previewed or applied directly.

#### Scenario: A viewer's edit proposal is refused

- **WHEN** a viewer grantee's assistant proposes a patch set renaming a panel on the shared dashboard
- **THEN** the tool result is an error stating the caller has view-only access, and no proposal is returned to the user

#### Scenario: An editor's dashboard delete is refused

- **WHEN** an editor grantee's assistant proposes a patch set deleting the shared dashboard
- **THEN** the tool result is an error stating only the owner can delete it, and no proposal is returned

#### Scenario: An editor's panel rename is proposed

- **WHEN** an editor grantee's assistant proposes renaming a panel on the shared dashboard
- **THEN** the proposal is accepted and returned for review

### Requirement: helio-mcp includes shared dashboards with the role and surfaces server refusals

helio-mcp's dashboard list, single-dashboard read and workspace context SHALL include dashboards held through a named
grant, each with `accessRole`. Reading a dashboard where the caller is a `viewer` SHALL return its panels. A write tool
aimed at a dashboard where the caller is a `viewer` SHALL fail as a tool error carrying the server's status and
refusal message, without a client-side guess.

#### Scenario: MCP lists and reads a viewer's shared dashboard

- **WHEN** a viewer grantee calls `list_dashboards` and then `get_dashboard` for the shared dashboard
- **THEN** the list includes it with `accessRole: "viewer"` and `get_dashboard` returns its panels

#### Scenario: MCP write on a viewer's dashboard fails cleanly

- **WHEN** a viewer grantee calls `update_dashboard` on the shared dashboard
- **THEN** the tool result is an error naming status 403 and the server's view-only message
