## Context

Backend/wire contract fully shipped: `MetricResponse`/`CreateMetricRequest`/`UpdateMetricRequest`
(`MetricProtocol.scala`, `GET/POST /api/metrics`, `GET/PATCH/DELETE /api/metrics/:id`), and
`metricId: Option[MetricId]` on `MetricPanelConfig`/`ChartPanelConfig`/`TablePanelConfig` (HEL-500).
The frontend has **zero** `metricId` awareness (`grep -rn "metricId" frontend/src` → nothing) and no
metric CRUD surface at all. `pipelinesSlice.ts`/`pipelineService.ts` is the established slice/service
template (per-op `status`/`error` pairs, `extractErrorMessage`, thunk-per-op). `BindingEditor.tsx` +
`MetricBindingFields.tsx` (`frontend/src/features/panels/ui/editors/`) own the existing bind-to-field
flow; `DataTypePicker.tsx` + `fieldOptions.ts`/`aggFieldOptions.ts` are the reusable field-picker
primitives. `PipelinesPage.tsx`/`PipelineDetailPage.tsx` is the page-owns-list-and-navigates precedent.

## Goals / Non-Goals

**Goals:**
- Metric CRUD entirely through the UI, matching `MetricService`'s validation contract (400 name-empty,
  422 binding-shape) with inline field errors.
- `BindingEditor` can bind a metric/chart/table panel to `metricId`, persisted via the existing 418-C
  config path — no backend changes.

**Non-Goals:**
- Any backend/schema change — HEL-493/HEL-500 already ship everything this UI needs.
- MCP tools (418-D) / proposal-grounding (418-E) — both already shipped as HEL-541/HEL-549.
- Governance propagation beyond the deprecate toggle itself (418-G) — deprecating a metric here does
  not, e.g., retroactively warn every panel bound to it; that's 418-G's separate scope.
- Collection/Timeline panel metric binding — HEL-500 never added `metricId` there either.

## Decisions

**D1 — Metrics get their own page (`/metrics`), genuinely mirroring the Pipelines precedent —
including its nav wiring.** (Revised after design-gate REFUTE round 1: the original wording claimed
following Pipelines *avoids* `navDestinations.ts`/`SidebarBody.tsx` wiring, but Pipelines is itself one
of the four items in that exact rotation — `navDestinations.ts:16-21`, `SidebarBody.tsx`'s
`section === "pipelines"` branch, `App.tsx`'s `breadcrumbLabel()`/mobile-sheet handling. Skipping that
wiring would make `/metrics` reachable only by typing the URL, with `sectionFromPathname()` falling
through to `"dashboards"` and rendering the wrong sidebar section — the opposite of the ticket's own
goal of an in-app, discoverable human authoring surface.) Metrics are a flat, page-scoped CRUD resource
like pipelines: `/metrics` (list, `MetricsPage.tsx`) + `/metrics/:id` (detail/edit,
`MetricDetailPage.tsx`) mirrors `/pipelines` + `/pipelines/:id`, and — genuinely, this time — so does
the nav: a `navDestinations.ts` entry, a `SidebarBody.tsx` `section === "metrics"` branch (identical
shape to the existing `"pipelines"` branch), and `breadcrumbLabel()`/`sectionFromPathname()` handling
for `/metrics`. Create is a "new" affordance on the list page, matching Pipelines' own create flow.

**D2 — `metricsSlice`/`metricService` follow `pipelinesSlice`/`pipelineService`'s structural
conventions** (revised wording after design-gate round 1 — "byte-for-byte mirror" overstated it: `GET
/api/metrics` returns a paginated `PagedResult<MetricResponse>`, unlike `GET /api/pipelines`'s flat
array, so the fetch thunk unwraps `.items` — the same pattern `dataTypeService.ts`'s `fetchDataTypes`
already uses for its own paginated endpoint, not something `pipelineService.ts` needed). One thunk per
CRUD op (`fetchMetrics`, `createMetric`, `updateMetric`, `deleteMetric`), each `{rejectValue: string}`,
`extraReducers` with `pending`/`fulfilled`/`rejected` per thunk, flat `items: MetricSummary[]` (not
normalized), reusing the same `extractErrorMessage` shape (duplicated per-slice, matching existing
house style — not extracted to a shared helper, since no other slice does that either).
`metricService.ts` normalizes `description`/`format` at the service boundary (`undefined` → `null`/
defaults) exactly like `pipelineService.ts`'s `normalizeSchedule`, since spray-json omits
`Option[X] = None` keys on the wire.

**D3 — Reuse `DataTypePicker`/`fieldOptions`/`aggFieldOptions` verbatim for the metric editor's
DataType/measure-field pickers; allowed-dimensions is a new multi-select built on the same
`fieldOptions()` list.** No existing multi-select component exists to reuse; the new one lives in
`frontend/src/features/metrics/ui/` (metric-editor-local), not promoted to `shared/ui` speculatively —
promote only if a second consumer appears (matches this codebase's "rule of three" extraction
convention, per `fieldOptions.ts`'s own comment).

**D4 — Add a `Toggle` primitive to `shared/ui/` for the deprecate switch**, since none exists
(`shared/ui/` confirmed: `DataGrid`, `EmptyState`, `Modal`, `Select`, `Textarea`, `TextField`, `Toast`
— no switch/checkbox primitive). Built to DESIGN.md's token/control-height rules (`--control-sm/md/lg`,
`--app-*` colors), so it's immediately reusable — but this change only consumes it once; no other
call site is added speculatively.

**D5 — `BindingEditor`'s bind-to-metric mode is a THIRD mode alongside the existing bind-to-field flow,
not a replacement, and its state/UI are extracted rather than added inline.** (Revised after design-gate
REFUTE round 1: `BindingEditor.tsx` is already 493 lines, past `CONTRIBUTING.md:24`'s ~400-line
split-threshold — a threshold this exact file has already been extracted-under multiple times
(`MetricBindingFields.tsx`, `ChartAggregationFields.tsx`, `TableDisplayFields.tsx`,
`useBoundOrLiteralState`, etc.), so adding a third mode's state/JSX inline would continue exactly the
growth those prior extractions existed to stop.) The new mode's state (selected `metricId`, the
metrics fetch via `metricsSlice`, dirty tracking) is extracted into a new hook,
`useMetricBindingState.ts` (`frontend/src/features/panels/ui/editors/`), mirroring
`useBoundOrLiteralState.ts`'s existing shape; its picker UI is a new `MetricPicker.tsx` component
(same directory), composed into `MetricBindingFields.tsx` rather than grown inline there.
`BindingEditor.tsx` itself only wires the hook's state into its existing save path — no new inline
JSX blocks. Selecting a metric sets `metricId` and switches `MetricBindingFields`' Field/Reduce
controls to read-only, populated from the selected metric's `measureField`/`aggregation`/`format` —
mirroring the backend's own "raw fields win when both present" semantics (`MetricPanel.scala`), so
clearing the metric selection reveals whatever raw `fieldMapping`/`aggregation` was there. `metricId`
threads through `buildBindingPatch` → `updatePanelBinding` (service + thunk gain an optional
`metricId` param, following the existing positional-then-optional-tail convention already used for
`annotation`/`chartOptions`).

**D6 — Chart/Table panels get the same bind-to-metric mode, but with NO read-only-field materialization
UI** (mirroring HEL-500's own backend scope: `metricId` binds/persists on Chart/Table but is never
materialized into `fieldMapping`, since there's no single unambiguous slot). The picker still sets
`metricId`; the existing field-mapping controls stay editable and independent, exactly as the backend
already treats them.

## Risks / Trade-offs

- [`allowedDimensions` multi-select is genuinely new UI, more design risk than the rest of this ticket]
  → keep it a plain checkbox-list-in-a-popover (matching `Select`'s existing portal pattern) rather than
  a novel interaction; defer anything fancier (search, chips) to a follow-up if the skeptic/evaluator
  flags it as needed.
- [422 vs 400 error surfacing requires distinguishing `ServiceError` variants in the UI, not just a
  generic toast] → `extractErrorMessage` already extracts `response.data.message` regardless of status
  code; inline field errors need the create/edit form to read the message text itself (no structured
  per-field error shape exists on the wire) — same constraint every other form in this codebase
  (Pipelines, Sources) already lives with.
- [New `Toggle` primitive could invite scope creep into a full design-system component] → keep it
  minimal (checked/onChange/label/disabled), styled to existing tokens only, no variants beyond what
  the deprecate switch needs.

## Planner Notes

Self-approved: D1 (precedent choice, not a new pattern — now genuinely followed, nav wiring included),
D2 (wording correction only, no behavior change), D3/D4 (both explicitly flagged by the ticket's own
scope as "new" — a multi-select and a toggle — kept minimal and codebase-consistent, not novel
architecture), D5/D6 (mechanical extension of an existing, fully-specified backend contract, now with
an explicit extraction plan — no new decisions the backend hasn't already made). None of these are new
external dependencies, breaking changes, or scope beyond the ticket's own text.

Round 1 design-gate REFUTE (`skeptic-design-1.md`): both required revisions addressed above (D1 nav
wiring, D5 extraction plan); both non-blocking notes (D2 wording, tasks.md 3.3 file-path correction)
also addressed.
