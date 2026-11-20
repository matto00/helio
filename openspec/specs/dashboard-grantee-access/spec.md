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

The app's default landing dashboard and onboarding progress SHALL consider only dashboards the user owns. Only when the user owns no dashboard and holds at least one shared dashboard SHALL the default landing dashboard be the most recently updated shared dashboard.

#### Scenario: A newer shared dashboard does not become the landing dashboard

- **WHEN** a user who owns a dashboard and holds a grant on a more recently updated dashboard signs in
- **THEN** the app lands on their own dashboard

#### Scenario: A shared-only user lands on their most recent shared dashboard

- **WHEN** a user who owns no dashboard, and holds grants on two dashboards, opens `/dashboards`
- **THEN** the more recently updated shared dashboard opens, and the generic "No dashboard open" state is not shown

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

### Requirement: Grantees can ask about a shared dashboard

A grantee's shell SHALL offer "Ask about this dashboard" on a dashboard shared with them, for both `viewer` and
`editor` roles; Ask is not an owner-only action. Pinning an answer SHALL remain governed by the server's `pin` field.

#### Scenario: Viewer sees the Ask entry

- **WHEN** a viewer grantee opens a shared dashboard
- **THEN** the "Ask about this dashboard" entry is offered, while share, delete, duplicate and editing controls remain
  absent

### Requirement: A dashboard's panel status is readable by its grantees without Output or pipeline routes

The system SHALL serve `GET /api/dashboards/:id/panel-status` to a signed-in caller who owns the dashboard or holds an editor or viewer grant on it, re-checking that access on every request. Any other signed-in caller, and an unknown dashboard id, SHALL get the same `404`. The response SHALL list, for each Output panel of that dashboard whose Output and pipeline resolve, the panel id, the pipeline's last run time (or `null` when it has never run), the last run status (`succeeded`, `failed`, or `null`), the capture time of the panel's latest stored data (or `null`), and whether the panel's Output is data-invalid (an error-severity assertion on the Output's own step failed on the pipeline's latest non-dry run); and the distinct source names the per-panel provenance would show for the dashboard's Output panels, in first-seen panel order. The response SHALL NOT contain any pipeline, step, run, Output or user id, any step name, or any error or log text. Access SHALL hold under row-level security for the non-`BYPASSRLS` application role.

#### Scenario: Viewer and editor read panel status

- **WHEN** a dashboard-only viewer or editor grantee requests the panel status of the shared dashboard
- **THEN** the response is `200` with one item per resolvable Output panel carrying its last run time, run status, stored-data capture time and invalid flag, and the source names

#### Scenario: Stranger is refused without an existence leak

- **WHEN** a signed-in user with no grant on the dashboard requests its panel status
- **THEN** the response is `404`, identical to the response for an unknown dashboard id

#### Scenario: Sources only from what the dashboard's panels show

- **WHEN** a dashboard's only Output reads one root of a two-root pipeline and a grantee reads its panel status
- **THEN** the other root's source name is absent from the response

#### Scenario: Refresh signal follows committed data, not the run row

- **WHEN** a pipeline's last run time advances but no new data has been stored for the panel's Output yet
- **THEN** the panel's stored-data capture time in the response does not change, so no refresh fires

#### Scenario: No identifiers or error text leak

- **WHEN** any caller reads a dashboard's panel status after a failed run whose pipeline has an error log
- **THEN** the response contains no pipeline, step, run, Output or owner id, no step name and no error text

### Requirement: Grantees see the dashboard freshness line

On a dashboard the caller does not own, the client SHALL show the same refresh fact (relative time and success/failure intent) the owner sees, and the source names from the dashboard panel-status route (the sources the per-panel provenance shows for the dashboard's Output panels, which can be fewer than the owner's list), both derived from that route, on the desktop meta row and the phone "refreshed" caption, and SHALL make no request to `/api/outputs/*` or `/api/pipelines/*` to do so.

#### Scenario: Viewer sees when the data was refreshed

- **WHEN** a dashboard-only viewer opens a shared dashboard whose pipeline has run
- **THEN** the meta row shows the refreshed time and the sources, and no `/api/outputs/*` or `/api/pipelines/*` request is made

### Requirement: Grantee panels refresh when a run finishes

On a dashboard the caller does not own, while the page is visible, the client SHALL re-read the dashboard panel status periodically and, when a panel's latest stored-data capture time advances, SHALL re-read that panel's rows through the per-panel rows route. The first status read SHALL only set the baseline and SHALL NOT trigger a refresh, except for a panel whose rows were restored from the warm tab cache: for it the first status read SHALL compare against the restored rows' capture time and SHALL trigger the refresh when the panel's stored data is later.

#### Scenario: A run finishes while a viewer watches

- **WHEN** the owner runs the pipeline feeding a panel on a shared dashboard a dashboard-only viewer has open, and the run succeeds
- **THEN** the viewer's panel shows the new rows without a page reload, read through the per-panel rows route, with no `/api/outputs/*` or `/api/pipelines/*` request

#### Scenario: A run between the last change check and a warm return still refreshes

- **WHEN** a viewer returns to a warm shared dashboard whose panel received new data after its rows were captured, but before the client's change signals reported it
- **THEN** the first panel status read re-reads that panel's rows through the per-panel rows route

#### Scenario: A shared panel remounted after status polling stopped still refreshes

- **WHEN** a viewer leaves a shared dashboard (its panel status polling stops), the panel's data advances, and the viewer returns within seconds without a warm-cache restore
- **THEN** the panel's rows are re-read through the per-panel rows route and show the new data

### Requirement: Grantees see the data-invalid badge

On a dashboard the caller does not own, an Output panel whose status reports it data-invalid SHALL show the same "Invalid data" badge the owner sees, from the dashboard panel-status route.

#### Scenario: Failed assertion shows the badge to an editor

- **WHEN** the latest real run of the pipeline behind a panel failed an error-severity assertion on that panel's Output step and a dashboard-only editor opens the shared dashboard
- **THEN** the panel shows the "Invalid data" badge, and no `/api/outputs/*` request is made

### Requirement: Viewers see a "View only" indicator

On a dashboard whose `accessRole` is `viewer`, the desktop dashboard meta row and the phone meta line SHALL show a visible "View only" indicator. It SHALL NOT be shown to an editor or to the owner.

#### Scenario: Viewer sees View only on desktop

- **WHEN** a viewer grantee opens the shared dashboard at desktop width
- **THEN** the meta row shows "View only"

#### Scenario: Viewer sees View only on phone

- **WHEN** a viewer grantee opens the shared dashboard on the phone shell
- **THEN** the meta line above the panels shows "View only"

#### Scenario: Editor and owner see no View only

- **WHEN** an editor grantee or the owner opens the dashboard
- **THEN** no "View only" indicator is shown

### Requirement: Editing shortcuts are inert for viewers

On a dashboard the caller cannot edit, the layout undo and redo keyboard shortcuts SHALL do nothing, and they SHALL NOT prevent the browser's default handling of the key.

#### Scenario: Undo does nothing for a viewer

- **WHEN** a viewer presses the layout undo or redo combination on a shared dashboard
- **THEN** no layout change is applied and nothing is saved

### Requirement: The command palette offers no editing entry to a viewer

With a viewer's dashboard open, the command palette SHALL NOT list any entry that edits that dashboard (including "Add panel"). Entries that create the caller's own resources (new dashboard, source or pipeline) and navigation entries SHALL remain. An editor SHALL still see "Add panel".

#### Scenario: Viewer palette has no Add panel

- **WHEN** a viewer opens the command palette on a shared dashboard
- **THEN** "Add panel" is absent and "New dashboard" is present

#### Scenario: Editor palette keeps Add panel

- **WHEN** an editor opens the command palette on a shared dashboard
- **THEN** "Add panel" is present

### Requirement: Viewer empty states never invite editing

No empty state or call to action shown on a viewer's dashboard, on desktop or phone, SHALL offer or describe an editing action.

#### Scenario: Viewer's empty dashboard

- **WHEN** a viewer opens a shared dashboard with no panels
- **THEN** the empty state offers no action and does not ask them to add a panel

### Requirement: Phone sheet, chips and pull-to-refresh respect the role

On the phone shell, the dashboard sheet SHALL NOT offer an owner-only action (such as Share) on a dashboard the caller does not own. The chip row SHALL switch to a shared dashboard like any other. Pull-to-refresh and the Refresh dashboard button SHALL refresh a shared dashboard's panels for both viewers and editors without an Output or pipeline route error.

#### Scenario: Viewer pulls to refresh

- **WHEN** a viewer pulls to refresh a shared dashboard with output-bound panels on the phone shell
- **THEN** the panels refresh and no error is shown

#### Scenario: Editor's sheet has no Share

- **WHEN** an editor opens the phone dashboard sheet
- **THEN** the shared dashboard's row offers no Share action

### Requirement: A shared-only user is offered building their own dashboard

While a user owns no dashboard but has at least one shared with them:
- Home SHALL show the first-run drop zone below the dashboard shelf, which still lists the shared dashboards.
- The sidebar dashboards list and the phone dashboard sheet SHALL show a "Build your own dashboard" entry. Choosing it SHALL close the open dashboard and show the first-run drop zone in its place on `/dashboards`. Whenever a user who owns no dashboard has no dashboard open on `/dashboards`, the first-run drop zone SHALL be shown instead of the generic "No dashboard open" state.

Once the user owns a dashboard, none of these SHALL be shown.

#### Scenario: Home for a shared-only user

- **WHEN** a shared-only user opens Home
- **THEN** the shared dashboards are listed with their "Shared" badge and the first-run drop zone is shown

#### Scenario: Build your own from the sidebar

- **WHEN** a shared-only user chooses "Build your own dashboard" in the sidebar
- **THEN** no dashboard is open and the first-run drop zone is shown on `/dashboards`

#### Scenario: Entry gone once the user owns a dashboard

- **WHEN** a user owns at least one dashboard
- **THEN** no "Build your own dashboard" entry is shown in the sidebar or the phone sheet

### Requirement: One Shared badge style

The phone chip's "Shared" marker SHALL use the same badge treatment as the sidebar list and Home card badges, and SHALL remain legible in both themes, including on the active chip.

#### Scenario: Chip badge matches

- **WHEN** a shared dashboard's chip is shown on the phone dashboard view, in either theme
- **THEN** its "Shared" marker has the same badge background, colour, type and padding as the sidebar badge (adapted only for contrast on the active chip)
