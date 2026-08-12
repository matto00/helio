## 1. Frontend — types, service, slice

- [x] 1.1 Add `Metric`/`MetricSummary`/`MetricFormat`/`CreateMetricRequest`/`UpdateMetricRequest` types
      under `frontend/src/features/metrics/types/metric.ts`, mirroring `MetricResponse`'s wire shape.
- [x] 1.2 Add `metricId?: string | null` to `MetricPanelConfig`/`ChartPanelConfig`/`TablePanelConfig` in
      `frontend/src/features/panels/types/panel.ts`.
- [x] 1.3 Create `frontend/src/features/metrics/services/metricService.ts`: `fetchMetrics`,
      `createMetric`, `updateMetric`, `deleteMetric`, `fetchMetricById` — plain async functions over
      `httpClient`, normalizing `description`/`format` (`undefined` → `null`/defaults) at the boundary.
- [x] 1.4 Create `frontend/src/features/metrics/state/metricsSlice.ts`: one `createAsyncThunk` per CRUD
      op (`{rejectValue: string}`, `extractErrorMessage`), flat `items: MetricSummary[]`, per-op
      `status`/`error` pairs, `extraReducers` for `pending`/`fulfilled`/`rejected`. Export
      `metricsReducer` (not `default`), matching `pipelinesSlice`'s export convention.
- [x] 1.5 Register `metricsReducer` in the root store.

## 2. Frontend — metrics list + editor UI

- [x] 2.1 Add `Toggle` primitive to `frontend/src/shared/ui/` (checked/onChange/label/disabled props,
      DESIGN.md token/control-height compliant).
- [x] 2.2 Create `frontend/src/features/metrics/ui/MetricsPage.tsx`: fetches on mount, loading/empty/
      error states, list table, "New metric" affordance — mirrors `PipelinesPage.tsx`.
- [x] 2.3 Create `frontend/src/features/metrics/ui/MetricDetailPage.tsx` (edit) and the create flow
      (new-metric form, reachable from `MetricsPage`) — mirrors `PipelineDetailPage.tsx`.
- [x] 2.4 Create `frontend/src/features/metrics/ui/MetricEditorForm.tsx`: name, description, DataType
      picker (reuse `DataTypePicker`), measure-field picker (reuse `fieldOptions`), aggregation picker,
      allowed-dimensions multi-select (new, checkbox-list-in-popover per design.md D3/Risk), format
      fields, deprecate `Toggle`. Surfaces 400/422 backend errors inline per field.
- [x] 2.5 Wire delete (with confirmation) from both `MetricsPage` and `MetricDetailPage`.
- [x] 2.6 Register `/metrics` and `/metrics/:id` routes in `frontend/src/app/App.tsx`.
- [x] 2.7 Wire `/metrics` into app-shell navigation, genuinely mirroring the existing `"pipelines"`
      rotation entry (design.md D1, round-1 revision): add a `navDestinations.ts` entry; a
      `SidebarBody.tsx` `section === "metrics"` branch (same shape as the existing `"pipelines"`
      branch); `App.tsx`'s `breadcrumbLabel()` and `sectionFromPathname()` handling for `/metrics` so
      it doesn't fall through to `"dashboards"`; and the mobile `breadcrumbItemName`/`mobileSection`
      plumbing `App.tsx` already does for `pipelines`.

## 3. Frontend — panel binding editor metric mode

- [x] 3.1 `frontend/src/features/panels/state/panelPayloads.ts`'s `buildBindingPatch`: accept and
      forward an optional `metricId`.
- [x] 3.2 `frontend/src/features/panels/services/panelService.ts`'s `updatePanelBinding`: add an
      optional `metricId` param (positional tail, matching the existing `annotation`/`chartOptions`
      convention), forwarded to the PATCH body.
- [x] 3.3 `frontend/src/features/panels/state/panelThunks.ts`'s `updatePanelBinding` thunk (re-exported
      via `panelsSlice.ts`): accept and forward `metricId`.
- [x] 3.4 Create `frontend/src/features/panels/ui/editors/useMetricBindingState.ts` (design.md D5,
      round-1 revision — mirrors `useBoundOrLiteralState.ts`'s shape): owns the bind-to-metric mode's
      state (selected `metricId`, the metrics fetch via `metricsSlice`, dirty tracking), gated to
      `metric`/`chart`/`table` panel types only. `BindingEditor.tsx` wires this hook's state into its
      existing save path (no new inline JSX/state block added to `BindingEditor.tsx` itself) — save
      path includes `metricId`.
- [x] 3.5 Create `frontend/src/features/panels/ui/editors/MetricPicker.tsx` (design.md D5, round-1
      revision) composed into `MetricBindingFields.tsx`: when a metric is selected (metric panels
      only), render the resolved measure/aggregation/format read-only instead of the Field/Reduce
      selectors; clearing the selection reveals the raw fields again.
- [x] 3.6 Chart/table panels: bind-to-metric mode sets `metricId` without touching existing field-
      mapping controls (no materialization UI, per design.md D6).

## 4. Tests

- [x] 4.1 `frontend/src/features/metrics/services/metricService.test.ts` — one test per exported
      function, axios mocked, matching `pipelineService.test.ts`'s structure.
- [x] 4.2 `frontend/src/features/metrics/state/metricsSlice.test.ts` — per-thunk reducer + thunk
      sub-suites, matching `pipelinesSlice.test.ts`'s structure.
- [x] 4.3 `frontend/src/shared/ui/Toggle.test.tsx` — checked/unchecked render, onChange fires, disabled
      state.
- [x] 4.4 `frontend/src/features/metrics/ui/MetricEditorForm.test.tsx` — create/edit happy path,
      DataType-constrained pickers, inline 400/422 error display.
- [x] 4.5 `frontend/src/features/panels/ui/editors/BindingEditor.metricBinding.test.tsx` — new
      split-file test (matching `.annotation.test.tsx`/`.aggregation.test.tsx` precedent): selecting a
      metric sets `metricId` and shows read-only resolved fields (metric panel); chart/table panels
      keep field-mapping controls editable after binding a metric; collection/timeline panels don't
      offer the mode.
- [x] 4.6 Run `npm run lint` (zero warnings), `npm run format:check`, `npm test` (root jest + frontend);
      confirm no unjustified `any`.
