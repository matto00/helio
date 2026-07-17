# Tasks — fix-creation-chart-type (HEL-305)

## 1. Backend

- [x] 1.1 Add optional `appearance` to `CreatePanelRequest` in `PanelProtocol.scala` (typed `PanelAppearance`, reusing the existing codec)
- [x] 1.2 In `PanelService.create`, normalize a provided appearance (background/color/transparency, mirroring `PanelServiceHelpers.resolvePatch`) and add a `RequestValidation.validateChartType` check — NEW validation for panel CRUD (today its only caller is `DashboardProposalService`); fall back to `PanelAppearance.Default` when absent
- [x] 1.3 Add the same `RequestValidation.validateChartType` check to the appearance branch of `PanelServiceHelpers.resolvePatch` so single-item PATCH rejects invalid chartType identically (D5 parity)
- [x] 1.4 Add a pre-DBIO `validateChartType` step in `PanelService.batchUpdate` covering every item's `appearance.chart.chartType` (the live edit-UI path) — reject the whole batch with a 400 before any write (D5)
- [x] 1.5 Update `schemas/create-panel-request.schema.json` with the optional `appearance` property (same shape as the PATCH appearance)

## 2. Frontend

- [x] 2.1 Move `DEFAULT_CHART_APPEARANCE` from `PanelDetailModal.tsx` to `frontend/src/theme/appearance.ts` (exported, behavior-preserving) and re-import in `PanelDetailModal.tsx`
- [x] 2.2 Extend `CreatePanelBody` and `buildCreatePanelBody` (`state/panelPayloads.ts`) to emit `appearance` (`defaultPanelAppearance` + default chart appearance + `chartType`) only when `typeConfig.type === "chart"` and `chartType` is set
- [x] 2.3 Seed `config.label`/`config.unit` from metric `typeConfig.valueLabel`/`unit` in `seedCreateConfig` (omit empty values)
- [x] 2.4 Update the chart card description in `TypeSelectStep.tsx` to name line, bar, pie, and scatter

## 3. Tests

- [x] 3.1 `panelPayloads.test.ts`: chart create carries `appearance.chart.chartType`; omits `appearance` when chartType unset or type is non-chart; metric create carries `label`/`unit` and omits empties
- [x] 3.2 Backend ScalaTest: create with appearance persists it; create without keeps `PanelAppearance.Default`; invalid `chartType` at create → 400; invalid `chartType` via PATCH → 400; valid PATCH appearance still persists; batch update with invalid `chart.chartType` → 400 with no partial write; valid batch appearance persists
- [x] 3.3 Run frontend gates (`npm test`, `npm run lint`, `npm run format:check`) and `sbt test`; verify creation flow end-to-end (bar/pie/scatter render on first load) per the evaluator's UI pass — all gates green; create response now carries `appearance.chart.chartType` (backend test asserts persistence on first read). Live-browser render pass left to the evaluator's UI check.
