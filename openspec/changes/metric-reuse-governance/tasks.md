## 1. Backend — usage query + route

- [x] 1.1 `MetricRepository`: add a query joining `panels`/`dashboards` by `metric_id = <id> AND
      panels.owner_id = <caller>` (mirroring `PanelRepository.findById`'s join and
      `DataTypeRepository.existsBoundToAnyOwnedPanel`'s owner-scoping), returning
      `Vector[(panelId, panelTitle, dashboardId, dashboardName)]`. Add a `countBoundPanels` variant (or
      derive count from the same query) for reuse in the DELETE path (task 1.4).
- [x] 1.2 `MetricService`: add a `usage(id, user): Future[Either[ServiceError, MetricUsage]]` method —
      `findByIdOwned` first (404 if absent/not owned), then the repository query from 1.1.
- [x] 1.3 `MetricRoutes`: add `GET /api/metrics/:id/usage` calling `MetricService.usage`, returning
      `{ metricId, count, panels: [...] }`. Add the corresponding `MetricProtocol` JSON formatter(s).
      Add `schemas/metric-usage-response.schema.json` describing this shape (design.md D1 precedent —
      `pipeline-analyze-response.schema.json`).
- [x] 1.4 `MetricService.delete`: before deleting, compute the bound-panel count via 1.1's query.
      `MetricRoutes`'s DELETE handler: set an `X-Unbound-Panel-Count` response header on the `204`
      response (Pekko HTTP `respondWithHeader`), keeping the response body empty.
- [x] 1.5 No inline FQNs — import types at the top of each touched file per CONTRIBUTING.md.

## 2. Backend — deprecated-status materialization

- [x] 2.1 `PanelServiceHelpers` (or wherever `withMaterializedMetric`/the metric resolution runs): add
      `metricDeprecated: Boolean`, always set from the resolved `MetricDefinition.deprecated` whenever
      `metricId` resolves — for `MetricPanel`, `ChartPanel`, and `TablePanel` alike, independent of the
      existing raw-vs-materialized value precedence.
- [x] 2.2 Wire `metricDeprecated` into each panel-config type's read-side JSON output
      (`MetricPanelConfig`/`ChartPanelConfig`/`TablePanelConfig` — read/materialize side only, not a
      persisted/settable field).
- [x] 2.3 **(Round-1/round-2/round-3 design-gate REFUTE fix)** Update `schemas/panel.schema.json`:
      (a) declare `metricDeprecated: { "type": "boolean" }` in `properties` for each of
      `$defs.MetricConfig`/`$defs.ChartConfig`/`$defs.TableConfig` — no `required` change at the
      `$def` level (round-2 REFUTE: an unconditional `required` there would reject every legitimate
      metric/chart/table panel with no `metricId` at all — the majority case).
      (b) In the top-level `oneOf` (not the shared `$defs` — round-3 REFUTE: those `$def`s are also
      `$ref`'d by `schemas/create-panel-request.schema.json` to validate `POST /api/panels`, where
      `metricId` is a valid client-supplied create field but `metricDeprecated` is read-only/
      server-materialized and must never be required of a client), change the `metric`/`chart`/`table`
      branches' `config` from a bare `$ref` to an `allOf` combining the `$ref` with the conditional,
      e.g. for the `metric` branch:
      ```json
      { "properties": { "type": { "const": "metric" }, "config": { "allOf": [
          { "$ref": "#/$defs/MetricConfig" },
          { "if": { "required": ["metricId"] }, "then": { "required": ["metricDeprecated"] } }
      ] } } }
      ```
      identically for `chart`/`table`. This mirrors `schemas/create-panel-request.schema.json`'s own
      `allOf`/`if`/`then` pattern (lines 29-70), scoped correctly to response-only validation.
      `schemas/bound-panel-response.schema.json` needs no separate edit — it already `$ref`s
      `panel.schema.json`.

## 3. helio-mcp — grounding catalog excludes deprecated

- [x] 3.1 `helio-mcp/src/context.ts`'s `buildWorkspaceContext`: filter `metricsPage.items` to
      `deprecated !== true` before building the `metrics` array (around line 1114). Update the
      `WorkspaceContext` interface's `metrics` field doc-comment (lines ~949-964) to state the new
      exclusion behavior, replacing the now-stale "still included, not filtered out" text.
- [x] 3.2 `helio-mcp/src/tools/read.ts`: update `get_workspace_context`'s tool description to mention
      the deprecated-exclusion behavior.
- [x] 3.3 Confirm `list_metrics` (`helio-mcp/src/tools/read.ts` or wherever it's registered) is
      untouched — no filtering added there.

## 4. Frontend — types + services

- [x] 4.1 Add `metricDeprecated?: boolean` to `MetricPanelConfig`/`ChartPanelConfig`/`TablePanelConfig`
      in `frontend/src/features/panels/types/panel.ts`.
- [x] 4.2 `frontend/src/features/metrics/types/metric.ts`: add a `MetricUsage` type
      (`{ metricId, count, panels: [...] }`).
- [x] 4.3 `frontend/src/features/metrics/services/metricService.ts`: add `fetchMetricUsage(id):
      Promise<MetricUsage>` calling `GET /api/metrics/:id/usage`.

## 5. Frontend — picker excludes deprecated (with bound-metric exception)

- [x] 5.1 `frontend/src/features/panels/ui/editors/useMetricBindingState.ts`: filter the metrics list
      to `!m.deprecated || m.id === currentMetricId` before returning it for the picker's options.
- [x] 5.2 `frontend/src/features/panels/ui/editors/MetricPicker.tsx`: no filtering change needed if 5.1
      already filters upstream — verify the component still correctly renders the current selection
      when it's the one deprecated exception.

## 6. Frontend — deprecated indicator in binding editor

- [x] 6.1 `frontend/src/features/panels/ui/editors/MetricPicker.tsx` (or `MetricBindingFields.tsx`):
      when the resolved/selected metric's `deprecated` is `true` (or the panel's `config.metricDeprecated`
      is `true`, for an already-saved panel), render a "deprecated" indicator, duplicating the CSS class
      pattern from `frontend/src/features/metrics/ui/MetricListTable.tsx`'s `.metric-status--deprecated`
      (scoped locally — not promoted to `shared/ui/`, per design.md D7).

## 7. Frontend — delete confirmation shows real usage count

- [x] 7.1 `frontend/src/features/metrics/ui/MetricDetailPage.tsx`: on initiating delete (clicking
      "Delete metric"), call `fetchMetricUsage(id)` and display the real bound-panel count in the
      inline confirm affordance, replacing the current generic copy.
- [x] 7.2 `frontend/src/features/metrics/ui/MetricListTable.tsx`: same change for its own inline
      delete-confirm affordance.

## 8. Tests

- [x] 8.1 `MetricRepositorySpec.scala` (or a new spec): usage query returns bound panels + dashboards,
      owner-scoped, empty for an unbound metric.
- [x] 8.2 `MetricRoutesSpec.scala`: `GET /api/metrics/:id/usage` — 200 with panels/count, 404 for
      non-owned/nonexistent, `DELETE /api/metrics/:id` sets `X-Unbound-Panel-Count` correctly for
      bound/unbound cases.
- [x] 8.3 `PanelMetricBindingRoutesSpec.scala` (or a new spec): `config.metricDeprecated` reflects the
      bound metric's current `deprecated` value on read, for `MetricPanel`/`ChartPanel`/`TablePanel`,
      independent of raw-field overrides.
- [x] 8.4 New/extended spec: renaming a bound metric (`PATCH /api/metrics/:id`, name only) is reflected
      on every subsequent panel read with no `PATCH /api/panels/:id` call — proves AC #2 (rename safety)
      by construction, not new behavior.
- [x] 8.5 `helio-mcp/src/context.test.ts`: `buildWorkspaceContext`'s `metrics` array excludes a
      `deprecated: true` metric while including active ones; `list_metrics`-adjacent test (if any)
      confirms it is unaffected.
- [x] 8.6 `frontend/src/features/panels/ui/editors/useMetricBindingState.test.ts` (new or extended):
      deprecated metrics excluded from options except the currently-bound one.
- [x] 8.7 `frontend/src/features/metrics/ui/MetricDetailPage.test.tsx` /
      `MetricListTable.test.tsx`: delete-confirm affordance shows the real usage count from
      `fetchMetricUsage`.
- [x] 8.8 Run `sbt test` + helio-mcp build/tests + `npm run lint`/`format:check`/`npm test`; confirm no
      FQNs inlined.
