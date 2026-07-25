## 1. ### Backend: expand endpoint

- [x] 1.1 Add `PipelineShapeService.expand(id: String, params: JsObject): Future[Either[ServiceError, Vector[ShapeStepExpansion]]]` (wrap the synchronous `Either` in `Future.successful` — `ServiceResponse.run` requires `Future[Either[ServiceError, A]]`) delegating to `PipelineShape.shapeFor(id).flatMap(_.expand(params))`, mapping an unknown-id `Left` to `ServiceError.NotFound` and an expand-validation `Left` to `ServiceError.UnprocessableEntity`
- [x] 1.2 Add `ExpandPipelineShapeRequest(params: JsObject)` and `ShapeStepExpansionResponse(kind: String, config: JsObject)` wire types + formats in `PipelineShapeProtocol.scala`
- [x] 1.3 Add `POST /api/pipeline-shapes/:id/expand` to `PipelineShapeRoutes.scala` using `entity(as[ExpandPipelineShapeRequest])` + `ServiceResponse.run`, returning the mapped `ShapeStepExpansionResponse` array

## 2. ### Frontend: service + types

- [x] 2.1 Create `frontend/src/features/pipelines/types/pipelineShape.ts` with `ShapeParamDescriptor`, `OutputContract`/`RowCountContract`, `PipelineShapeCatalogEntry`, `ShapeStepExpansion` types matching the wire shapes
- [x] 2.2 Add `getPipelineShapeCatalog()` (`GET /api/pipeline-shapes`) and `expandPipelineShape(shapeId, params)` (`POST /api/pipeline-shapes/:id/expand`) to `pipelineService.ts`

## 3. ### Frontend: shape picker UI

- [x] 3.1 Create `ShapePickerModal.tsx` (+ `.css`): step 1 lists catalog entries (label/description), step 2 renders the generic params form (per `design.md` Decision 5: string/string[]/integer/object[] widgets keyed on `dataType`, fallback to text input), with an inline error banner slot
- [x] 3.2 Wire submit: JSON-parse `object[]` fields client-side (inline error on parse failure, no request sent); call `expandPipelineShape`; on non-2xx, show the response message inline and keep the modal open
- [x] 3.3 On successful expand, sequentially POST each `{kind, config}` via the existing `createPipelineStep` path, appending after current steps; stop and toast on a mid-loop failure (design.md Decision 6), keeping already-created steps
- [x] 3.4 Add a "Start from a shape" control to `PipelineRiverView.tsx` (empty-state and "+ Add" row) opening `ShapePickerModal`, and the corresponding handler (`handleInstantiateShape`) in `PipelineDetailPage.tsx`

## 4. ### Tests

- [x] 4.1 Backend: `PipelineShapeServiceSpec`/`PipelineShapeRoutesSpec` cases for expand success, unknown shape id (404), invalid params (422 with the shape's own message), unauthenticated (401), and route-tree reachability
- [x] 4.2 Frontend: `ShapePickerModal.test.tsx` covering shape selection → params form render (per-dataType widgets) → submit → seeded steps, plus the 422-inline-error and mid-loop-toast failure paths (live-browser equivalent of the HEL-336 empty-default defect check)
- [x] 4.3 Frontend: `pipelineService.test.ts` cases for `getPipelineShapeCatalog`/`expandPipelineShape`
- [x] 4.4 Update/extend `PipelineDetailPage.test.tsx` and `PipelineRiverView` coverage (new file or existing) for the new affordance's presence in both empty-state and non-empty layouts
