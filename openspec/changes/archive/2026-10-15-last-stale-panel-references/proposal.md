## Why

HEL-1598 restated most stale panel references after the pipelines-and-outputs remodel but deferred five leftovers (its evidence.md section D). They still describe a panel model that no longer exists (`typeId`, `type: "chart"` panels, "data binding" saves) or carry dead code, which misleads the next reader and the agents that ground on these specs.

## What Changes

- Restate the echarts-chart-panel requirement "Chart panel renders a live ECharts instance" for the current model: a chart is an Output of kind `chart` rendered in an `output` panel; no `typeId`, no DataType binding. Also correct that spec's Purpose line (direct edit; Purpose is not delta-able).
- Rename `usePanelPolling`'s `typeId` parameter (and its doc comment) to `outputId`. Behaviour identical.
- Correct write-path-audit: the "data binding updates" scenario (delta), and the reference-section rows that are not requirements (direct edit): payload detail 8, the call-volume "Panel data binding saves" row and totals, and the Source Locations `PanelDetailModal.tsx` row.
- Verify the CLAUDE.md claim about `GET /api/dashboards/:id/panels`; correct that one line if the doc is wrong.
- Remove `CollectionRenderer`'s dead `metricOptions` prop and the dead `.panel-detail-modal__segmented*` CSS, updating the tests that pinned them.

## Capabilities

### New Capabilities

### Modified Capabilities
- `echarts-chart-panel`: requirement "Chart panel renders a live ECharts instance" restated for the Output-bound model.
- `write-path-audit`: requirement "Write path audit document exists" — the panel-level scenario no longer lists "data binding updates".

## Impact

- Specs: `openspec/specs/echarts-chart-panel/spec.md`, `openspec/specs/write-path-audit/spec.md`.
- Frontend: `features/panels/hooks/usePanelPolling.ts`, `features/panels/ui/renderers/CollectionRenderer.tsx` (+ its test and `MetricRenderer.duration.test.tsx`), `features/panels/ui/detailModal/PanelDetailModal.sections.css`, `PanelDetailModal.mobile.css`, `PanelDetailModal.css.test.ts`.
- Docs: one line of `CLAUDE.md`.
- No API, schema, or rendered-output change.
