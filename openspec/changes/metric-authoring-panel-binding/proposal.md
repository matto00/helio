## Why

Metrics can only be authored via the API/agent today (HEL-493/HEL-500/HEL-549). Humans need an in-app
way to define, edit, deprecate, and delete a metric, and to bind a panel to one — the frontend has zero
`metricId` awareness anywhere (types, panel-binding editor, or a dedicated CRUD surface).

## What Changes

- New `metricsSlice`/`metricService` mirroring `pipelinesSlice.ts` (`createAsyncThunk` per CRUD op,
  `status`/`error` pairs, `extractErrorMessage`).
- New Metrics list + editor page (`/metrics`), following `PipelinesPage`/`PipelineDetailPage`'s
  page-owns-list-and-navigates precedent. Editor: name, description, DataType picker (reusing
  `DataTypePicker`), measure-field picker (reusing `fieldOptions`), aggregation picker, allowed-dimensions
  multi-select (**new**), format (unit/decimals/prefix/suffix), deprecate toggle (**new shared
  primitive** — no `Toggle`/`Switch` exists in `shared/ui` today).
- `MetricPanelConfig`/`ChartPanelConfig`/`TablePanelConfig` frontend types gain `metricId?: string | null`
  (backend/schema already support it; frontend types do not).
- `BindingEditor`/`MetricBindingFields` gain a bind-to-metric mode: picking an existing metric sets
  `metricId` and shows its resolved measure/aggregation/format read-only. Threaded through
  `buildBindingPatch` → `panelService.updatePanelBinding` → the `updatePanelBinding` thunk, persisted
  via the existing 418-C `metricId` config path — no new backend work.

## Capabilities

### New Capabilities

- `metric-authoring-ui`: the metrics list + editor page, its Redux slice/service, and the CRUD flows
  (create/edit/deprecate/delete) it exposes.

### Modified Capabilities

- `panel-datatype-binding`: the frontend panel binding editor (`BindingEditor`) gains a bind-to-metric
  mode, in addition to its existing bind-to-DataType-field mode.

## Impact

- `frontend/src/features/metrics/**` (new: state/slice, services, ui — list + editor).
- `frontend/src/features/panels/types/panel.ts` (`metricId` on three config types),
  `panelPayloads.ts` (`buildBindingPatch`), `services/panelService.ts` (`updatePanelBinding`),
  `state/panelsSlice.ts` (thunk param), `ui/editors/{BindingEditor,MetricBindingFields}.tsx`.
- `frontend/src/shared/ui/` (new `Toggle` primitive, if no adequate existing switch markup is found).
- `frontend/src/app/App.tsx` (new `/metrics` route).
- No backend changes — HEL-493/HEL-500 already ship the full wire contract this UI consumes.
- Out of scope: MCP tools (418-D, shipped HEL-541) and proposal/grounding (418-E, shipped HEL-549);
  governance propagation beyond the deprecate toggle (418-G).
