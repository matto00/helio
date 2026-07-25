## Why

HEL-391/393/394/396/398 shipped a full backend shape catalog (`passthrough`, `single-row`, `top-n`,
`time-series`, `pivot-matrix`) but no human-facing way to use it — a pipeline author still hand-builds
every step. This ticket wires the catalog into the pipeline editor so a user can pick a shape, fill its
params, and get a fast, editable starting point instead of authoring steps from scratch.

## What Changes

- **BREAKING: none.** Purely additive UI + one new additive backend endpoint.
- Backend: add `POST /api/pipeline-shapes/:id/expand` — the first HTTP caller of `PipelineShape.expand`
  (HEL-391 deliberately left `expand` unexposed pending a real consumer; this is that consumer). Thin
  `PipelineShapeService.expand(id, params)` delegates to `PipelineShape.shapeFor(id).flatMap(_.expand(params))`;
  404 for an unknown shape id, 422 (`ServiceError.UnprocessableEntity`) with the shape's own message on
  invalid params, 200 with the `ShapeStepExpansion` list on success.
- Frontend: `pipelineService.ts` gains `getPipelineShapeCatalog()` and `expandPipelineShape(shapeId, params)`.
- Frontend: a "Start from a shape" affordance in the pipeline editor (`PipelineRiverView`, both the
  empty-state and the "+ Add" row) opens a two-step modal — pick a shape, fill a generic params form
  driven by `paramsSchema` — and on submit, expands the shape server-side and sequentially POSTs the
  returned steps via the existing `createPipelineStep` path, appending them after any existing steps.
- Seeded steps are ordinary `Step`s with no shape provenance recorded — they render, edit, and preview
  through the unmodified `StepCard`/`OP_TYPES` machinery (AC: "no special-casing downstream").
- A failed expand (422) or a failed step-create surfaces as a visible, non-silent toast/inline error —
  the HEL-336 lookup-picker defect (empty-default POST silently swallowed) is the explicit failure mode
  this design guards against.

## Capabilities

### New Capabilities

- `pipeline-shape-instantiation-ui`: the "Start from a shape" picker + params form + step-seeding
  behavior in the pipeline editor.

### Modified Capabilities

- `pipeline-shape-registry`: adds the `POST /api/pipeline-shapes/:id/expand` requirement (new
  endpoint, same route/service files as the existing catalog GET).

## Non-goals

- Panel-declares-shape and MCP/agent surfaces (HEL-399/HEL-400).
- Retaining a persisted link from a seeded step back to its originating shape (seeded steps are plain,
  independent steps — see design.md Decision 2).
- A fully schema-validating, per-field-type param form generator (`paramsSchema` is descriptive
  metadata only, per HEL-391; real validation stays server-side in `expand`).
- Rendering `outputContract.fields` (empty for every shape today).

## Impact

- Backend: `PipelineShapeRoutes.scala`, `PipelineShapeService.scala`, a new
  `ExpandPipelineShapeRequest`/`ShapeStepExpansionResponse` wire pair in `PipelineShapeProtocol.scala`.
- Frontend: `pipelineService.ts`, a new `types/pipelineShape.ts`, a new `ShapePickerModal.tsx` (+ params
  sub-form), `PipelineRiverView.tsx`, `PipelineDetailPage.tsx` (new handler).
- No Flyway migration; no change to existing step CRUD wire shapes.
