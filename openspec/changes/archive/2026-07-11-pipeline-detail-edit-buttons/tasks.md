## 1. Frontend

- [x] 1.1 Add `fetchDataTypes()`-on-mount effect to `PipelineDetailPage.tsx` (mirrors the existing
      `fetchSources()` effect), guarded by `dataTypes.status === "idle"`.
- [x] 1.2 Compute `boundSource`-derived `canEditSource` (already have `boundSource`) and a new
      `boundOutputType`/`canEditType` derived from `dataTypes.items.find(dt => dt.id ===
      currentPipeline?.outputDataTypeId)` in `PipelineDetailPage.tsx`.
- [x] 1.3 Add `handleEditSource` (`dispatch(setSelectedSourceId(boundSource.id))` then
      `navigate("/sources")`) and `handleEditType` (`dispatch(setSelectedTypeId(outputDataTypeId))`
      then `navigate("/registry")`) handlers in `PipelineDetailPage.tsx`.
- [x] 1.4 Extend `BoundSourceBar.tsx`: accept `onEditSource: () => void` and `canEditSource: boolean`
      props; render an "Edit Source" button (reusing the `share-btn` secondary-button recipe) when
      `canEditSource` is true, right-aligned in the bar.
- [x] 1.5 Create `BoundTypeBar.tsx` (new file, sibling to `BoundSourceBar.tsx`): props
      `outputTypeName: string`, `canEditType: boolean`, `onEditType: () => void`; same visual
      structure as `BoundSourceBar` (label + value + right-aligned "Edit Type" button).
- [x] 1.6 Render `<BoundTypeBar />` directly below `<BoundSourceBar />` in `PipelineDetailPage.tsx`,
      wired to the new props/handlers.
- [x] 1.7 Add CSS to `PipelineDetailPage.css`: type-bar container (mirrors `__source-bar`), label,
      value, and a shared `__edit-btn` class (reuse the `__share-btn` recipe) for both Edit buttons;
      update `__source-bar` layout so the button sits right-aligned (flex `justify-content:
      space-between` or equivalent).

## 2. Tests

- [x] 2.1 `BoundSourceBar` (new or extended test file): Edit Source button renders when
      `canEditSource` is true and calls `onEditSource` on click; absent when false.
- [x] 2.2 `BoundTypeBar` (new test file): renders output type name; Edit Type button renders when
      `canEditType` is true and calls `onEditType` on click; absent when false.
- [x] 2.3 `PipelineDetailPage.test.tsx`: add cases — Edit Source visible/hidden based on
      `sources.items` match; Edit Type visible/hidden based on `dataTypes.items` match; clicking each
      button dispatches the correct `setSelected*Id` action and navigates to the correct route.
- [x] 2.4 `PipelineDetailPage.test.tsx`: shared-pipeline scenario — pipeline has an `ownerId` other
      than the current user (or is reached via a sharing grant) and the bound source/type are absent
      from the current user's `sources.items`/`dataTypes.items` — both Edit buttons are absent.
