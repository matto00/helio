## Why

The Pipeline page still models pipelines as a linear river producing one bound "Output type"
consumed later by panels. The Outputs remodel (HEL-903) makes Outputs first-class nodes with
live previews, placements, and tails — but the page and the panel-binding editor haven't caught
up. This is P1.5: rebuild the page around river+tails, Output chips/gallery, and an Output sheet,
and fold panel binding UI into it as the reusable Output editor.

## What Changes

- River gains an Outputs rail per trunk step (live-thumbnail chips) and indented dashed tails
  ending in an Output chip; branching is refused within a tail.
- New "Outputs (N)" gallery tab: live-rendered Output cards, placement count, Place-on-dashboard.
- New Output side sheet: capabilities-at-node field mapping, per-kind options, live preview,
  placements, Place, Delete. "Add as tail with aggregate" for kinds needing an aggregate.
- **BREAKING (frontend consumer update, not a new break)**: adapt to already-shipped breaking
  wire changes — `expand` returns `{steps, outputs?}`; `DELETE /api/pipeline-steps/:id` returns
  200-with-body.
- "Start from a shape" becomes "Add Outputs from a shape" against a chosen step; `ShapeParamsFields`
  gains forward-compatible enum/fieldRef widget support (HEL-731 **partially** absorbed -- the
  widget half ships, the backend `ShapeParamDescriptor` extension does not, per design.md decision
  13; a follow-up ticket for the descriptor half is filed at delivery time).
- New-pipeline flow: pick existing / paste table / upload CSV or URL / REST connector / text via
  single-call `POST /api/pipelines` (pipeline creation itself; a brand-new source is created first,
  see design.md decision 10), landing on the page with root previewed. Bulk-paste (HEL-723).
- `features/panels/ui/editors/*` is rebuilt as the Output editor; unused files deleted.
- Delete `PipelinePreviewModal`, `ShapeInstantiateStep`, `dataTypeId`/`outputDataTypeName` refs
  in `features/pipelines`.
- Fixes folded in: HEL-676 (mobile OUTPUT bar overlap), HEL-878 (stale "Snapshot replaced" chip —
  run-scoped-state reset enumerated), HEL-681 (out-of-order preview/analyze), HEL-629 (pie/cartesian
  ECharts live-switch crash), HEL-682 (file-size split).

## Capabilities

### New Capabilities
- `pipeline-outputs-rail`: Outputs rail of live-thumbnail chips per trunk step, "+ output" affordance.
- `pipeline-tails-ui`: indented dashed tail sub-chains ending in an Output chip, branch-refusal rule.
- `pipeline-outputs-gallery`: "Outputs (N)" tab, live-rendered cards, placement counts, Place action.
- `pipeline-output-sheet`: side-sheet editor (capabilities-at-node mapping, per-kind options, live
  preview, placements, delete-with-warning, add-tail-with-aggregate).
- `pipeline-new-flow`: unified new-pipeline entry (existing/paste/upload/connector/text), single-call.

### Modified Capabilities
- `pipeline-editor-page`: page structure changes (tabs, header fields, split components).
- `pipeline-shape-instantiation-ui`: shape flow retargets to Output-producing expand against a step.

### Removed Capabilities
- `pipeline-output-type-selector`: DataType concept dropped by HEL-904; superseded by the Output
  sheet's capabilities-at-node mapping UI.

## Impact

`frontend/src/features/pipelines/**`, `frontend/src/features/panels/ui/editors/**` (rebuilt/deleted),
Redux slices for pipelines/outputs/panels, `e2e/` specs referencing the old page, OpenSpec capability
specs listed above. No backend changes expected (routes already shipped in P1.3/P1.4).
