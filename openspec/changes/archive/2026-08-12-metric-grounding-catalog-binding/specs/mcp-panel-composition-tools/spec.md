## ADDED Requirements

### Requirement: Proposal panels accept an optional metricId bound via the existing HEL-500 config path

Proposal panels SHALL accept an optional `metricId` (string) on the `propose_dashboard`/
`apply_proposal` `panelSchema` (`helio-mcp/src/tools/proposal.ts`), the helio-mcp `ProposalPanel` type
(`types.ts`), and the backend `ProposalPanel` protocol (`DashboardProposalProtocol.scala`), additive to
the existing flat fields. `dataTypeId` SHALL remain required for `metric`/`chart`/`table` proposal panels
exactly as today — `metricId` does not relax that requirement. When present and valid,
`ProposalPanelSupport.buildCreateRequest`/`buildDataConfig` SHALL include `metricId` in the created
panel's config, reusing the same `MetricPanelConfig`/`ChartPanelConfig`/`TablePanelConfig` `metricId`
slot HEL-500 already validates and materializes at read time. `schemas/dashboard-proposal.schema.json`
SHALL document the field. The `propose_dashboard` tool's `description` string SHALL document `metricId`
per-type (mirroring the existing `label`/`unit` bullet for `metric`) — the zod schema itself carries no
per-field `.describe()`, so this is the only place a calling agent can discover the capability. A
proposal supplying only the pre-existing flat fields (no `metricId`) SHALL behave byte-for-byte as
before this change.

#### Scenario: Proposal panel with a valid metricId is created bound to that metric

- **WHEN** an agent applies a proposal whose `metric` panel supplies a valid `dataTypeId`,
  `fieldMapping`, and a `metricId` resolving to a metric the caller owns
- **THEN** the created panel's `config.metricId` is set to that id

#### Scenario: Proposal without metricId is unchanged

- **WHEN** an agent applies a proposal whose panels use only the pre-existing flat fields and no
  `metricId`
- **THEN** the created dashboard and panels are identical to the pre-change behavior

#### Scenario: Tool description documents metricId

- **WHEN** an agent inspects the `propose_dashboard` tool's description
- **THEN** it documents that `metric`/`chart`/`table` panels may supply `metricId` to bind to a
  defined metric, alongside the existing per-type field guidance

### Requirement: preValidateBindings rejects an invalid or unsupported metricId before any creation

`ProposalPanelSupport.preValidateBindings` SHALL, for each panel carrying a `metricId`, reject (400,
before any dashboard or panel is created) when the id does not resolve to a metric owned by the
caller, when it resolves to a metric with `deprecated: true`, or when the panel's `type` is outside
`metric`/`chart`/`table` (the exact set HEL-500 added `metricId` support to — `collection`/`timeline`
are not supported). A `metricId` resolving to a caller-owned, non-deprecated metric on a supported
panel type SHALL pass validation. This check SHALL be shared by both `DashboardProposalService.apply`
and `DashboardContentsService.replaceContents`, since both call `preValidateBindings`.

#### Scenario: Nonexistent or foreign metricId rejects the whole apply

- **WHEN** an agent applies a proposal whose panel supplies a `metricId` that does not resolve to any
  metric owned by the caller
- **THEN** the response is 400 and no dashboard or panel is created

#### Scenario: Deprecated metricId rejects the whole apply

- **WHEN** an agent applies a proposal whose panel supplies a `metricId` resolving to a metric with
  `deprecated: true`
- **THEN** the response is 400 and no dashboard or panel is created

#### Scenario: metricId on an unsupported panel type rejects the whole apply

- **WHEN** an agent applies a proposal whose `collection` or `timeline` panel supplies a `metricId`
- **THEN** the response is 400 and no dashboard or panel is created

#### Scenario: DashboardContentsService inherits the same metricId validation

- **WHEN** a caller replaces a dashboard's contents (`PUT /api/dashboards/:id/contents`) with a panel
  set including a panel whose `metricId` does not resolve to a metric they own
- **THEN** the response is 400 and the dashboard's existing contents are unchanged

### Requirement: propose_dashboard warns on a problematic metricId

The `propose_dashboard` tool's read-only validation SHALL fetch the caller's metric catalog
(`api.listMetrics()`) and, for each panel carrying a `metricId`, add a warning when the id is
missing/not found among the caller's owned metrics, resolves to a metric with `deprecated: true`, or
is set on a panel type outside `metric`/`chart`/`table`. `applyReady` SHALL be `false` whenever any
such warning is present, so an agent never sees `applyReady: true` for a proposal that would then be
rejected by `preValidateBindings` at apply time.

#### Scenario: Missing metricId produces a warning

- **WHEN** an agent calls `propose_dashboard` with a panel whose `metricId` does not resolve to any
  metric the caller owns
- **THEN** the response includes a warning naming that panel and `applyReady: false`

#### Scenario: Deprecated metricId produces a warning

- **WHEN** an agent calls `propose_dashboard` with a panel whose `metricId` resolves to a metric with
  `deprecated: true`
- **THEN** the response includes a warning naming that panel and `applyReady: false`

#### Scenario: Valid metricId on a supported panel type produces no warning

- **WHEN** an agent calls `propose_dashboard` with a `metric`/`chart`/`table` panel whose `metricId`
  resolves to a caller-owned, non-deprecated metric
- **THEN** the response includes no metricId-related warning for that panel
