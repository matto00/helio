## MODIFIED Requirements

### Requirement: Authenticated history read
The backend SHALL expose `GET /api/outputs/:id/history?limit=&since=` returning the Output's history points newest
first. `limit` SHALL default to 30 and SHALL be an integer in 1..100; any other value SHALL be rejected with 400 and
never clamped. `since`, when present, SHALL be an ISO-8601 instant, and only points captured at or after it SHALL be
returned. A malformed `since` SHALL be rejected with 400. Each point SHALL carry its id (a UUID usable as `:point` on
`GET /api/outputs/:id/history/:point/rows`), a `hasPayload` boolean that is true exactly when a stored row payload is
linked to that point, its capture time, run id (explicit `null` when none), trigger source, row count and stored
summary. The route SHALL be readable by the Output's owner and by grantees of its pipeline, and SHALL return 404 with
a body identical to an unknown id for any other authenticated caller.

#### Scenario: Owner reads history newest first
- **WHEN** the owner requests history for an Output with three recorded points
- **THEN** the response is 200 with the three points ordered newest first

#### Scenario: since and limit narrow the points
- **WHEN** `limit=2` is requested for an Output with five points
- **THEN** only the two newest points are returned
- **WHEN** `since` names an instant between the second- and third-newest points
- **THEN** only the two newest points are returned

#### Scenario: Out-of-range or malformed parameters
- **WHEN** `limit` is 0, 101 or non-numeric, or `since` is not an ISO-8601 instant
- **THEN** the response is 400

#### Scenario: Grantee can read
- **WHEN** a user the pipeline is shared with requests the history, through a role that does not bypass row-level
  security
- **THEN** the response is 200

#### Scenario: Non-grantee gets an indistinguishable 404
- **WHEN** an authenticated user with no access to the pipeline requests the history of a real Output
- **THEN** the response is 404 with the same status and body as a request for a nonexistent Output id

#### Scenario: Point ids resolve on the payload route
- **WHEN** the owner lists history for an opted-in Output whose newest point has a stored payload
- **THEN** that point has `hasPayload: true` and its `id` returns 200 from the payload rows route, while a point with
  `hasPayload: false` returns 404 there

### Requirement: Public history read is allow-listed
The backend SHALL expose `GET /api/dashboards/:dashboardId/panels/:panelId/history?limit=&since=&token=` with the same
dashboard-level sharing gate and panel-on-this-dashboard resolution as the other public panel routes. It SHALL return
the same comparison resolution, but its points SHALL carry only capture time, row count and stored summary, never point
ids, payload indicators, run ids, trigger sources, owner ids or any full-row payload. Parameter validation SHALL match
the authenticated route. No public route SHALL serve a history point's row payload.

#### Scenario: Anonymous viewer of a public dashboard
- **WHEN** an unauthenticated caller requests the history of an Output panel on a publicly shared dashboard
- **THEN** the response is 200 and contains no run id, trigger source or owner id

#### Scenario: Gate failures are 404
- **WHEN** the dashboard is not visible to the caller, or the panel is not on that dashboard, or the panel is not an Output
  panel, or its Output no longer exists
- **THEN** the response is 404

#### Scenario: Public history never exposes payload linkage
- **WHEN** an anonymous caller reads the public history of a panel whose Output has a point with a stored payload
- **THEN** no point carries an `id`, `hasPayload`, `payloadId` or `rows` key

#### Scenario: Public payload path does not exist
- **WHEN** an anonymous caller, with and without a valid share token, requests
  `/api/dashboards/:dashboardId/panels/:panelId/history/<realPointId>/rows` through the full API route tree
- **THEN** no public route handles the request, the response is 401 (the authenticated tree's no-credential
  response) and it carries no row data
