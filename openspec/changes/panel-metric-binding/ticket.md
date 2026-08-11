# HEL-500: Panel binding to a metric (metric → panel)

## Description

The payoff of the metric layer: a panel references a NAMED METRIC instead of re-specifying `dataTypeId` + `fieldMapping` + a bespoke `aggregation`. Today `MetricPanelConfig` / `ChartPanelConfig` / `TablePanelConfig` (`backend/src/main/scala/com/helio/domain/panels/`) each carry their own binding trio and the query path derives fields via `Panel.buildQuery` (`Panel.scala`). This ticket lets those bound panel kinds optionally bind to a `metricId`, resolving the measure/aggregation/format from the stored `MetricDefinition` at read/query time so the agent composes defined metrics rather than re-inventing them.

## Scope

* Domain: add an optional `metricId: Option[MetricId]` to the bound panel configs (`MetricPanelConfig` at minimum; extend `ChartPanelConfig`/`TablePanelConfig` where the epic warrants). Update the tolerant `decode`/`decodeCreate`/`Patch` decoders and canonical writers, preserving absent-vs-null semantics. When `metricId` is set, it is the authoritative source of the measure + aggregation + format; `fieldMapping`/`aggregation` become optional overrides.
* Resolution: at the point panels are read/queried for rendering (`PanelService` read path / `buildQuery`), resolve `metricId` → `MetricDefinition` (via `MetricRepository` from 418-A) and materialize the effective binding (measure field, aggregation, allowed dimensions, format). A panel bound to a metric owned by another user (or a deleted metric) resolves to an unbound/cleared state rather than 500ing — mirror `withBindingCleared`/`resolveBindingsForRead`.
* Validation: `PanelService.create`/`update` must confirm a supplied `metricId` resolves to a caller-owned metric whose bound DataType still satisfies V41; reject otherwise. A panel may set `metricId` OR the raw `dataTypeId` trio, not conflicting values (define precedence: `metricId` wins, raw fields become overrides).
* Persistence: Flyway migration (next available VNN, assigned at scheduling time — main at V59; do NOT hardcode) adding a nullable `metric_id` column to `panels` (additive nullable column per `V53` precedent), FK to `metrics(id) ON DELETE SET NULL` so deleting a metric unbinds rather than deletes panels.
* Wire/schema: update `schemas/panel.schema.json` + `create-panel-request.schema.json` and `PanelResponse`/protocol writers to carry `metricId`.
* No FQNs inlined in Scala.

## Acceptance criteria

- [ ] A metric/chart/table panel can be created and updated with a `metricId`; the effective measure/aggregation/format is resolved from the `MetricDefinition` at read time (verified by a route/service ScalaTest).
- [ ] Deleting the referenced metric sets `panels.metric_id` NULL (FK `ON DELETE SET NULL`) and the panel reads back as unbound, not errored.
- [ ] A `metricId` referencing a non-owned or non-existent metric is rejected at create/update; a cross-user metric resolves to a cleared binding on read (no 500).
- [ ] Precedence defined and tested: `metricId` is authoritative; raw `fieldMapping`/`aggregation` act only as overrides.
- [ ] `panels.metric_id` migration added; `schemas/panel.schema.json` + `create-panel-request.schema.json` updated and validated; existing panels (no `metricId`) behave exactly as before.
- [ ] `sbt test` passes; no FQNs inlined.
- [ ] The `GET /api/panels/:id/query` route's single-panel metric materialization path (`resolveSingleBinding`) has automated test coverage — not just live/manual verification. (Added post-final-gate: the final-gate skeptic verified this path live and found it correct but uncovered by any automated test; triaged fold-in — cheap, same-file, genuine regression-coverage gap in a path this ticket added.)

## Out of scope

* Authoring UI for picking a metric in the panel editor (418-F).
* Exposing metrics/`metricId` through proposals + workspace-context (418-E).

## Dependencies

* Blocked by 418-A (HEL-446: Metric definition model + persistence). Downstream: 418-E, 418-G.
