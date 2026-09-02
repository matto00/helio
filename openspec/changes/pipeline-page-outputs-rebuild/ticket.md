# HEL-908: P1.5 — Pipeline page: river with tails, Output chips + gallery tab, Output sheet with live previews, inline source creation

## Description

Row P1.5 of HEL-903 (Pipelines & Outputs remodel epic). Spec section *Pipeline page UX*, decisions 4, 7, 14. Rebuild `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx`'s river (`PipelineRiverView`/`StepCard`), add tails, an Outputs rail of live-thumbnail chips per trunk step, an "Outputs (N)" gallery tab, an Output side sheet driven by capabilities-at-node with live previews, and inline source creation (pick existing / paste a table / upload CSV or URL / REST connector / text-markdown) via the single-call `POST /api/pipelines`.

Binding UI in `features/panels/ui/editors/BindingEditor.tsx` (+ ChartAggregationFields, TableDisplayFields, ChartDisplayFields, useBoundOrLiteralState, useMetricBindingState, MetricPicker, MetricBindingFields) moves here as the Output editor. **This ticket owns every file under `features/panels/ui/editors/`** — rebuild what is reused, delete what is not. P1.6 (HEL-909) runs after this ticket and must not touch that directory.

DESIGN.md is binding. Use shared primitives from HEL-725 (PageShell/PageHeader/PageStatus, `frontend/src/shared/ui/`) and the shared source-form base from HEL-720. The UI final gate must actually drive the running app via Playwright.

Merged predecessors on main: P1.1 HEL-904 (2ec2a5bc), P1.2 HEL-905 (666db9f8), P1.3 HEL-906 (cc4cf679), P1.4 HEL-907 (e8bb4396). Spec at `docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md` wins over the ticket wherever they disagree.

## Inherited backend surface (verify each)

- `GET /api/outputs/:id/rows` (paginated)
- `POST /api/pipelines/:id/preview` with **optional** `outputId`, same envelope `{outputs:[{outputId, preview}]}` both arms
- `GET /api/pipelines/:id/capabilities?stepId=`
- `GET /api/outputs/:id/assertion-status`
- `POST /api/pipelines/:id/validate-expression?stepId=`
- `GET /api/outputs` (lean paginated)
- BREAKING: `POST /api/pipeline-shapes/:id/expand` now returns `{steps, outputs?}` not a bare array (HEL-934 tracks stale consumers — close the frontend share here)
- BREAKING: `DELETE /api/pipeline-steps/:id` now returns 200-with-body not 204
- HEL-936: ~18 frontend files still call dead `GET /api/types` — take `PipelineDetailPage`'s share here, leave the rest, say which taken
- spray-json omits `Option = None` rather than `null` — treat `outputs?`/`nodeStepId?`/`parentStepId?` as possibly ABSENT in TS, never `=== null`

## Scope

* River: trunk steps as today; each step card gets an Outputs rail (chips: kind badge, name, live thumbnail — metric value, sparkline-sized chart, table skeleton — from the last dry/live run's per-Output rows) and a "+ output" chip; a tail renders as an indented dashed mini-chain under its parent step ending in its Output chip. Drag-reorder/insert/duplicate/enable-disable keep working on trunk and tails; editor refuses branching within a tail.
* Outputs tab: gallery of every Output rendered live (ECharts/DataGrid/metric renderers reused from panels), "off <step>" subtitle, "on N dashboards", Place on dashboard (dashboard picker; `POST /api/panels`), "+ New output" (asks which step).
* Output sheet (side sheet from chip or card): kind, name, field-mapping slots from `GET /api/pipelines/:id/capabilities?stepId=`, per-kind options (chart type/axes/legend, collection layout, timeline sort, table columns/density, markdown template for `markdown` kind — decision 14, number `format` for metric), live preview from `POST /api/pipelines/:id/preview?outputId=`, placements list with links, Place, Delete (warns with placement count). Kinds needing an aggregate the node lacks offer "add as tail with an aggregate step" — inserts a real `aggregate` step; Output stays render-only.
* Shapes: "Start from a shape" becomes "Add Outputs from a shape" against a chosen step (`expand` with `parentStepId` + `outputs[]`). Extend `ShapeParamDescriptor` with enum/fieldRef metadata so `ShapeParamsFields` renders proper widgets (absorbs HEL-731); top-N-per-group (HEL-621) and time-series gap-fill (HEL-622) are NOT absorbed — remain their own tickets, retargeted and blocked on this one.
* New pipeline flow: pick existing source · paste a table · upload CSV (or URL) · REST via connector + endpoint · text/markdown; single-call `POST /api/pipelines`; lands on page with root previewed. Bulk-paste for manual rows is the "paste a table" path (absorbs HEL-723 — AC, not optional).
* Header: "Output type" link gone; shows source, schedule, run status, Outputs count.
* Split `PipelineDetailPage.tsx`/`StepCard.tsx` into hooks/op-editor ladder (absorbs HEL-682); fix mobile OUTPUT bar overlap at 375px (HEL-676), persistent "Snapshot replaced" chip (HEL-878 — enumerate every piece of run-scoped state and what resets it, in the PR; unify Redux-side and SSE-side reset paths), out-of-order preview/analyze responses (HEL-681) must not exist in rebuilt page; pie→cartesian ECharts crash (HEL-629) fixed in Output editor's live-switch path.
* Delete `PipelinePreviewModal` (replaced by per-Output previews), `ShapeInstantiateStep`, every `dataTypeId`/`outputDataTypeName` reference in `features/pipelines`.

## Acceptance criteria

- [ ] Playwright: create pipeline from pasted table, add filter, add metric Output via "add as tail with aggregate", add chart Output on trunk, dry-run, see three live thumbnails, open Output sheet and see preview — all on one page; interaction count recorded in PR.
- [ ] Jest: river renders tails under correct parent; Outputs rail shows one chip per Output on that node; Output sheet slot options come from capabilities-at-node; live-switch pie <-> bar does not throw (HEL-629).
- [ ] HEL-676/HEL-878/HEL-681 reproductions re-run against rebuilt page and pass (cite repro steps in PR).
- [ ] Mobile (375px/430px) layout of river + rail + sheet meets >=44px touch-target floor and existing e2e mobile guards.
- [ ] Paste-a-table creates static source with pasted rows (HEL-723); run-scoped-state enumeration for HEL-878 is in the PR.
- [ ] E2E specs exercising old page (grep e2e/ for PipelinePreviewModal, ShapeInstantiateStep, /registry) rewritten or deleted; OpenSpec capability specs for pipeline editor/shapes/preview updated or removed (list in PR); check:openspec green.
- [ ] npm run lint/typecheck/test green; no file over ~400-line guidance without stated reason; no dataTypeId in features/pipelines or features/panels/ui/editors.

## Out of scope

Dashboard picker and panel sheet (P1.6); parallel lanes (P2.2).

## Dependencies

Blocked by P1.3 (HEL-906), HEL-725, HEL-720, P1.4 (HEL-907) — all merged on main. Blocks P1.6 (HEL-909), P1.7 (HEL-910).
