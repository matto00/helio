- `backend/src/main/scala/com/helio/domain/engine/PipelineAnalyzeService.scala` — reduced to the DAG walk, `stepConfigProblem` (delegates to `StepConfigValidation`), and the `inferOutputSchema` forwarder
- `backend/src/main/scala/com/helio/domain/engine/SchemaField.scala` — `SchemaField` moved verbatim
- `backend/src/main/scala/com/helio/domain/engine/StepConfigValidation.scala` — `validateStepConfig` + 8 validators moved verbatim
- `backend/src/main/scala/com/helio/domain/engine/StepSchemaInference.scala` — `inferOutputSchema` dispatch + `parseConfig` moved verbatim
- `backend/src/main/scala/com/helio/domain/engine/ColumnSchemaInference.scala` — select/rename/cast/compute/aggregate/groupby inference moved verbatim
- `backend/src/main/scala/com/helio/domain/engine/TextSchemaInference.scala` — convertformat/analyzewithai/generatetext/splittext/extractheadings/chunkbytokencount inference moved verbatim
- `backend/src/main/scala/com/helio/domain/engine/ReshapeSchemaInference.scala` — datebucket/pivot/window/unpivot/stringops/assert inference moved verbatim
- `backend/src/main/scala/com/helio/domain/engine/MultiInputSchemaInference.scala` — lookup/union/join inference moved verbatim
- `backend/src/main/scala/com/helio/domain/engine/README.md` — Holds list updated
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineAnalyzeProtocol.scala` — HEL-1279 nit: over-long comment line reflowed (words unchanged)
- `backend/src/main/scala/com/helio/services/pipelines/AutoRunTriggerService.scala` — HEL-1279 nit: over-long comment line reflowed (words unchanged)
- `backend/src/test/scala/com/helio/services/pipelines/AutoRunTriggerServiceSpec.scala` — HEL-1279 nit: import selectors sorted (only test change)

Evidence: `move-evidence.md`, `api-evidence.md`, `test-count-evidence.md` in this change dir.

## Follow-up candidates (found, NOT fixed)
- Doc comments in other files still name moved members as `PipelineAnalyzeService.inferCompute`/`inferAggregate`/`inferJoin`/`inferConvertFormat`/`inferGroupBy`/`inferAnalyzeWithAi`/`validateStepConfig` (ExpressionEvaluator, PipelineService, model.scala, JoinColumnNaming, ConvertFormatStep, GroupByStep, AnalyzeWithAiConfig, PipelineStep) and `SchemaField`'s own doc names `PipelineAnalyzeService.inferAggregate`; they now point at the entry point, not the definition. Left unedited per design D6e.
- `scala.util.Try` inline FQN remains in `MultiInputSchemaInference.inferJoin` (moved byte-identical; not flagged by check:scala-quality).
- Several base docs (e.g. `inferOutputSchema` forwarder's HEL-872 comment) describe `inferOutputSchema` as widened only for the coverage guard; it is now also called by the forwarder's callee chain. Cosmetic.
