## Why

The shape catalog + `expand` (HEL-391/393/394/396/398/402) and the MCP surface (HEL-400) are shipped, but
a human building a panel by hand still has to create a pipeline, hand-add steps, run it, then bind — the
exact toil shapes exist to remove. This ticket closes the HEL-337 epic by wiring shapes into panel
creation: pick a panel type, pick a matching shape, fill its params, get a bound panel.

## What Changes

- **BREAKING: none.** Purely additive UI; no new backend endpoint (reuses `GET /api/pipeline-shapes`,
  `POST /api/pipeline-shapes/:id/expand`, `POST /api/pipelines`, `POST /api/pipeline-steps`,
  `POST /api/pipelines/:id/run` — the same composition HEL-400's MCP tool already uses client-side).
- `PanelCreationModal`'s datatype-select step, for metric/chart/table only, offers a static
  panel-type → shape-id mapping (metric → `single-row`; chart → `time-series`, `top-n`; table →
  `top-n`, `pivot-matrix`) drawn from the live catalog, alongside the existing DataType list.
- Choosing a shape opens a new step: source picker + pipeline name + the shape's params form (widget
  logic extracted from `ShapePickerModal` into a shared `ShapeParamsFields` component, reused by both).
  Submitting runs expand → create pipeline → add steps → run, in that order, each failure shown inline
  and non-silent (the `422`'s message shown verbatim — the HEL-336 defect this design guards against).
  Only a successful run advances to name-entry with the panel bound to the new output DataType.
- No Flyway migration: no persisted panel/pipeline → shape link (see design.md Decision 2).
- Binding sets `dataTypeId` only, matching the existing DataType-select step's behavior exactly —
  `fieldMapping` is left for the user via the existing post-creation editor, not auto-populated.

## Capabilities

### New Capabilities
- `panel-creation-shape-step`: the "start from a shape" sub-flow in panel creation (shape offering,
  params form, instantiate-and-run, failure handling).

### Modified Capabilities
- `panel-creation-datatype-step`: adds the shape-offering affordance for metric/chart/table panel types.

## Non-goals

- No new backend endpoint or persisted shape/panel link (see design.md).
- No `fieldMapping` auto-population — out of scope, a candidate follow-up.
- No changes to `text`/`markdown`/`collection`/`timeline` panel creation (unmapped to any shape).
- No changes to the in-editor shape UX (HEL-402) or MCP surface (HEL-400).

## Impact

- Frontend: `PanelCreationModal.tsx`, `creationSteps/DataTypeSelectStep.tsx`, new
  `creationSteps/ShapeInstantiateStep.tsx`, new shared `pipelines/ui/ShapeParamsFields.tsx` (extracted
  from `ShapePickerModal.tsx`), `sourcesSlice` reuse for the source picker.
- No backend or schema changes.
