## Backend

- `backend/src/main/scala/com/helio/domain/panels/MetricPanel.scala` — added `aggregation: Option[JsObject]` to `MetricPanelConfig` (tolerant decode, `Patch` absent-vs-null, `applyPatch`, `jsonFormat2` → `jsonFormat3`).
- `backend/src/main/scala/com/helio/domain/panels/ChartPanel.scala` — same wiring for `ChartPanelConfig`.
- `backend/src/main/scala/com/helio/api/protocols/DashboardProposalProtocol.scala` — added `aggregation: Option[JsObject]` to `ProposalPanel` + custom reader/writer, preserving absent-field tolerance.
- `backend/src/main/scala/com/helio/services/DashboardProposalService.scala` — `buildCreateRequest` threads `panel.aggregation` into the created panel's `config` payload.
- `backend/src/test/scala/com/helio/domain/PanelSpec.scala` — decode/patch/applyPatch round-trip coverage for `MetricPanelConfig.aggregation` / `ChartPanelConfig.aggregation` (present/absent/null).
- `backend/src/test/scala/com/helio/api/protocols/DashboardProposalProtocolSpec.scala` (new) — `ProposalPanel` read/write round-trip for the `aggregation` field.
- `backend/src/test/scala/com/helio/api/DashboardApplyProposalSpec.scala` — two new route-level scenarios: aggregation preserved on the created panel; proposal without `aggregation` applies unchanged.

### Cycle 2 — durable persistence fix (evaluation-1.md CR #1, #2)

- `backend/src/main/resources/db/migration/V43__panel_aggregation_column.sql` (new) — adds `panels.aggregation JSONB` (nullable); the durable persistence path cycle 1 omitted entirely.
- `backend/src/main/scala/com/helio/infrastructure/PanelRowMapper.scala` — `metricConfig`/`chartConfig` now read `row.aggregation`; `domainToRow` now writes `mp.config.aggregation`/`cp.config.aggregation` for the metric/chart branches.
- `backend/src/main/scala/com/helio/infrastructure/PanelRepository.scala` — added `aggregation: Option[String]` to `PanelRow`/`PanelTable`, and added the `aggregation` column to `replace`'s persisted-column whitelist — this whitelist was the actual point of data loss (the in-memory patch was already correct; `replace` silently dropped the field on write because it wasn't in the tuple).
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — three new tests exercising the REAL repository round trip: `PATCH /api/panels/:id` (metric set, chart `groupBy` set, metric explicit-null clear) → `GET /api/dashboards/:id/panels` (a fresh `panelRepo.findAllByDashboardId` read, NOT the PATCH response) → assert `config.aggregation` survived.

## Contracts

- `schemas/panel.schema.json` — added `$defs.MetricAggregation` / `$defs.ChartAggregation` and optional `aggregation` on `MetricConfig`/`ChartConfig`.
- `schemas/dashboard-proposal.schema.json` — added optional `aggregation` object on `ProposalPanel`.

## MCP

- `helio-mcp/src/tools/proposal.ts` — added `aggregationSchema` (zod union of metric/chart shapes), referenced optionally from `panelSchema`.
- `helio-mcp/src/types.ts` — added `MetricAggregationSpec`/`ChartAggregationSpec` and optional `aggregation` on `ProposalPanel`.

## Frontend — types and aggregate utility

- `frontend/src/features/panels/types/panel.ts` — added `AggFn`, `MetricAggregation`, `ChartAggregation` types and optional `aggregation` on `MetricPanelConfig`/`ChartPanelConfig`.
- `frontend/src/utils/aggregate.ts` (new) — `computeAggregate`/`groupAndAggregate`, mirroring `AggregateStep.scala` semantics (empty-string vs real-null coercion guard).
- `frontend/src/utils/aggregate.test.ts` (new) — unit tests mirroring `AggregateStepSpec` scenarios plus the empty-string/real-null distinction.
- `frontend/src/features/panels/state/panelNarrowing.ts` — added `getMetricAggregation`/`getChartAggregation` accessors.

## Frontend — rendering

- `frontend/src/features/panels/hooks/usePanelData.ts` — aggregation-aware page size, metric `value` slot override via `computeAggregate`, new `chartAggregate` field on `PanelDataResult` via `groupAndAggregate` over typed rows.
- `frontend/src/features/panels/hooks/usePanelData.test.ts` — new tests for metric aggregation, chart `chartAggregate` grouping (including the null-vs-empty-string case), and the no-aggregation-spec fallback.
- `frontend/src/features/panels/ui/PanelCard.tsx` / `PanelDetailModal.tsx` — thread `chartAggregate` from `usePanelData` into `PanelContent`.
- `frontend/src/features/panels/ui/PanelContent.tsx` / `ui/renderers/ChartRenderer.tsx` — forward `chartAggregate` through to `ChartPanel`.
- `frontend/src/features/panels/ui/ChartPanel.tsx` — new `chartAggregate` prop; `buildAggregateDataOption` renders precomputed categories/values for bar/line when present, falling back to the existing per-row path for pie/scatter or when absent.
- `frontend/src/features/panels/ui/ChartPanel.test.tsx` — new tests for the aggregate rendering path and its pie/scatter/absent fallbacks.

## Frontend — binding editor UI

- `frontend/src/features/panels/ui/editors/BindingEditor.tsx` — added an Aggregation sub-section (metric: field + agg-function; chart: group-by + agg-function + value-field), with an explicit "— None —" clear option; dirty-tracking includes the aggregation spec.
- `frontend/src/features/panels/state/panelPayloads.ts` — `buildBindingPatch` carries `aggregation` (undefined = unchanged, `null` = explicit clear, object = set).
- `frontend/src/features/panels/state/panelThunks.ts` — `updatePanelBinding` thunk carries an optional `aggregation`, always forwarded as the service call's 5th positional arg (cycle 2: simplified the dead 4-arg/5-arg ternary per evaluation-1.md's non-blocking suggestion — an explicit `undefined` 5th arg is wire-equivalent to omitting it, since `buildBindingPatch` only checks `!== undefined`).
- `frontend/src/features/panels/services/panelService.ts` — `updatePanelBinding` accepts the optional `aggregation` param.
- `frontend/src/test/panelFixtures.ts` — `makeMetricPanel`/`makeChartPanel` thread `config.aggregation` through.
- `frontend/src/features/panels/ui/PanelDetailModal.aggregation.test.tsx` (new/modified) — BindingEditor aggregation-controls coverage (render for metric/chart, save sets/omits/clears `config.aggregation`); cycle 2 updated the "omits aggregation" assertion from an exact 4-arg-length check to asserting the 5th arg is `undefined`, matching the simplified thunk call shape.
- `frontend/src/features/panels/ui/PanelDetailModal.test.tsx` — cycle 2: updated two pre-existing mock-call assertions to include the explicit `undefined` 5th arg now always passed by the simplified thunk.
- `frontend/src/features/panels/hooks/usePanelData.test.ts` — cycle 2 addition (evaluation-1.md non-blocking suggestion): a metric aggregation test with 15 rows, exceeding the pre-existing metric default page size (10), proving the `pageSize = Number.MAX_SAFE_INTEGER` override actually takes effect (prior fixtures were all ≤3 rows).

### Cycle 3 — dirty-tracking + fieldMapping-less aggregation fixes (evaluation-2.md CR #1, #2)

- `frontend/src/features/panels/ui/editors/BindingEditor.tsx` — `aggregationDirty` now compares `aggField`/`aggFn`/`aggYField` against their `initial*` primitive counterparts directly (mirroring `selectedTypeId`/`refreshInterval`) instead of `JSON.stringify`-ing `currentAggregation` against a raw `initialAggregation` object read off `panel.config.aggregation`; Postgres JSONB does not preserve object key insertion order, so that comparison was always true for any panel with a saved aggregation spec regardless of user interaction. Removed the now-unused `initialAggregation` variable.
- `frontend/src/features/panels/ui/PanelDetailModal.aggregation.test.tsx` — two new regression tests (metric and chart) seeding `config.aggregation` with a key order matching real `psql`-confirmed Postgres output (`{"agg": ..., "value"/"groupBy": ...}`, opposite of the component's own construction order), asserting the "Unsaved changes" badge does not appear on mount.
- `frontend/src/features/panels/hooks/usePanelData.ts` — the `data` memo's early-return guard no longer bails to `null` when `fieldMapping` is empty but a `metricAggregation` spec is set (`!fieldMappingKey && !metricAggregation`, was `!fieldMappingKey` alone); builds `mapped` from an empty object when `fieldMappingKey` is absent, per design.md Decision 3 ("aggregation is independent of fieldMapping").
- `frontend/src/features/panels/hooks/usePanelData.test.ts` — new regression test: `fieldMapping = {}` with a `metricAggregation` spec set asserts `data.value` reflects the computed aggregate instead of `data` being `null`.
