# Files Modified — chart-appearance-config

## Backend
- `backend/src/main/scala/com/helio/domain/model.scala` — Added `ChartLegend`, `ChartTooltip`, `ChartAxisLabel`, `ChartAxisLabels`, `ChartAppearance` case classes; extended `PanelAppearance` with `chart: Option[ChartAppearance]`
- `backend/src/main/scala/com/helio/api/JsonProtocols.scala` — Added Spray JSON formatters for all chart sub-types; updated `PanelAppearancePayload`, `PanelAppearanceResponse`, and `PanelAppearance` formats to include `chart` field; updated `PanelAppearanceResponse.fromDomain` and `DashboardSnapshotPanelEntry.fromDomain`
- `backend/src/main/scala/com/helio/api/routes/PanelRoutes.scala` — Passes `chart` field from payload through to `PanelAppearance` domain object on PATCH
- `backend/src/main/scala/com/helio/infrastructure/DashboardRepository.scala` — Wires `chart` field in snapshot/import panel entry path

## Schema
- `schemas/panel-appearance.schema.json` — Added optional `chart` property with nested `seriesColors`, `legend`, `tooltip`, and `axisLabels` definitions

## Frontend — Types
- `frontend/src/types/models.ts` — Added `ChartLegend`, `ChartTooltip`, `ChartAxisLabel`, `ChartAxisLabels`, `ChartAppearance` interfaces; extended `PanelAppearance` with `chart?: ChartAppearance`

## Frontend — Utility
- `frontend/src/utils/chartAppearance.ts` — New file: `appearanceToEChartsOption` maps `ChartAppearance` to ECharts option fields
- `frontend/src/utils/chartAppearance.test.ts` — New file: unit tests for `appearanceToEChartsOption`

## Frontend — Components
- `frontend/src/components/ChartPanel.tsx` — Added optional `appearance` prop; merges appearance-derived ECharts options with defaults
- `frontend/src/components/PanelContent.tsx` — Added `appearance?: PanelAppearance` prop, forwarded to `ChartPanel`
- `frontend/src/components/PanelGrid.tsx` — Passes `panel.appearance` to `PanelContent` in `PanelCardBody`
- `frontend/src/components/PanelDetailModal.tsx` — Added chart appearance state with defaults; Chart section UI (series colors, legend, tooltip, axis labels); live `ChartPanel` preview; `chart` field included in save dispatch; `isDirty` covers chart changes

## Tests
- `frontend/src/components/PanelDetailModal.test.tsx` — Added chart-panel modal render helper; Chart section presence/absence tests; control interaction tests
- `frontend/src/components/PanelContent.test.tsx` — Updated mock to capture `appearance` prop; added forwarding tests
