- `frontend/src/features/pipelines/ui/BoundSourceBar.tsx` — added `canEditSource` / `onEditSource`
  props and an "Edit Source" button, right-aligned in the bar, rendered only when the current user
  owns the bound source.
- `frontend/src/features/pipelines/ui/BoundTypeBar.tsx` — new component (sibling to
  `BoundSourceBar`); read-only display of the pipeline's output DataType name plus an
  ownership-gated "Edit Type" button.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` — added a `fetchDataTypes()`-on-mount
  effect (mirrors the existing `fetchSources()` effect); computed `canEditSource` /
  `boundOutputType` / `canEditType`; added `handleEditSource` / `handleEditType` navigation
  handlers; wired the new props into `BoundSourceBar` and rendered `BoundTypeBar` below it.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.css` — added type-bar container/label/value
  styles (mirroring `__source-bar`), a shared `__edit-btn` class (reuses the `__share-btn` secondary
  button recipe) for both Edit buttons, and made `__source-bar`/`__type-bar` `justify-content:
  space-between` so the buttons sit right-aligned.
- `frontend/src/features/pipelines/ui/BoundSourceBar.test.tsx` — new test file: Edit Source button
  visibility/click behavior.
- `frontend/src/features/pipelines/ui/BoundTypeBar.test.tsx` — new test file: output type name
  render, Edit Type button visibility/click behavior.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx` — added `/sources` and `/registry`
  routes to the test router; extended `makeStore` to preload `dataTypes` state; added a new
  describe block covering Edit Source/Edit Type visibility (owned vs. not-owned), click→dispatch→
  navigate wiring, and the shared-pipeline-without-ownership scenario (both buttons absent).
- `openspec/changes/pipeline-detail-edit-buttons/tasks.md` — marked all tasks complete.
