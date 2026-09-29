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

### Requirement: Public dashboard reads may be authorized by a share token

The public dashboard read routes SHALL accept a share token supplied as the URL query parameter named `token`
and SHALL serve the dashboard's panels and rows when that token is valid for the dashboard. The parameter name
`token` is part of the published contract, because the share URL must itself carry the credential — a link or
an embedding frame cannot attach a request header — and a downstream embed view consumes this exact interface. Serving under a token SHALL return the
same representation the public-viewer grant path returns; a token SHALL NOT widen what is exposed.

#### Scenario: Panels are readable with a valid token
- **WHEN** an unauthenticated caller requests a dashboard's panels with `?token=<valid token>`
- **THEN** the panels are returned, identically to the public-viewer grant path

#### Scenario: Rows are readable with a valid token
- **WHEN** an unauthenticated caller requests a panel's rows presenting a valid share token for the dashboard
- **THEN** the rows are returned, identically to the public-viewer grant path

#### Scenario: A token does not expose more than a public grant
- **WHEN** a dashboard is read under a valid share token
- **THEN** no field, panel, or row is exposed that the public-viewer grant path would not expose

#### Scenario: Invalid token yields the private-resource response
- **WHEN** an unauthenticated caller requests a dashboard's panels presenting an expired, revoked, or unknown
  token, and no public viewer grant applies
- **THEN** the response is the same `404 Not Found` returned for a private dashboard

### Requirement: Tenant isolation holds on the token-authorized read path

Row-level tenant isolation SHALL apply to reads authorized by a share token exactly as it applies to reads
authorized by a public-viewer grant. A share token SHALL NOT cause data belonging to another tenant to be
returned.

#### Scenario: Token read is confined to the owning tenant's data
- **WHEN** a dashboard is read under a valid share token
- **THEN** only rows belonging to the dashboard owner's tenant are returned

### Requirement: Public panel rows accept sort and filter parameters
`GET /api/dashboards/:dashboardId/panels/:panelId/rows` SHALL accept the same `sort=` and
`filter=` query parameters, with the same PARSING shape and validation, as the authenticated
`GET /api/outputs/:id/rows` (HEL-1027/HEL-1188), and SHALL apply them via the same
`OutputRowsQuery` resolution — not a separately maintained parsing/resolution path. Pagination,
counts, and `hasMore` SHALL describe the filtered result, consistent with the authenticated route.
**However, the SET OF COLUMNS this route accepts in `filter=` is narrower than the authenticated
route's: a `filter=` naming any column SHALL be rejected unless that column is the bound `column`
of one of the panel's own `output_controls` (HEL-1189) — an Output-eligible column that is not
one of this panel's configured controls SHALL be rejected exactly as it would be under the
"Public filter-capability and distinct-values reads are scoped to the panel's own configured
controls" Requirement below, not silently accepted.** `sort=` carries no such restriction (sorting
does not expose distinct values the way filtering by an arbitrary column can).

#### Scenario: A public rows request narrows via filter
- **WHEN** an anonymous caller requests `GET /api/dashboards/:dashboardId/panels/:panelId/rows`
  with a `filter=` parameter naming a `gte`/`lte` range on a column that IS one of the panel's own
  configured controls
- **THEN** the returned rows, count, and `hasMore` describe the filtered set, identically in shape
  to what the authenticated `GET /api/outputs/:id/rows` would return for the same filter

#### Scenario: A public rows request is rejected for a non-control column filter
- **WHEN** an anonymous caller requests `GET /api/dashboards/:dashboardId/panels/:panelId/rows`
  with a `filter=` parameter naming a column that is Output-eligible but is NOT the bound column of
  any control configured on this panel
- **THEN** the request is rejected (not silently served, not silently narrowed to ignore that term)

### Requirement: Public filter-capability and distinct-values reads are scoped to the panel's own configured controls
The system SHALL expose public/optional-auth equivalents of `filter-capabilities` and
`distinct-values`, resolved from `dashboardId` + `panelId` (never a caller-supplied `outputId` or
arbitrary `column`). A request SHALL be rejected unless the requested column is one the panel's
OWN persisted `output_controls` configuration (HEL-1189) actually names as a control's bound
`column` on THAT panel — a column that is a valid, filterable column on the Output but was never
configured as a control on this panel SHALL NOT be exposed through this route, even though the
authenticated `filter-capabilities`/`distinct-values` routes would report it as eligible.

#### Scenario: A configured control's column is readable publicly
- **WHEN** an anonymous caller requests distinct values for the column bound to one of the panel's
  own configured controls
- **THEN** the distinct values are returned

#### Scenario: A non-control column is rejected even if it is a valid, filterable Output column
- **WHEN** an anonymous caller requests distinct values for a column that exists and is
  eq/in-eligible on the Output, but is NOT the bound column of any control configured on this panel
- **THEN** the request is rejected (not silently narrowed, not served)

#### Scenario: An arbitrary output id is never accepted from the caller
- **WHEN** an anonymous caller's request is resolved
- **THEN** the Output queried is always the one the panel itself is bound to (resolved
  `dashboardId + panelId -> panel.outputId`), never an `outputId` taken directly from the request

### Requirement: A panel's bound Output metadata is available to a public renderer
The system SHALL expose the metadata a renderer needs to pick and configure a panel's
presentation — the bound Output's `kind`, `config`, `schema`, and `ownerId` — to an anonymous or
share-token caller who can already view the panel, resolved server-side from `dashboardId` +
`panelId` (never a caller-supplied `outputId`). This MAY be served as its own route or folded into
an existing public response; either way it SHALL NOT expose more of the Output than
`kind`/`config`/`schema`/`ownerId` (in particular, never the Output's row data — that remains the
`.../rows` route's job).

#### Scenario: A public caller can resolve enough to render a chart panel
- **WHEN** an anonymous viewer's client needs to pick a renderer for a chart-kind output panel on a
  shared dashboard
- **THEN** it can obtain that panel's bound Output's `kind` and chart `config` without
  authenticating, scoped to that panel via the same sharing ACL as `.../rows`

#### Scenario: Output metadata is not exposed for a panel the caller cannot view
- **WHEN** an anonymous caller with no valid share token requests Output metadata for a panel on a
  dashboard that is not public or shared
- **THEN** the request is denied identically to how a rows request for the same panel would be
  denied

### Requirement: Public filter/capability reads use the same ACL as public rows
Every public filter-capabilities, distinct-values, and filtered-rows request SHALL be authorized
by the SAME sharing-aware `authorizeResourceWithSharing("dashboard", ...)` directive, and the same
share-token handling, that `GET /api/dashboards/:dashboardId/panels/:panelId/rows` already uses —
not a second, independently implemented authorization check.

#### Scenario: An unshared dashboard's panel rejects a public filter-capabilities request
- **WHEN** an anonymous caller with no valid share token requests filter-capabilities for a panel
  on a dashboard that is not public or shared
- **THEN** the request is denied identically to how a rows request for the same panel would be
  denied (same status, same non-leaking response shape)
