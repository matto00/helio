# HEL-553: Metric authoring UI + panel metric-binding picker

## Description

Humans need to author metrics and bind panels to them in-app, not only via the agent/API. This ticket
adds the metric authoring surface plus a metric picker in the panel editor. Backend CRUD is 418-B
(HEL-493: Metric CRUD service + REST routes) and the panel `metricId` binding is 418-C (HEL-500: Panel
binding to a metric (metric -> panel)).

Follow `DESIGN.md` and the existing Redux-slice + service + async-thunk pattern (`pipelinesSlice`,
panel editors under `frontend/src/features/panels/ui/editors/`, e.g. `MetricBindingFields.tsx`/
`BindingEditor`).

## Scope

- Frontend service + slice: a `metrics` axios service + Redux slice with `createAsyncThunk` calls
  against `/api/metrics` (list/create/update/delete), mirroring `pipelinesSlice.ts`.
- Metric authoring UI: a metrics list + editor (name, description, bind to a pipeline-output DataType,
  pick measure field + aggregation, choose allowed dimensions from the DataType's columns, set format
  unit/decimals/prefix/suffix, deprecate toggle). Reuse shared form components + design tokens.
- Panel editor: add a "bind to metric" mode to the panel binding editor (extend
  `MetricBindingFields.tsx` / `BindingEditor`) letting a user pick an existing metric (`metricId`)
  instead of hand-specifying field + reducer; show the resolved measure/format read-only when a metric
  is selected.
- Typed APIs; no unjustified `any`; Jest tests for the slice + key components.

## Acceptance Criteria

- [ ] A user can create, edit, deprecate, and delete a metric through the UI, with the measure/
      dimension pickers constrained to the bound DataType's columns.
- [ ] The panel editor offers a metric-binding mode that sets `metricId`; selecting a metric shows its
      resolved measure/aggregation/format and persists via the 418-C path.
- [ ] UI follows `DESIGN.md`; `npm run lint` (zero warnings) + `npm run format:check` pass.
- [ ] Redux slice + components covered by Jest tests; `npm test` passes; no unjustified `any`.

## Out of Scope

- MCP tools (418-D) and proposal/grounding (418-E) — already shipped as HEL-549.
- Governance propagation semantics beyond surfacing the deprecate toggle (418-G).

## Dependencies

- Blocked by 418-B (HEL-493) and 418-C (HEL-500). Both shipped on main.
