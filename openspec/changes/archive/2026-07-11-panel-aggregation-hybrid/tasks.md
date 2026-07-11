## 1. Backend — config wiring

- [x] 1.1 Add `aggregation: Option[JsObject]` to `MetricPanelConfig` (backend/src/main/scala/com/helio/domain/panels/MetricPanel.scala): tolerant `decode`, `Empty`, `Patch` (absent-vs-null), `applyPatch`, bump `format` from `jsonFormat2` to `jsonFormat3`.
- [x] 1.2 Add `aggregation: Option[JsObject]` to `ChartPanelConfig` (backend/src/main/scala/com/helio/domain/panels/ChartPanel.scala) with the same tolerant decode/patch shape, bump `format` from `jsonFormat2` to `jsonFormat3`.
- [x] 1.3 Confirm `PanelConfigCodec` needs no change beyond what each subtype's format/decode provides (read-through check, no code change expected).
- [x] 1.4 **(cycle-2 addition — evaluation-1.md CR #1, #3)** Add a new Flyway migration (`backend/src/main/resources/db/migration/V43__panel_aggregation_column.sql`) adding `panels.aggregation JSONB` (nullable), matching the existing `field_mapping` column pattern (`V5`/`V33`). This is the durable persistence path the original plan omitted — the in-memory `decode`/`applyPatch` wiring in 1.1/1.2 is necessary but not sufficient; without a column, `PanelRepository.replace` has nowhere to write the value.
- [x] 1.5 **(cycle-2 addition)** Wire the new column through `PanelRowMapper.scala`: `metricConfig`/`chartConfig` read `row.aggregation` into `Option[JsObject]`; `domainToRow` writes `mp.config.aggregation`/`cp.config.aggregation` for the metric/chart branches.
- [x] 1.6 **(cycle-2 addition)** Add `aggregation: Option[String]` to `PanelRepository.PanelRow`/`PanelTable`, and add `r.aggregation` to `PanelRepository.replace`'s persisted-column whitelist (`PanelRepository.scala`) — this whitelist was the actual point of data loss in cycle 1 (the domain-level patch was correct; `replace` silently dropped the field on write because it wasn't in the tuple).

## 2. Contracts

- [x] 2.1 Add optional `aggregation` object to `schemas/panel.schema.json` for metric/chart panel configs (shape: metric `{value, agg}`, chart `{groupBy, agg, yField}`; `agg` enum `count|sum|avg|min|max`).
- [x] 2.2 Add optional `aggregation` object (same shape) to `ProposalPanel` in `schemas/dashboard-proposal.schema.json`.
- [x] 2.3 Add `aggregation: Option[JsObject]` to `ProposalPanel` case class + custom reader/writer in `backend/src/main/scala/com/helio/api/protocols/DashboardProposalProtocol.scala`, preserving its absent-field tolerance.

## 3. MCP

- [x] 3.1 Add an `aggregationSchema` (zod) to `helio-mcp/src/tools/proposal.ts` and reference it optionally from `panelSchema` for metric/chart types.
- [x] 3.2 Add `aggregation?: {...}` to `ProposalPanel` in `helio-mcp/src/types.ts` matching the schema.

## 4. Frontend — types and aggregate utility

- [x] 4.1 Add `MetricAggregation`/`ChartAggregation` types and optional `aggregation` field on `MetricPanelConfig`/`ChartPanelConfig` in `frontend/src/features/panels/types/panel.ts`.
- [x] 4.2 Create `frontend/src/utils/aggregate.ts` with `computeAggregate(rows, field, fn)` matching `AggregateStep` semantics: string coercion MUST guard `s.trim() !== "" && Number.isFinite(Number(s))` (not a bare `Number(s)`/`parseFloat` check) so an empty-string cell (the `usePanelData`/`rawRows` null sentinel) is excluded, not coerced to `0`; `sum` = 0 on zero coercible values, `avg`/`min`/`max` = null on zero coercible values.
- [x] 4.3 Add `groupAndAggregate(rows, groupBy, agg, yField)` to the same util for the chart grouped case (returns sorted category/value pairs), reusing `computeAggregate`'s coercion guard per group rather than a parallel numeric check.

## 5. Frontend — rendering

- [x] 5.1 In `usePanelData.ts`, when the bound panel's config has an `aggregation` spec, request a page size covering the full row set instead of the metric/chart default.
- [x] 5.2 In `usePanelData.ts`, when a metric panel has `config.aggregation` set, compute the `value` slot via `computeAggregate` over all rows (the typed `rows`, not `rawRows`) instead of `rows[0]`; leave `label`/`unit`/`trend` unchanged.
- [x] 5.3 In `usePanelData.ts`, when a chart panel has `config.aggregation` set, compute a new `chartAggregate: { categories: string[]; values: number[] } | null` field via `groupAndAggregate` over the typed `rows` (NOT `rawRows` — real `null`/`undefined` must survive so `count` can distinguish null from empty string per design.md Decision 4); add `chartAggregate` to `PanelDataResult`.
- [x] 5.4 Thread `chartAggregate` from `usePanelData` through `PanelContent`/`ChartRenderer` into `ChartPanel` as a new optional prop — update BOTH `usePanelData` call sites (`PanelCard.tsx` and `PanelDetailModal.tsx`) to forward the new field; a missed call site fails silently (chart falls back to the unchanged per-row path) rather than erroring, so don't rely on tests alone to catch a missed site.
- [x] 5.5 In `ChartPanel.tsx`'s `buildDataOption`, when `chartType` is `bar`/`line` and `chartAggregate` is present, render its precomputed `categories`/`values` directly instead of grouping `rawRows`; pie/scatter or an absent `chartAggregate` fall back to the existing per-row path unchanged. `ChartPanel` MUST NOT re-derive grouping/aggregation from `rawRows` itself.

## 6. Frontend — binding editor UI

- [x] 6.1 Add aggregation controls to `BindingEditor.tsx`: metric gets a field + agg-function selector; chart gets group-by, agg-function, and value-field selectors.
- [x] 6.2 Extend `buildBindingPatch` (panelPayloads.ts) and `updatePanelBinding` (panelThunks.ts / panelService.ts) to carry the `aggregation` object (including explicit-clear-to-null) through to the PATCH request.

## 7. Tests

- [x] 7.1 Unit tests for `aggregate.ts` mirroring `AggregateStep` scenarios (null-skip, all-null → null, count of non-null, mixed string/number fields, sum = 0 on zero coercible values) plus an explicit case for a real JS `null`/`undefined` value (typed-row shape, as `computeAggregate`/`groupAndAggregate` actually receive it) proving `count` excludes it and `sum`/`avg`/`min`/`max` exclude it without coercing to `0`.
- [x] 7.2 `usePanelData.test.ts`: metric aggregation renders the aggregate over all fetched rows; chart `chartAggregate` groups typed rows correctly including a `count` aggregation on a group containing a real-`null` `yField` row (proving the null-vs-empty-string distinction survives — this is the case round-2 design review flagged); no-aggregation path leaves `chartAggregate` null/absent.
- [x] 7.3 `ChartPanel.test.tsx`: bar/line rendering of a precomputed `chartAggregate` prop; pie/scatter or absent `chartAggregate` fall back to the existing per-row `rawRows` path unchanged.
- [x] 7.4 `BindingEditor` tests: aggregation controls render for metric/chart, save includes/clears `config.aggregation`.
- [x] 7.5 Backend tests: `MetricPanelConfig`/`ChartPanelConfig` decode/patch round-trip with `aggregation` present/absent/null; `apply_proposal`/`propose_dashboard` preserve `aggregation` end-to-end.
- [x] 7.6 **(cycle-2 addition — evaluation-1.md CR #2)** Backend tests through the REAL repository round trip, one per panel type: `PATCH /api/panels/:id` with an `aggregation` spec → `GET /api/dashboards/:id/panels` (a fresh `panelRepo.findAllByDashboardId` read, NOT the PATCH response) → assert `config.aggregation` survived. Added to `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala`: metric set, chart `groupBy` set, and metric explicit-null clear.

## 8. Cycle-3 fixes (evaluation-2.md)

- [x] 8.1 Fix `BindingEditor.tsx`'s aggregation dirty check: compare `aggField`/`aggFn`/`aggYField` against their `initial*` primitive counterparts directly instead of `JSON.stringify`-ing reconstructed objects against the raw (Postgres-JSONB-reordered) `panel.config.aggregation`. Add a regression test seeding `config.aggregation` with a key order different from the component's own literal construction order (metric and chart), asserting the "Unsaved changes" badge does not appear on mount.
- [x] 8.2 Fix `usePanelData.ts`'s `data` memo early-return guard so a `metricAggregation` spec is reachable even when `fieldMapping` is empty (`fieldMappingKey === null`), per design.md Decision 3 ("aggregation is independent of fieldMapping"). Add a `usePanelData.test.ts` case with `fieldMapping = {}` and a `metricAggregation` spec set, asserting `data.value` reflects the aggregate.
- [x] 8.3 Re-verify both fixes live (reload + reopen editor) for a metric panel with aggregation-only config and no field mapping, and for a panel with a saved aggregation spec (no spurious dirty badge).
