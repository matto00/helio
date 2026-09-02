# public-dashboards Specification

## Purpose
Lets an anonymous or non-grantee caller who can already see a shared dashboard (per its sharing
ACL) read that dashboard's panel metadata and row data end-to-end (`panel → output →
node_snapshot`) over HTTP, closing the gap where output-kind panels resolve `dataAsOf` but have
no route to fetch their actual rows without authenticating. This is an API-level capability; no
public-dashboard frontend viewer exists in this codebase yet (tracked as a follow-up ticket).

## Requirements

### Requirement: Public panel list resolves via output, not data type
`GET /api/dashboards/:id/panels` SHALL resolve each output-kind panel's `dataAsOf` via
`panel.outputId → output → pipeline.lastRunAt`. The route SHALL NOT depend on any retired
DataType/Metric concept.

#### Scenario: dataAsOf reflects the owning pipeline's last successful run
- **WHEN** an unauthenticated caller requests `GET /api/dashboards/:id/panels` for a shared
  dashboard containing an output-kind panel
- **THEN** the response's `dataAsOf` for that panel equals the ISO timestamp of the owning
  pipeline's last successful run
- **AND** a panel whose Output or pipeline can no longer be resolved returns `dataAsOf: null`
  rather than failing the request

### Requirement: Public row read for a shared dashboard's panel
The system SHALL expose `GET /api/dashboards/:dashboardId/panels/:panelId/rows`, gated by the
same sharing-aware `authorizeResourceWithSharing("dashboard", ...)` directive already applied to
`GET /api/dashboards/:id/panels`, returning the current `node_snapshot` rows of that panel's
bound Output, paginated identically to the authenticated `GET /api/outputs/:id/rows`. The route
SHALL resolve `panelId → outputId → node_snapshot` without requiring the caller to hold the
authenticated-only `/api/outputs/:id/rows` route's credentials.

#### Scenario: Anonymous caller reads panel rows on a shared dashboard
- **WHEN** an unauthenticated caller who can view a shared dashboard (per its sharing ACL)
  requests `GET /api/dashboards/:dashboardId/panels/:panelId/rows` for one of that dashboard's
  output-kind panels
- **THEN** the system returns `200 OK` with that panel's bound Output's current `node_snapshot`
  rows, paginated the same way as `GET /api/outputs/:id/rows`

#### Scenario: Anonymous caller cannot read rows for a panel on a non-shared dashboard
- **WHEN** an unauthenticated caller requests `GET /api/dashboards/:dashboardId/panels/:panelId/rows`
  for a dashboard that is not shared/public and they hold no grant on
- **THEN** the system returns an authorization error, not the rows

#### Scenario: Missing or unresolvable Output degrades gracefully
- **WHEN** a request is made for a panel whose bound Output or owning pipeline no longer exists
- **THEN** the system returns an empty rows result rather than a server error

### Requirement: RLS enforces tenant isolation on the public read path
Row-level security policies on `outputs` and `node_snapshots` SHALL be proven, under a
non-superuser, non-`BYPASSRLS` database role, to allow the public read path only for
dashboards/outputs the caller's sharing grant (or public flag) actually covers, and to deny it
otherwise.

#### Scenario: RLS smoke test proves itself red
- **WHEN** the RLS smoke test's policy under test is dropped
- **THEN** the test fails (proving the test is not vacuous under a superuser/bypass connection)

#### Scenario: Cross-tenant denial on the public path
- **WHEN** a non-superuser role queries `outputs`/`node_snapshots` for a pipeline it has no
  sharing grant to and that is not publicly shared
- **THEN** the query returns zero rows
