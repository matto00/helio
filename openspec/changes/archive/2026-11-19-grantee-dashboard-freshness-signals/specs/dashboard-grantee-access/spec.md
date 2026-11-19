## ADDED Requirements

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

On a dashboard the caller does not own, while the page is visible, the client SHALL re-read the dashboard panel status periodically and, when a panel's latest stored-data capture time advances, SHALL re-read that panel's rows through the per-panel rows route. The first status read SHALL only set the baseline and SHALL NOT trigger a refresh.

#### Scenario: A run finishes while a viewer watches

- **WHEN** the owner runs the pipeline feeding a panel on a shared dashboard a dashboard-only viewer has open, and the run succeeds
- **THEN** the viewer's panel shows the new rows without a page reload, read through the per-panel rows route, with no `/api/outputs/*` or `/api/pipelines/*` request

### Requirement: Grantees see the data-invalid badge

On a dashboard the caller does not own, an Output panel whose status reports it data-invalid SHALL show the same "Invalid data" badge the owner sees, from the dashboard panel-status route.

#### Scenario: Failed assertion shows the badge to an editor

- **WHEN** the latest real run of the pipeline behind a panel failed an error-severity assertion on that panel's Output step and a dashboard-only editor opens the shared dashboard
- **THEN** the panel shows the "Invalid data" badge, and no `/api/outputs/*` request is made
