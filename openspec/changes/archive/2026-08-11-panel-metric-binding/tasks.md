## 1. Persistence

- [x] 1.1 Verify the next free Flyway `VNN` against current `main` (do not assume `V76`); add
      `V{NN}__panel_metric_id.sql`: nullable `panels.metric_id TEXT REFERENCES metrics(id) ON DELETE
      SET NULL`, with an index on `metric_id` (mirrors `idx_metrics_data_type_id`'s reasoning — an
      unindexed FK column forces a full scan on every metric delete).
- [x] 1.2 `PanelRepository.PanelRow`/`PanelTable`: add `metricId: Option[String]` / `def metricId =
      column[Option[String]]("metric_id")`; extend the HList `*` projection.
- [x] 1.3 `PanelRepository.configColumnsOf`/`configColumnValuesOf`: add the `metricId` column/value to
      both tuples (both grow from 19- to 20-arity; still under the 22-tuple ceiling).

## 2. Domain — bound-trio configs

- [x] 2.1 `domain/panels/package.scala`: add `implicit val metricIdFormat: JsonFormat[MetricId]`
      mirroring `dataTypeIdFormat`.
- [x] 2.2 `MetricPanelConfig`/`ChartPanelConfig`/`TablePanelConfig`: add `metricId: Option[MetricId] =
      None`; bump each `jsonFormat` arity; add `metricId` handling to `decode`/`decodeCreate` (string →
      `Some(MetricId(s))`, else `None`) and to `Patch`/`Patch.decode`/`Patch.isEmpty` (absent-vs-null,
      matching the existing `dataTypeId` field's pattern exactly).
- [x] 2.3 `applyPatch` on `MetricPanel`/`ChartPanel`/`TablePanel`: fold the `metricId` patch into the
      rebuilt config, matching the existing field-fold pattern.

## 3. Row mapping

- [x] 3.1 `PanelRowMapper.domainToRow`: write `metricId` for Metric/Chart/Table branches
      (`mp.config.metricId.map(_.value)`, etc.).
- [x] 3.2 `PanelRowMapper.metricConfig`/`chartConfig`/`tableConfig`: read `row.metricId` back into
      `MetricId` (`row.metricId.map(MetricId(_))`), mirroring the existing `row.typeId` pattern.

## 4. Service — validation

- [x] 4.1 `PanelServiceHelpers`: add `metricIdFromCreateConfig(config: PanelConfigCodec.CreateConfig):
      Option[MetricId]` and `metricIdFromConfigPatch(json: JsValue): Option[MetricId]`, mirroring
      `dataTypeIdFromCreateConfig`/`dataTypeIdFromConfigPatch` for the bound-trio kinds only.
- [x] 4.2 `PanelService`: add `rejectUnresolvableMetric(metricIdOpt, user)` (400 `BadRequest`) —
      resolves `metricRepo.findByIdOwned`, then re-validates the metric's `dataTypeId` against V41 via
      `dataTypeRepo.findByIdOwned` (reject if absent or `sourceId.isDefined`), mirroring
      `rejectCompanionBinding`'s shape.
- [x] 4.3 Wire `rejectUnresolvableMetric` into `buildForCreate` (alongside the existing
      `rejectCompanionBinding` call) and into `update` (alongside its existing call). Add
      `metricRepo: MetricRepository` to `PanelService`'s constructor (it already has `dataTypeRepo`).
      This touches every `new PanelService(...)` call site — expect ~10 (`ApiRoutes.scala` plus test
      specs including `BoundPanelRoutesSpec`, `PanelServiceResolveBindingsSpec`,
      `PanelServiceScatterAggregationSpec`, `PanelServiceCompanionBindingGuardSpec`,
      `PanelServiceBuildAllForCreateSpec`, `PanelServiceBatchUpdateErrorSpec`) — mechanical, but budget
      for it; the compiler will find every one.

## 5. Service — read-path resolution

- [x] 5.1 `MetricRepository`: add `findByIdsOwned(ids: Seq[MetricId], user: AuthenticatedUser):
      Future[Map[MetricId, MetricDefinition]]`, mirroring `DataTypeRepository.findByIdsOwned` exactly
      (empty-input short-circuit, `ids inSet` + owner filter).
- [x] 5.2 `PanelService.resolveBindingsForRead`: gather every bound-trio panel's `metricId` alongside
      the existing `dataTypeId` gather; batch-resolve via `metricRepo.findByIdsOwned`; clear `metricId`
      (independently of `dataTypeId`) for any panel whose `metricId` doesn't resolve.
- [x] 5.3 `PanelService.resolveSingleBinding`: same clearing, single-panel path (used by `update`'s
      post-patch resolve and the `/query` route's `findById`-then-`buildQuery` flow — route
      `panelService.findById` calls through `resolveSingleBinding`/an equivalent so `/query` sees
      resolved bindings too; confirm and wire this call site explicitly since `findById` today calls
      `panelRepo.findById` directly with no resolution step).
- [x] 5.4 Add materialization (Decision D4): for a `MetricPanel` whose `metricId` resolved to a
      `MetricDefinition` in 5.2/5.3, build the effective config per design.md D4 (`dataTypeId`/
      `fieldMapping`/`aggregation`/`unit`, raw fields override) — apply in both `resolveBindingsForRead`
      and `resolveSingleBinding` so every read path (list, single, `/query`) is consistent.

## 6. Schema

- [x] 6.1 `schemas/panel.schema.json`: add `"metricId": { "type": "string" }` to `MetricConfig`,
      `ChartConfig`, `TableConfig` `$defs`.
- [x] 6.2 Confirm `schemas/create-panel-request.schema.json` needs no direct edit (it only `$ref`s
      `panel.schema.json`'s defs) — if it turns out to duplicate any property list, update it too.
- [x] 6.3 `openspec validate` the change; run the repo's schema validation tooling if any (check
      `package.json`/`CONTRIBUTING.md` for a schema-lint script) against a sample metric-bound panel
      payload.

## Tests

- [x] T.1 `PanelSpec` (domain): `metricId` decode/decodeCreate/Patch/Patch.decode round-trips
      (absent/null/set) for Metric/Chart/Table configs.
- [x] T.2 `PanelServiceSpec` (or a new `PanelServiceMetricBindingSpec`): create/update reject a foreign
      or nonexistent `metricId` (400); create/update accept a caller-owned, pipeline-output-backed
      `metricId`; both raw fields and `metricId` may be set together.
- [x] T.3 Route-level test (`PanelRoutesSpec` or equivalent): a `MetricPanel` with only `metricId` set
      reads back with effective `dataTypeId`/`fieldMapping`/`aggregation`/`unit` materialized from the
      referenced metric; an explicit raw override wins over the metric-derived value.
- [x] T.4 Cross-user/deleted-metric read behavior: a panel whose `metricId` references another user's
      metric reads back with `metricId` cleared (no 500); deleting a referenced metric (via
      `DELETE /api/metrics/:id`) leaves the panel intact with `metricId` cleared on next read.
- [x] T.5 `MetricRepositorySpec`: `findByIdsOwned` returns only caller-owned matches; empty input
      short-circuits.
- [x] T.6 Regression: an existing panel with no `metricId` (pre-migration shape) behaves byte-for-byte
      as before — `sbt test` full suite green.
- [x] T.7 (fold-in, post-final-gate) Add a `GET /api/panels/:id/query` test in
      `PanelMetricBindingRoutesSpec` covering the single-panel `resolveSingleBinding` materialization
      path: a `MetricPanel` bound only via `metricId` returns `selectedFields` derived from the resolved
      metric's `measureField`; a negative control (unbound panel) still returns
      `"Panel is not bound to a data type"`. Mirrors the final-gate skeptic's live verification
      (skeptic-final-1.md) as an automated regression test.
