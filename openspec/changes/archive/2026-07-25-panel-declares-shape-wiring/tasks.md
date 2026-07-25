## 1. Frontend — shared params-form extraction

- [x] 1.1 Extract `widgetFor` + per-`dataType` form rendering out of `ShapePickerModal.tsx` into a new
      `frontend/src/features/pipelines/ui/ShapeParamsFields.tsx` (props: `paramsSchema`, `values`,
      `onChange`, `idPrefix`), preserving exact current widget behavior (string/string[]/integer/
      object[] + fallback).
- [x] 1.2 Extract `handleSubmit`'s string→typed-value transform loop (`JSON.parse`/comma-split/
      `Number.parseInt`, `ShapePickerModal.tsx` lines ~100-126) into an exported
      `buildShapeParams(paramsSchema, values): { params: Record<string, unknown> } | { fieldError:
      string }` in the same new file, preserving exact current behavior including the `object[]` parse
      failure's error message shape.
- [x] 1.3 Refactor `ShapePickerModal.tsx` to render `ShapeParamsFields` and call `buildShapeParams`
      instead of its inline form JSX and transform loop; confirm `ShapePickerModal.test.tsx` still
      passes unmodified.

## 2. Frontend — panel-type-to-shape mapping and catalog offering

- [x] 2.1 Add `PANEL_TYPE_SHAPES` map (metric→single-row; chart→time-series,top-n;
      table→top-n,pivot-matrix) to a new `frontend/src/features/panels/state/panelShapes.ts`.
- [x] 2.2 Extend `DataTypeSelectStep.tsx` with an `offeredShapes` prop rendering shape cards (label +
      description from the live catalog) below/alongside the existing DataType list, only when
      `offeredShapes` is non-empty; clicking a card calls a new `onSelectShape` prop instead of
      `onSelect`.
- [x] 2.3 Wire `PanelCreationModal.tsx` to fetch the shape catalog (reuse `getPipelineShapeCatalog`)
      once the modal reaches the `datatype-select` step for a data-bound type with a non-empty
      `PANEL_TYPE_SHAPES` mapping (not on every modal open — avoids an unneeded fetch for types like
      `image` that never reach this step), filter it via `PANEL_TYPE_SHAPES[selectedType]`, and pass the
      filtered list into `DataTypeSelectStep`.

## 3. Frontend — shape-instantiate step

- [x] 3.1 Create `frontend/src/features/panels/ui/creationSteps/ShapeInstantiateStep.tsx`: pipeline-name
      field, output-type-name field (required, same validation as `CreatePipelineModal`'s field), data-
      source `Select` (reuse `sourcesSlice`/`fetchSources`), `ShapeParamsFields` for the selected shape,
      submit button, inline error area, granular status label.
- [x] 3.2 Implement the submit handler: `buildShapeParams` → `expandPipelineShape` → `createPipeline`
      (name, sourceDataSourceId, outputDataTypeName from 3.1's fields) → sequential `createPipelineStep`
      per expansion → `runPipeline`; on a `buildShapeParams` field error or any pre-run call failure show
      the error inline and stop (no rollback); on a run failure show the error inline with a "Retry run"
      action that re-calls `runPipeline` only.
- [x] 3.3 On run success, return `{dataTypeId, pipelineId}` to `PanelCreationModal`, which sets
      `selectedDataTypeId` and advances to `name-entry` (no `fieldMapping` set).
- [x] 3.4 Wire `step === "shape-instantiate"` into `PanelCreationModal.tsx`'s step switch, plus Back
      navigation (returns to `datatype-select`, clears in-progress shape state) and dirty-state
      inclusion (matches existing `selectedDataTypeId` dirty check).

## 4. Tests

- [x] 4.1 `ShapeParamsFields.test.tsx` covering both `ShapeParamsFields` rendering and `buildShapeParams`
      (or fold into `ShapePickerModal.test.tsx` coverage) — extraction is behavior-preserving, including
      the `object[]` JSON-parse-failure `fieldError` case; no new widget/transform behavior beyond
      existing coverage.
- [x] 4.2 `DataTypeSelectStep.test.tsx` — shape cards render only for metric/chart/table with the
      correct mapped ids; clicking a card calls `onSelectShape`, not `onSelect`.
- [x] 4.3 `ShapeInstantiateStep.test.tsx` — full-chain success advances with the right `dataTypeId`;
      expand 422 shows the message inline and creates nothing; a create/addStep failure shows an inline
      error and leaves `dataTypeId` unset; a run failure shows "Retry run" and retrying re-calls only
      `runPipeline`.
- [x] 4.4 `PanelCreationModal.test.tsx` — selecting a shape and completing the chain results in a
      `createPanel` dispatch with `dataTypeId` set and no `fieldMapping`; back-navigation from the new
      step returns to `datatype-select`.
- [x] 4.5 Live browser check (per HEL-336 defect guard): exercise the real picker path for at least one
      shape with an initially-empty/default param, confirm the 422 (or equivalent) message is visibly
      shown rather than silently swallowed, and confirm a full happy-path run (e.g. `single-row` →
      metric) produces a panel bound to real rows.
