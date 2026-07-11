# Files modified — HEL-293

## Schemas / contracts

- `schemas/dashboard-proposal.schema.json` — `ProposalPanel` gains `content`, `url`, `orientation`,
  `chartType`, `xAxisLabel`, `yAxisLabel`, `seriesColors`, `label`, `unit` (all optional); descriptions
  cross-reference `fieldMapping.label`/`fieldMapping.unit`.
- `schemas/panel.schema.json` — `MetricConfig` gains optional `label`/`unit`.

## Backend

- `backend/src/main/scala/com/helio/api/protocols/DashboardProposalProtocol.scala` — `ProposalPanel`
  case class + custom tolerant reader/writer extended with the nine new fields.
- `backend/src/main/scala/com/helio/domain/panels/MetricPanel.scala` — `MetricPanelConfig` gains
  `label`/`unit` (jsonFormat3 → jsonFormat5); `decode`/`decodeCreate`/`Patch`/`Patch.decode`/`applyPatch`
  extended with absent-vs-null semantics.
- `backend/src/main/resources/db/migration/V44__panel_metric_literal_columns.sql` — new nullable
  `metric_label`/`metric_unit` TEXT columns on `panels`.
- `backend/src/main/scala/com/helio/infrastructure/PanelRepository.scala` — `PanelRow`/`PanelTable` gain
  `metricLabel`/`metricUnit`; `replace`'s explicit column tuple extended to include them (the HEL-292
  whitelist gotcha, applied proactively here).
- `backend/src/main/scala/com/helio/infrastructure/PanelRowMapper.scala` — `domainToRow`/`metricConfig`
  read/write the two new columns for the metric branch only.
- `backend/src/main/scala/com/helio/api/RequestValidation.scala` — new `validateChartType` allow-list
  (`bar|line|pie|scatter`), mirroring `validateImageFit`/`validateDividerOrientation`.
- `backend/src/main/scala/com/helio/domain/model.scala` — new `ChartAppearance.Default` constant
  mirroring the frontend's `DEFAULT_CHART_APPEARANCE`.
- `backend/src/main/scala/com/helio/services/DashboardProposalService.scala` — `validateStructure`
  extended with a `validatePanel` helper that also validates `chartType`/`orientation` before any
  creation (Decision 6); `buildCreateRequest` split into `buildDataConfig` (adds metric `label`/`unit`)
  and `buildNonDataConfig` (builds `content`/`imageUrl`+`imageFit`/`orientation` for text/markdown/
  image/divider panels); new `applyAppearance` best-effort follow-up (mirrors `applyLayout`), wired into
  `createAll`.

## Backend tests

- `backend/src/test/scala/com/helio/api/protocols/DashboardProposalProtocolSpec.scala` — round-trip
  coverage for the nine new `ProposalPanel` fields.
- `backend/src/test/scala/com/helio/api/DashboardApplyProposalSpec.scala` — route-level coverage:
  markdown content / image url / divider orientation applied at create; chart appearance applied as a
  follow-up PATCH; metric literal label/unit threaded into config; invalid `chartType`/`orientation`
  400s and creates nothing.
- `backend/src/test/scala/com/helio/domain/PanelSpec.scala` — `MetricPanelConfig.label/unit`
  decode/Patch.decode/applyPatch absent-vs-null coverage.
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — `metricLabel`/`metricUnit`
  PATCH-then-reload persistence + explicit-null-clear, via a fresh repository read (guards the
  Decision-5 whitelist gotcha).

## Frontend

- `frontend/src/features/dashboards/types/proposal.ts` — `ProposalPanel` gains the same new optional
  fields as the schema.
- `frontend/src/features/panels/types/panel.ts` — `MetricPanelConfig` gains optional `label`/`unit`.
- `frontend/src/features/panels/state/panelNarrowing.ts` — new `getMetricLiteral(panel)` narrowing
  helper (mirrors `getMetricAggregation`).
- `frontend/src/features/panels/hooks/usePanelData.ts` — `data` memo overrides `mapped.label`/
  `mapped.unit` with the literal value when present (Decision 4), outside the early-return guard.

## Frontend tests / fixtures

- `frontend/src/features/panels/hooks/usePanelData.test.ts` — literal label/unit precedence over
  fieldMapping, and fallback-to-fieldMapping when absent.
- `frontend/src/test/panelFixtures.ts` — `makeMetricPanel` threads `label`/`unit` overrides through.

## MCP

- `helio-mcp/src/tools/proposal.ts` — `panelSchema` (zod) gains the nine new optional fields.
- `helio-mcp/src/types.ts` — `ProposalPanel` gains the nine new optional fields.

## Spinoff candidates (not fixed in this change — out of scope / pre-existing)

- `frontend/src/features/dashboards/types/proposal.ts`'s `ProposalPanel` was already missing the
  HEL-292 `aggregation` field (backend/schema have carried it since HEL-292); left as-is since it's a
  pre-existing gap unrelated to this ticket's task list.
- `PanelMutationOps.batchUpdate` (`backend/src/main/scala/com/helio/infrastructure/
  PanelMutationRepository.scala`)'s config-patch column tuple already omits `aggregation` (a narrower
  version of the same whitelist gotcha `PanelRepository.replace` had) — pre-existing, not touched by
  this ticket's tasks.md (which scopes Decision 5 to `replace` only).
