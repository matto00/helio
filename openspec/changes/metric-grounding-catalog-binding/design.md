## Context

HEL-493/HEL-541 shipped `MetricDefinition` (`backend/.../domain/model.scala:802-846`, fields
`id`/`ownerId`/`dataTypeId`/`name`/`description`/`measureField`/`aggregation`/`allowedDimensions`/
`format`/`deprecated`), `GET /api/metrics`, and helio-mcp's `list_metrics`/`get_metric`/`api.listMetrics()`
(`helio-mcp/src/helioApi.ts:286-293`). HEL-500 shipped `metricId: Option[MetricId]` on
`MetricPanelConfig`/`ChartPanelConfig`/`TablePanelConfig` only (not `CollectionPanelConfig`/
`TimelinePanelConfig`), with create/update-time validation in `PanelService.rejectUnresolvableMetric`
(owned + resolves-to-pipeline-output-DataType — does **not** check `deprecated`).

`helio-mcp/src/context.ts`'s `buildWorkspaceContext` has no `metrics` field. `proposal.ts`'s
`panelSchema` / `types.ts`'s `ProposalPanel` / the backend `ProposalPanel` protocol
(`DashboardProposalProtocol.scala:15-42`) have no `metricId`. `ProposalPanelSupport`
(`services/ProposalPanelSupport.scala`) — shared by `DashboardProposalService.apply` and
`DashboardContentsService.replaceContents` — validates and threads only `dataTypeId`.

## Goals / Non-Goals

**Goals:**
- Surface the caller's metric catalog in `get_workspace_context`.
- Let a proposal panel specify `metricId`, validated up front (nothing created on a bad id), threaded
  into the created panel's config via the existing HEL-500 slot.

**Non-Goals:**
- The backend `GET /api/workspace/context` endpoint (`workspace-context-assembly`) — ticket text scopes
  grounding to `helio-mcp/src/context.ts` only. A future ticket would extend that Scala assembler +
  `schemas/workspace-context.schema.json` for parity.
- `CollectionPanelConfig`/`TimelinePanelConfig` `metricId` support — 418-C never added it; a proposal
  panel of those types with `metricId` is rejected (see D4), not silently accepted.
- Relaxing `metricId`-implies-no-`dataTypeId`: `dataTypeId` stays required for `metric`/`chart`/`table`
  proposal panels exactly as today (`ProposalPanelSupport.validatePanel` unchanged); `metricId` is
  purely additive. An agent already has `dataTypeId` in the metric catalog entry, so this costs it
  nothing and avoids restructuring `buildDataConfig`'s dataTypeId-gated branch.
- Changing `PanelService.rejectUnresolvableMetric` (direct `POST /api/panels`) to also check
  `deprecated` — see D3.

## Decisions

**D1 — `metrics` catalog field names use `dataTypeId`, not the ticket's `boundDataTypeId`.**
`MetricDefinition.dataTypeId` / `MetricResponse.dataTypeId` is the real field name (confirmed in
`MetricProtocol.scala`, `MetricRoutesSpec.scala`); the ticket's scope text used an informal name.
Catalog entry: `{ id, name, dataTypeId, measureField, aggregation, allowedDimensions, format,
deprecated }`, fetched via the existing `api.listMetrics()` added to `buildWorkspaceContext`'s
`Promise.all` (same fan-out `pipelineShapes` already uses, `context.ts:980-987`). Not tracked in
`paginationTruncatedResources` or `applyBudget`'s trim tiers — mirrors `dataSources`/`pipelines`/
`dashboards`, which also aren't trimmed; metric catalogs are small, flat records.

**D2 — Follow the `pipelineShapes` precedent for the spec delta.** `mcp-pipeline-shape-tools` already
has a "get_workspace_context advertises the shape catalog" requirement for its own catalog addition;
`mcp-metric-tools` gets the analogous requirement rather than inventing a new capability or overloading
`workspace-context-assembly` (which is the *backend* endpoint's capability, out of scope per Non-Goals).

**D3 — `preValidateBindings` REJECTS a deprecated `metricId`; `propose_dashboard` only WARNS.**
The ticket says "warn/reject a deprecated ... metric" for both call sites. Read: `propose_dashboard` is
advisory (returns `warnings`, `applyReady`) — deprecated is a warning there, same tier as
missing/not-owned. `DashboardProposalService.apply`/`DashboardContentsService.replaceContents` actually
mutate — a hard reject there stops an agent from binding new work to metric debt, at the cost of being
stricter than direct `POST /api/panels` (which never checks `deprecated`, unchanged). This gap between
proposal-apply and direct-panel-create is real; flagging it, not fixing `PanelService` here (Non-Goals).

**D4 — `metricId` support is fenced to `metric`/`chart`/`table`, matching 418-C exactly.** New
`DashboardProposalService.MetricIdSupportedKinds = Set("metric", "chart", "table")` (package-private,
beside `DataPanelKinds`/`MetricKind`/`TimelineKind`, same file `check-schema-drift.mjs` convention).
`preValidateBindings` rejects (400, before any create) a `metricId` on any other panel type.
`propose_dashboard`'s read-only check mirrors this as a warning (`applyReady: false`) — an agent should
never see `applyReady: true` for a proposal that would then 400 at apply time.

**D5 — `metricRepo` threads through exactly like `PanelService`'s existing convention.**
`ApiRoutes.scala:141` already passes a possibly-null `metricRepo: MetricRepository` into
`PanelService`'s constructor ("touched only when a panel actually carries a `metricId`"; test fixtures
that never set one never exercise it). `preValidateBindings` gets a new `metricRepo: MetricRepository`
param; `DashboardProposalService` and `DashboardContentsService` each gain a `metricRepo` constructor
param, wired from `ApiRoutes.scala:142`/`145` the same way `panelService` already is at line 141.

**D6 — `buildDataConfig` splices `metricId` in unconditionally when present.** By the time
`buildCreateRequest`/`buildDataConfig` runs, `preValidateBindings` (D4) has already rejected any
`metricId` on an unsupported type, so `buildDataConfig` just adds
`++ panel.metricId.map("metricId" -> JsString(_))` to `baseFields` — no per-type branching needed there.

**D7 — Backend `ProposalPanel` wire format.** `metricId: Option[String]` added to the case class and
the hand-written `RootJsonFormat` (`DashboardProposalProtocol.scala`) — one `foreach`/`.get` line each
in `write`/`read`, matching the existing `dataTypeId` treatment exactly (absent-on-wire when `None`).

## Risks / Trade-offs

- [Two round-trips per panel in `preValidateBindings` (dataType then metric)] → acceptable; proposal
  panel counts are small (dashboard-sized, not bulk), and both checks were already sequential reads.
- [`context.test.ts`'s `makeFakeApi()` fixture has no `listMetrics` stub] → will throw at runtime once
  `buildWorkspaceContext` calls it; add the stub as part of this change, not a follow-up.
- [No `helio-mcp/src/tools/proposal.test.ts` exists today] → this change adds the file's first coverage
  (metricId warn/applyReady paths), rather than deferring proposal-tool testing further.

## Planner Notes

Self-approved: D1 (field-name correction — the real field, not a new decision), D3/D4 (both narrow the
ticket's literal "warn/reject" language into concrete, consistent behavior; both documented above rather
than left implicit), D5/D6/D7 (mechanical, following two already-established codebase conventions
verbatim — `PanelService`'s nullable-repo pattern and `ProposalPanel`'s hand-written format). None of
these are new external dependencies, breaking changes, or scope beyond the ticket's own text.
