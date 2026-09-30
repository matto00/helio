## ADDED Requirements

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
