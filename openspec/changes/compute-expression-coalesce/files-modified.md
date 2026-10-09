- `backend/src/main/scala/com/helio/domain/engine/ExpressionEvaluator.scala` — coalesce: SupportedFunctions + checkArity (>= 2), lazy short-circuit evalExpr branch, common-type inference (`coalesceType`)
- `backend/src/main/scala/com/helio/domain/engine/PipelineAnalyzeService.scala` — inferCompute surfaces an inferType Left as the step's validationError (wire-type fallback column kept)
- `backend/src/test/scala/com/helio/domain/engine/ExpressionEvaluatorSpec.scala` — coalesce validate/evaluate/infer/parity tests; supported-function list/size/message assertions updated (10 -> 11)
- `backend/src/test/scala/com/helio/domain/engine/PipelineAnalyzeServiceSpec.scala` — mixed-type validationError + same-type inference cases; list-substring assertion updated
- `backend/src/test/scala/com/helio/domain/steps/ComputeStepSpec.scala` — write-path unknown-function message includes coalesce
- `backend/src/test/scala/com/helio/domain/engine/ComputeCoalesceCsvSpec.scala` — CSV (real CsvLoadSupport loader) blank-cell scenario: concat-only null vs coalesce rejoin
- `docs/compute-expression-grammar.md` — coalesce table row, CSV-blank example, inference rule + analyze-only note, errors example, limitations
- `openspec/changes/compute-expression-coalesce/tasks.md` — tasks ticked

Evidence: /home/matt/Development/helio/.concertino/runs/HEL-1423/evidence/ (red-unit.txt, green-unit.txt, green-testfull.txt, live/)
