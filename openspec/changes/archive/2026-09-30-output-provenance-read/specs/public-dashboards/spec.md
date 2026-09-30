## MODIFIED Requirements

### Requirement: A panel's bound Output metadata is available to a public renderer
The system SHALL expose the metadata a renderer needs to pick and configure a panel's
presentation — the bound Output's `kind`, `config` and `schema` — to an anonymous or
share-token caller who can already view the panel, resolved server-side from `dashboardId` +
`panelId` (never a caller-supplied `outputId`). This MAY be served as its own route or folded into
an existing public response; either way it SHALL NOT expose more of the Output than
`kind`/`config`/`schema` (in particular, never the Output's row data, and never `ownerId`).
The public panel list SHALL omit each panel's `ownerId` when the caller is anonymous.

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

#### Scenario: ownerId is not sent to anonymous callers
- **WHEN** an anonymous caller fetches output-meta or the panel list of a shared dashboard
- **THEN** no `ownerId` key appears anywhere in either response
