# Files modified — HEL-623 (remove-output-field-contract)

- `backend/src/main/scala/com/helio/domain/shapes/OutputContract.scala` — deleted `OutputFieldContract`
  and the `fields` member from `OutputContract`; `OutputContract` is now `rowCount` + `description` only.
- `backend/src/main/scala/com/helio/domain/shapes/PassthroughShape.scala` — dropped `fields = Vector.empty`
  from the `outputContract` construction; trimmed the scaladoc's `fields`-specific prose.
- `backend/src/main/scala/com/helio/domain/shapes/SingleRowShape.scala` — dropped `fields = Vector.empty`
  from the `outputContract` construction.
- `backend/src/main/scala/com/helio/domain/shapes/TopNShape.scala` — dropped `fields = Vector.empty` from
  the `outputContract` construction.
- `backend/src/main/scala/com/helio/domain/shapes/TimeSeriesShape.scala` — dropped `fields = Vector.empty`
  from the `outputContract` construction.
- `backend/src/main/scala/com/helio/domain/shapes/PivotMatrixShape.scala` — dropped `fields = Vector.empty`
  from the `outputContract` construction.
- `backend/src/main/scala/com/helio/api/protocols/PipelineShapeProtocol.scala` — removed
  `OutputFieldContractResponse` (type + companion + json format) and dropped `fields` from
  `OutputContractResponse`/`OutputContractResponse.fromDomain`/`outputContractResponseFormat`
  (`jsonFormat3` → `jsonFormat2`).
- `backend/src/main/scala/com/helio/api/package.scala` — removed the `OutputFieldContractResponse`
  type/val aliases (the response type no longer exists).
- `backend/src/test/scala/com/helio/domain/shapes/SingleRowShapeSpec.scala` — dropped the
  `outputContract.fields shouldBe empty` assertion.
- `backend/src/test/scala/com/helio/domain/shapes/TopNShapeSpec.scala` — dropped the
  `outputContract.fields shouldBe empty` assertion.
- `backend/src/test/scala/com/helio/domain/shapes/TimeSeriesShapeSpec.scala` — dropped the
  `outputContract.fields shouldBe empty` assertion.
- `backend/src/test/scala/com/helio/domain/shapes/PivotMatrixShapeSpec.scala` — dropped the
  `outputContract.fields shouldBe empty` assertion.
- `backend/src/test/scala/com/helio/api/routes/PipelineShapeRoutesSpec.scala` — dropped the
  `passthrough.outputContract.fields shouldBe empty` assertion on the catalog response.
- `schemas/pipeline-shape-catalog.schema.json` — removed the `fields` property from
  `outputContract.properties` and from `outputContract.required` (kept `additionalProperties: false`,
  so a stray `fields` on the wire would now fail schema validation).
- `frontend/src/features/pipelines/types/pipelineShape.ts` — removed the `OutputFieldContract` interface
  and the `fields` member from `OutputContract`.
- `frontend/src/features/panels/state/useShapeOffering.test.tsx` — dropped `fields: []` from mock
  `outputContract` fixtures.
- `frontend/src/features/panels/ui/PanelCreationModal.test.tsx` — dropped `fields: []` from the
  `outputContract` fixture (left unrelated `DataType.fields` fixtures untouched).
- `frontend/src/features/panels/ui/creationSteps/DataTypeSelectStep.test.tsx` — dropped `fields: []` from
  `outputContract` fixtures.
- `frontend/src/features/panels/ui/creationSteps/ShapeInstantiateStep.test.tsx` — dropped `fields: []`
  from the `outputContract` fixture.
- `frontend/src/features/pipelines/services/pipelineService.test.ts` — dropped `fields: []` from the mock
  catalog response fixture.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx` — dropped `fields: []` from the
  `outputContract` fixture (left unrelated step-`config.fields` fixtures untouched).
- `frontend/src/features/pipelines/ui/ShapePickerModal.test.tsx` — dropped `fields: []` from
  `outputContract` fixtures.
- `helio-mcp/src/types.ts` — removed the `OutputFieldContractResponse` interface and the `fields` member
  from `OutputContractResponse`.
- `helio-mcp/src/helioApi.ts` — trimmed the `listPipelineShapes` doc comment's `outputContract.fields`
  reference.
- `helio-mcp/src/tools/read.ts` — trimmed the `list_pipeline_shapes` tool description's
  `outputContract.fields` reference.
- `helio-mcp/scripts/verify.ts` — dropped the `fields` field from the parsed shape-catalog type and its
  console output line in the manual verify script.

No shape's `expand`, validation, or output rows changed. `rowCount` and `description` semantics are
untouched throughout.
