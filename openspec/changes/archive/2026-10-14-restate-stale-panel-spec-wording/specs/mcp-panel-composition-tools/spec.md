## REMOVED Requirements

### Requirement: create-panel-request schema agrees with the MCP type set
**Reason**: `collection` is not a panel kind: the `schemas/panels/create-panel-request.schema.json` `type` enum is `text/markdown/image/divider/output/form`, and the `create_panel` tool the scenario calls was removed (HEL-907). Collection is now an Output kind rendered inside an `output` panel.
**Migration**: None. Panel-kind enum coverage across the published schemas is enforced by `npm run check:schemas` (`schema-drift-panel-kind-coverage`).

### Requirement: Proposal panels derive a timeline binding from flat fields
**Reason**: The `timeline` panel kind was deleted (HEL-904) and the proposal `type` enum no longer offers it. The flat `sort` field remains on the proposal wire as a legacy field: a value outside `asc`/`desc` is rejected at runtime by the helio-mcp `panelSchema` zod enum (and is outside the `dashboard-proposal.schema.json` contract enum), while the backend decodes any string and never applies it; no `config.timelineOptions.sort` is derived from it.
**Migration**: None for proposals. A timeline is authored as a `timeline`-kind Output and placed with an `output` panel.

### Requirement: Proposal panels accept an optional metricId bound via the existing HEL-500 config path
**Reason**: Metrics were retired (`/api/metrics` returns 404) and the `metric`/`chart`/`table` panel kinds that carried `metricId` were deleted (HEL-903/904). `metricId` is not a field of the proposal wire in the backend protocol, the helio-mcp `panelSchema`, or `dashboard-proposal.schema.json`.
**Migration**: None.

### Requirement: preValidateBindings rejects an invalid or unsupported metricId before any creation
**Reason**: `ProposalPanelSupport.preValidateBindings` has no `metricId` check; the supporting kind set was deleted with the metric layer (`DashboardProposalService.scala`: "`MetricKind`/`TimelineKind`/`MetricIdSupportedKinds` ... were deleted outright").
**Migration**: None.

### Requirement: propose_dashboard warns on a problematic metricId
**Reason**: `propose_dashboard` no longer fetches a metric catalog or warns on `metricId`; the field and the metric layer were removed.
**Migration**: None.
