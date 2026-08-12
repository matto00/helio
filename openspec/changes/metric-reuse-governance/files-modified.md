## Backend

- `backend/src/main/scala/com/helio/domain/model.scala` — new `MetricUsagePanel`/`MetricUsage` domain types for the "where used" query.
- `backend/src/main/scala/com/helio/infrastructure/MetricRepository.scala` — `usage`/`countBoundPanels` owner-scoped panel↔dashboard join query.
- `backend/src/main/scala/com/helio/services/MetricService.scala` — `usage` service method (404-first via `findByIdOwned`); `delete` now returns the pre-delete bound-panel count.
- `backend/src/main/scala/com/helio/api/protocols/MetricProtocol.scala` — `MetricUsagePanelResponse`/`MetricUsageResponse` wire DTOs + JSON formats.
- `backend/src/main/scala/com/helio/api/package.scala` — re-export aliases for the two new response types (mirrors `MetricResponse`'s existing alias pattern), needed by `MetricRoutes.scala`'s `com.helio.api._` wildcard import.
- `backend/src/main/scala/com/helio/api/routes/MetricRoutes.scala` — new `GET /api/metrics/:id/usage` route; `DELETE` now sets `X-Unbound-Panel-Count`.
- `backend/src/main/scala/com/helio/api/routes/ServiceResponse.scala` — new `runNoContentWithHeader` helper for the DELETE header.
- `backend/src/main/scala/com/helio/domain/panels/MetricPanel.scala`, `ChartPanel.scala`, `TablePanel.scala` — new read-only `metricDeprecated: Option[Boolean]` config field (`jsonFormat6` → `jsonFormat7`), never decoded from client input.
- `backend/src/main/scala/com/helio/services/PanelServiceHelpers.scala` — `withMaterializedMetric` now sets `metricDeprecated` for all three bound-trio panel kinds (previously `MetricPanel`-only for the other materialized fields).

## Backend tests

- `backend/src/test/scala/com/helio/infrastructure/MetricRepositorySpec.scala` — `usage`/`countBoundPanels` coverage (bound/unbound/owner-scoped).
- `backend/src/test/scala/com/helio/api/routes/MetricRoutesSpec.scala` — `GET /:id/usage` (200/404/owner-scope) + `DELETE` `X-Unbound-Panel-Count` header coverage.
- `backend/src/test/scala/com/helio/api/routes/PanelMetricBindingRoutesSpec.scala` — `config.metricDeprecated` materialization (metric/chart/table, active + deprecated) and the metric-rename-requires-no-rebind proof.

## Schemas

- `schemas/panel.schema.json` — `metricDeprecated` declared in `$defs.MetricConfig`/`ChartConfig`/`TableConfig` (no `required` change at the `$def` level); the top-level `oneOf`'s `metric`/`chart`/`table` branches wrap `config` in an `allOf` with a conditional `if metricId then metricDeprecated` requirement, scoped to the response-only schema (design.md D6, round-1/2/3 design-gate REFUTE fix).
- `schemas/metric-usage-response.schema.json` — new schema for `GET /api/metrics/:id/usage`'s response shape.

## helio-mcp

- `helio-mcp/src/context.ts` — `buildWorkspaceContext`'s `metrics` array now excludes `deprecated: true` metrics; doc-comment updated.
- `helio-mcp/src/tools/read.ts` — `get_workspace_context` tool description updated to document the exclusion.
- `helio-mcp/src/context.test.ts` — updated the prior "includes a deprecated metric" test to assert exclusion instead (behavior reversal per this ticket).

## Frontend

- `frontend/src/features/panels/types/panel.ts` — `metricDeprecated?: boolean` added to `MetricPanelConfig`/`ChartPanelConfig`/`TablePanelConfig`.
- `frontend/src/features/metrics/types/metric.ts` — new `MetricUsage`/`MetricUsagePanel` types.
- `frontend/src/features/metrics/services/metricService.ts` — new `fetchMetricUsage`.
- `frontend/src/features/panels/ui/editors/useMetricBindingState.ts` — filters deprecated metrics out of the picker's offered options, except the panel's currently-bound one.
- `frontend/src/features/panels/ui/editors/MetricPicker.tsx` — new `deprecated` prop rendering a "deprecated" indicator next to the picker.
- `frontend/src/features/panels/ui/editors/MetricBindingFields.tsx` — forwards `metricDeprecated` to `MetricPicker`.
- `frontend/src/features/panels/ui/editors/BindingEditor.tsx` — computes `metricDeprecated` (live selection, falling back to the panel's materialized `config.metricDeprecated`) and passes it to both `MetricBindingFields` and the chart/table `MetricPicker`.
- `frontend/src/features/panels/ui/PanelDetailModal.binding.css` — new `.panel-detail-modal__metric-deprecated` badge style (duplicated from `MetricsPage.css`'s `.metric-status--deprecated`, per design.md D7).
- `frontend/src/features/metrics/ui/MetricDetailPage.tsx`, `MetricListTable.tsx` — delete-confirm now fetches and displays the real usage count via `fetchMetricUsage`.
- `frontend/src/test/panelFixtures.ts` — fixture builders pass `metricDeprecated` through.
- `frontend/src/test/renderWithStore.tsx` — extended `metrics` preload shape to support `currentMetric`/`currentMetricStatus`/`currentMetricError`; added an optional `initialPath` param so route-param-dependent pages (`MetricDetailPage`) can be tested.

## Frontend tests

- `frontend/src/features/metrics/services/metricService.test.ts` — `fetchMetricUsage` coverage.
- `frontend/src/features/panels/ui/editors/useMetricBindingState.test.ts` (new) — deprecated-filtering coverage (excluded, bound-exception, mixed).
- `frontend/src/features/panels/ui/editors/BindingEditor.metricBinding.test.tsx` — new deprecated-indicator coverage (metric/chart panels, active vs. deprecated).
- `frontend/src/features/metrics/ui/MetricDetailPage.test.tsx` (new), `MetricListTable.test.tsx` (new) — delete-confirm usage-count coverage.

## OpenSpec

- `openspec/changes/metric-reuse-governance/tasks.md` — all 27 tasks marked complete.
