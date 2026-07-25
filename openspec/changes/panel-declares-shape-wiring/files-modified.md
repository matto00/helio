## Files modified

- `frontend/src/features/pipelines/ui/ShapeParamsFields.tsx` — new shared component extracted from
  `ShapePickerModal.tsx` (design.md Decision 6): `ShapeParamsFields` (params-form rendering, one widget
  per `paramsSchema` entry's `dataType`) + exported `buildShapeParams` (submit-time string→typed-value
  transform), reused by both `ShapePickerModal` and the new `ShapeInstantiateStep`.
- `frontend/src/features/pipelines/ui/ShapeParamsFields.css` — styles for the extracted field/label/hint
  markup (moved out of `ShapePickerModal.css`).
- `frontend/src/features/pipelines/ui/ShapeParamsFields.test.tsx` — new tests for both the rendering
  half and `buildShapeParams`, including the `object[]` JSON-parse-failure case.
- `frontend/src/features/pipelines/ui/ShapePickerModal.tsx` — refactored to render `ShapeParamsFields`
  and call `buildShapeParams` instead of its inline form JSX/transform loop (behavior-preserving —
  `ShapePickerModal.test.tsx` passes unmodified).
- `frontend/src/features/pipelines/ui/ShapePickerModal.css` — removed the field/label/hint rules now
  owned by `ShapeParamsFields.css`.
- `frontend/src/features/panels/state/panelShapes.ts` — new `PANEL_TYPE_SHAPES` map (metric→single-row;
  chart→time-series,top-n; table→top-n,pivot-matrix) + `shapesForPanelType` helper (design.md Decision 4).
- `frontend/src/features/panels/state/panelShapes.test.ts` — unit tests for the mapping.
- `frontend/src/features/panels/state/useShapeOffering.ts` — new hook: lazily fetches the shape catalog
  once the datatype-select step is reached for a panel type with a non-empty mapping, and filters it to
  the offered ids. Extracted out of `PanelCreationModal.tsx` to keep that shell file within the
  file-size soft budget.
- `frontend/src/features/panels/state/useShapeOffering.test.tsx` — unit tests for the hook (gating,
  filtering, fetch-once, error surfacing).
- `frontend/src/features/panels/ui/creationSteps/DataTypeSelectStep.tsx` — extended with `offeredShapes`
  / `shapeCatalogError` / `onSelectShape` props: renders shape cards (label + description from the live
  catalog) above the existing DataType list; a shape-card click diverges entirely from the existing
  DataType-selection path.
- `frontend/src/features/panels/ui/creationSteps/DataTypeSelectStep.test.tsx` — new tests for the shape
  cards (rendering, empty/error states, `onSelectShape` vs `onSelect` divergence).
- `frontend/src/features/panels/ui/creationSteps/ShapeInstantiateStep.tsx` — new step: pipeline-name +
  output-type-name + data-source picker + the shared `ShapeParamsFields` form; submit composes
  `buildShapeParams` → `expandPipelineShape` → `createPipeline` → sequential `createPipelineStep` →
  `runPipeline`, with every pre-run failure shown inline verbatim (HEL-336 defect guard) and a
  run-failure-only "Retry run" affordance (design.md Decision 5). On success, returns `{dataTypeId,
  pipelineId}` to the caller — `fieldMapping` is never set (design.md Decision 3).
- `frontend/src/features/panels/ui/creationSteps/ShapeInstantiateStep.css` — styles for the new step.
- `frontend/src/features/panels/ui/creationSteps/ShapeInstantiateStep.test.tsx` — new tests covering the
  full chain success path, each pre-run failure mode, and the run-failure "Retry run" path.
- `frontend/src/features/panels/ui/PanelCreationModal.tsx` — wires `shape-instantiate` into the step
  machine (`Step` union, `handleSelectShape`/`handleBackFromShapeInstantiate`/
  `handleShapeInstantiateComplete`, `useShapeOffering` call, render branch); Back navigation and
  dirty-state inclusion match the existing `selectedDataTypeId` precedent.
- `frontend/src/features/panels/ui/PanelCreationModal.css` — new `.panel-creation-modal__shape-*` rules
  for the shape-card section on the datatype-select step.
- `frontend/src/features/panels/ui/PanelCreationModal.test.tsx` — new "shape flow" describe block
  (shape offering, shape-instantiate navigation, full-chain `createPanel` dispatch with `dataTypeId` set
  and no `fieldMapping`) + a module-level `getPipelineShapeCatalog` mock (default: empty catalog) so
  pre-existing tests stay free of real network calls.
- `e2e/hel399-shape-instantiate.spec.ts` — new Playwright live-verification spec (mirrors
  `e2e/auth-cookie-migration.spec.ts`'s pattern; run on demand via `npm run e2e`, not a pre-commit gate).
  Exercises the real picker path against running dev servers: an invalid required param surfaces the
  backend's 422 message inline (HEL-336 defect guard), and a full happy-path `single-row` → metric
  instantiate-and-run produces a real panel bound to real rows.
- `openspec/changes/panel-declares-shape-wiring/tasks.md` — all 15 tasks marked complete.

## Root-cause notes (systematic-debugging law)

No bug fixes were required in this change (pure new-feature wiring + a behavior-preserving extraction
refactor verified against the pre-existing `ShapePickerModal.test.tsx` suite, which passes unmodified).
