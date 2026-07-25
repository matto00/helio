## Backend

- `backend/src/main/scala/com/helio/services/PipelineShapeService.scala` — added `expand(id, params)`, the first HTTP-reachable caller of `PipelineShape.expand` (design.md Decision 4); wraps the synchronous `Either` in `Future.successful` to match `ServiceResponse.run`'s call shape; maps unknown-id → `ServiceError.NotFound`, invalid-params → `ServiceError.UnprocessableEntity`.
- `backend/src/main/scala/com/helio/api/protocols/PipelineShapeProtocol.scala` — added `ExpandPipelineShapeRequest`/`ShapeStepExpansionResponse` wire types + JSON formats for the new endpoint.
- `backend/src/main/scala/com/helio/api/package.scala` — added the two new wire-type aliases so route files can import them via `com.helio.api` (matches every other wire-type's aggregator-re-export pattern).
- `backend/src/main/scala/com/helio/api/routes/PipelineShapeRoutes.scala` — added `POST /pipeline-shapes/:id/expand`, following the `ServiceResponse`/`ServiceError` pattern from `PipelineStepRoutes`.
- `backend/src/test/scala/com/helio/services/PipelineShapeServiceSpec.scala` (new) — service-layer coverage: expand success, unknown shape id → `NotFound`, invalid params → `UnprocessableEntity` with the shape's own message.
- `backend/src/test/scala/com/helio/api/routes/PipelineShapeRoutesSpec.scala` — added HTTP-layer coverage: 200 on success, 404 unknown shape id, 422 invalid params (verbatim shape message).
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — added composed-route-tree coverage: 401 unauthenticated, 200 authenticated end-to-end expand (guards against the same routing-collision class of bug the existing catalog-GET test guards against).

## Frontend

- `frontend/src/features/pipelines/types/pipelineShape.ts` (new) — `ShapeParamDescriptor`, `OutputContract`/`RowCountContract`, `PipelineShapeCatalogEntry`, `ShapeStepExpansion` types mirroring the backend wire shapes.
- `frontend/src/features/pipelines/services/pipelineService.ts` — added `getPipelineShapeCatalog()` and `expandPipelineShape(shapeId, params)`.
- `frontend/src/features/pipelines/services/pipelineService.test.ts` — added coverage for both new service calls, including a non-2xx-propagates-to-caller case.
- `frontend/src/features/pipelines/ui/ShapePickerModal.tsx` (new) — the "Start from a shape" two-step modal: shape list → generic params form (per-`dataType` widget mapping, design.md Decision 5) → expand → hands off to caller's step-seed loop. Never silently swallows a 422/404 or a client-side JSON-parse failure (HEL-336 defect guard).
- `frontend/src/features/pipelines/ui/ShapePickerModal.css` (new) — DESIGN.md-token-only styling for the modal's shape list and params form.
- `frontend/src/features/pipelines/ui/ShapePickerModal.test.tsx` (new) — catalog list rendering, per-`dataType` widget rendering, required-field submit gating, successful submit → `onSeedSteps` handoff, client-side JSON-parse-failure guard, 422/404 inline-error guard.
- `frontend/src/features/pipelines/ui/PipelineRiverView.tsx` — added the "Start from a shape" control to both the empty-state and the "+ Add" row, plus local `shapePickerOpen` state and the `ShapePickerModal` render.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` — added `handleInstantiateShape`, the sequential per-step `createPipelineStep` loop (design.md Decision 6): stops and toasts a visible partial-apply error on a mid-loop failure, never a silent drop.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.css` — styling for the new "Start from a shape" secondary-button recipe (both empty-state and add-step-row placements).
- `frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx` — added a new describe block: affordance presence in both layouts, full seed-and-append flow, mid-loop-failure toast (HEL-336 defect guard at the page level), and 422-stays-open coverage.

## OpenSpec

- `openspec/changes/shape-instantiation-ux/tasks.md` — all tasks marked complete.
