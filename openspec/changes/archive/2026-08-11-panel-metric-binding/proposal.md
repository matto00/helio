## Why

Today `MetricPanelConfig`/`ChartPanelConfig`/`TablePanelConfig` each re-specify their own
`dataTypeId` + `fieldMapping` + `aggregation` trio. HEL-446 (418-A) landed a stored `MetricDefinition`
(named measure + aggregation + allowed dimensions + format) but nothing consumes it yet. This ticket
lets bound panels reference a `metricId` so an agent (or a human) composes a previously-defined metric
instead of re-inventing the binding on every panel.

## What Changes

- Add an optional `metricId: Option[MetricId]` to `MetricPanelConfig`/`ChartPanelConfig`/
  `TablePanelConfig` (decode/decodeCreate/Patch, canonical `RootJsonFormat`, absent-vs-null preserved).
- `PanelService.create`/`update` validate a supplied `metricId` resolves to a caller-owned metric whose
  `dataTypeId` still satisfies the V41 pipeline-output rule; reject (400) otherwise. (A metric's
  `deprecated` flag is not checked here — out of scope per the ticket's literal AC, which names only
  ownership + V41; `MetricDefinition.deprecated` has no consumer anywhere yet.)
- Panel read paths (`findById`, `resolveBindingsForRead`/`resolveSingleBinding`) resolve `metricId` →
  `MetricDefinition` for the caller: a metric owned by another user, or no longer present, clears
  `metricId` on the returned panel (mirrors `withBindingCleared`) rather than 500ing.
- **`MetricPanel` only**: when `metricId` resolves and the panel's own `dataTypeId`/`fieldMapping`/
  `aggregation`/`unit` are unset, the read-path response materializes effective values derived from the
  `MetricDefinition` (dataTypeId, a `{value: measureField}` field mapping, a
  `{value: measureField, agg: aggregation}` aggregation spec, and `unit` from its format) — a present raw
  field always overrides its metric-derived counterpart (`metricId` is the authoritative default; raw
  fields are optional overrides). `ChartPanel`/`TablePanel` persist, validate, and cross-user-clear
  `metricId` identically but do not auto-materialize effective query fields this ticket (see design.md
  Decision 4) — their groupBy/axis-keyed field mappings aren't derivable from a single measure field.
- Flyway migration: nullable `panels.metric_id` column, FK to `metrics(id) ON DELETE SET NULL` (deleting
  a metric unbinds panels rather than deleting them — this also satisfies the "deleted metric reads back
  unbound" AC with no extra service-layer code).
- `schemas/panel.schema.json`'s `MetricConfig`/`ChartConfig`/`TableConfig` `$defs` gain `metricId`
  (`create-panel-request.schema.json` needs no direct edit — it only `$ref`s these defs).
- **Post-final-gate addition (fold-in, coordinator-triaged):** the final-gate skeptic verified the
  `GET /api/panels/:id/query` route's single-panel materialization path (`resolveSingleBinding`) live and
  found it correct, but noted it had zero automated test coverage (the evaluator's own live check only
  exercised the batch `resolveBindingsForRead` path via `GET /dashboards/:id/panels`). Folded in as a
  small, same-file addition to `PanelMetricBindingRoutesSpec` — no new design decision, no behavior
  change, closes a real regression-coverage gap in a path this ticket already added.

## Capabilities

### New Capabilities

(none — this extends the existing bound-panel-composition / metric-definition-persistence capabilities)

### Modified Capabilities

- `panel-datatype-binding`: bound panels (metric/chart/table) may additionally bind to a stored
  `MetricDefinition` via `metricId`, alongside the existing raw `dataTypeId`/`fieldMapping`/`aggregation`
  trio (additive requirements only — nothing existing changes shape).
- `metric-definition-persistence`: `MetricRepository` gains a `findByIdsOwned` batch lookup (mirrors
  `DataTypeRepository`'s), needed by the panel read path's cross-user clearing (additive).

## Impact

- Backend: `backend/src/main/scala/com/helio/domain/panels/{MetricPanel,ChartPanel,TablePanel}.scala`,
  `PanelService.scala`, `PanelServiceHelpers.scala`, `PanelRepository.scala`, `PanelRowMapper.scala`,
  `MetricRepository.scala` (new `findByIdsOwned` batch lookup, mirroring `DataTypeRepository`'s).
- DB: new Flyway migration adding `panels.metric_id`.
- Wire: `schemas/panel.schema.json` (`MetricConfig`/`ChartConfig`/`TableConfig`).
- No frontend changes required (out of scope — 418-F); a `MetricPanel`'s read-response already carries
  effective `fieldMapping`/`aggregation` in the exact shapes the existing `panel-viz-aggregation`
  frontend renderer already reads.

## Non-goals

- Authoring UI for picking a metric in the panel editor (418-F).
- Exposing metrics/`metricId` through proposals + workspace-context (418-E).
- Materializing `decimals`/`prefix`/`suffix` from `MetricFormat` onto panel config (no wire slot exists
  today; only `unit` is materialized for `MetricPanel`, reusing its existing field) — flagged as a
  natural, small follow-up.
- Auto-deriving `ChartPanel`/`TablePanel` effective field mappings from a metric (see design.md
  Decision 4).
