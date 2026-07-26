## 1. Backend: domain model

- [x] 1.1 In `backend/src/main/scala/com/helio/domain/shapes/OutputContract.scala`, delete
      `OutputFieldContract` entirely and remove `fields: Vector[OutputFieldContract]` from
      `OutputContract`, leaving `rowCount: RowCountContract` and `description: String`. Update the
      scaladoc to drop the `fields`-specific prose.

## 2. Backend: shapes

- [x] 2.1 Update `PassthroughShape.scala`, `SingleRowShape.scala`, `TopNShape.scala`,
      `TimeSeriesShape.scala`, `PivotMatrixShape.scala` (all in
      `backend/src/main/scala/com/helio/domain/shapes/`) to drop the `fields = Vector.empty` argument
      from each `outputContract` construction. No other change to any of these files.
- [x] 2.2 Check `PipelineShape.scala` for any reference to `OutputFieldContract`/`fields` (e.g. in
      shared trait doc or helper) and remove it.

## 3. Backend: wire format

- [x] 3.1 Update `backend/src/main/scala/com/helio/api/protocols/PipelineShapeProtocol.scala` (and
      `backend/src/main/scala/com/helio/api/package.scala` if it also references the format) to stop
      serializing `fields` on `OutputContract` — remove the `OutputFieldContract` JSON format and drop
      `fields` from the `OutputContract` format's field list.
- [x] 3.2 Check `PipelineShapeService.scala` for any reference to `fields`/`OutputFieldContract` and
      remove it.

## 4. Contracts

- [x] 4.1 Update `schemas/pipeline-shape-catalog.schema.json`: remove the `fields` property from
      `outputContract.properties` and from `outputContract.required`. Leave `rowCount` and
      `description` untouched.
- [x] 4.2 Confirm `openspec/specs/pipeline-shape-registry/spec.md` will be updated to the delta in
      `openspec/changes/remove-output-field-contract/specs/pipeline-shape-registry/spec.md` at archive
      time (no manual edit needed pre-archive — this task is a checkpoint, not an action).

## 5. MCP surface

- [x] 5.1 Grep `helio-mcp/src/` (`helioApi.ts`, `types.ts`, `context.ts`, `tools/read.ts`) and
      `helio-mcp/README.md` / `helio-mcp/scripts/verify.ts` for `fields` in an `OutputContract`/catalog
      type context. Remove any `fields` property from TypeScript interfaces mirroring the catalog
      response, and any doc/verify-script reference. Leave `rowCount`/`description` fields untouched.

## 6. Frontend

- [x] 6.1 Grep `frontend/src/features/pipelines/types/pipelineShape.ts` and
      `frontend/src/features/pipelines/services/pipelineService.ts` (and any other non-test file under
      `frontend/src/features/pipelines/` and `frontend/src/features/panels/`) for a `fields` property on
      an output-contract/catalog type. Remove it if present.
- [x] 6.2 Check the shape-picker/instantiate UI components (`ShapePickerModal`,
      `ShapeInstantiateStep`, `DataTypeSelectStep`, `PanelCreationModal`) for any rendering or reference
      of `outputContract.fields`. Remove if present; no behavior change expected since the epic never
      wired this up (HEL-399 confirmed as its closing finding).

## 7. Tests

- [x] 7.1 Update `backend/src/test/scala/com/helio/domain/shapes/{TopNShapeSpec,SingleRowShapeSpec,
      PivotMatrixShapeSpec,TimeSeriesShapeSpec}.scala` to drop the removed `fields` argument/assertion
      from `OutputContract` construction/equality checks. No other test assertions should need to
      change — if they do, stop and ask why before proceeding.
- [x] 7.2 Update `backend/src/test/scala/com/helio/api/routes/PipelineShapeRoutesSpec.scala` to drop
      any `fields` assertion on the catalog response JSON.
- [x] 7.3 Update the frontend test files referencing shape/catalog fixtures
      (`useShapeOffering.test.tsx`, `PanelCreationModal.test.tsx`, `ShapeInstantiateStep.test.tsx`,
      `DataTypeSelectStep.test.tsx`, `PipelineDetailPage.test.tsx`, `ShapePickerModal.test.tsx`,
      `pipelineService.test.ts`) to drop `fields` from any mock `outputContract` fixture object. No
      assertion behavior should change beyond removing the now-nonexistent field from fixtures.
- [x] 7.4 Run `sbt test` (backend) and `npm test` (frontend) and confirm the full existing suite passes
      unchanged in behavior (only fixture/construction edits, no new/removed test cases).
- [x] 7.5 Confirm the repo's schema-drift check passes (see `CLAUDE.md`/`CONTRIBUTING.md` for the
      command) now that the catalog schema and backend wire format agree.
