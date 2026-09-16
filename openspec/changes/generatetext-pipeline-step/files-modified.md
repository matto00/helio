## New files

- `backend/src/main/scala/com/helio/domain/steps/GenerateTextConfig.scala` — typed `{inputField, instruction, outputField}` config: tolerant decode, custom format, shared `validate` (design D2)
- `backend/src/main/scala/com/helio/domain/steps/GenerateTextStep.scala` — the `generatetext` step: per-row sequential `foldLeft` over `ctx.aiClient.complete`, six named failure reasons, `companion` for registry wiring (design D1/D3/D4)
- `backend/src/test/scala/com/helio/domain/steps/GenerateTextConfigSpec.scala` — task 1.1: decode/validate coverage (valid, each-empty, all-absent)
- `backend/src/test/scala/com/helio/domain/steps/GenerateTextStepSpec.scala` — tasks 3.1-3.6: success/zero-row/sequential-failure/input/seam/response/engine arms
- `backend/src/test/scala/com/helio/services/pipelines/PipelineAnalyzeGenerateTextSpec.scala` — task 4.1: analyze reports `string-body`, unknown/non-content-field validationErrors, persisted-row 200
- `openspec/changes/generatetext-pipeline-step/` — proposal/design/tasks/spec (this change)

## Modified files

- `backend/src/main/scala/com/helio/domain/model/PipelineStep.scala` — task 2.1: `GenerateTextStep.Kind -> GenerateTextStep.companion` registered in `Registry`; `PipelineStepKind.GenerateText` added (`All` is registry-derived, no separate edit needed)
- `backend/src/main/scala/com/helio/domain/package.scala` — task 2.2: `GenerateTextStep`/`GenerateTextConfig` aliases re-exported into `com.helio.domain`
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineStepConfigCodec.scala` — task 2.3: `encodeConfig` case for `GenerateTextConfig`
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepository.scala` — task 2.3: `rowToDomain` case for `GenerateTextConfig`
- `backend/src/main/scala/com/helio/domain/engine/PipelineAnalyzeService.scala` — task 2.4: `inferGenerateText` (validates config, requires `string`/`string-body` input field, appends `outputField` as `string-body` using the `convertformat` collision pattern); never calls the model
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineAnalyzeProtocol.scala` — task 2.5: `GenerateTextAnalyzeStepResponse` + format + dispatch (write/read)
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineStepProtocol.scala` — task 2.5: `GenerateTextStepResponse` + config format + response format + dispatch (write/read/fromDomain)
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — task 2.5: `toAnalyzeStepResponse` mapping case for `GenerateTextConfig` (~1712)
- `helio-mcp/src/tools/write.ts` — task 2.6: `generatetext` added to `add_pipeline_step`'s op-name list and its own per-op config doc (per-row cost, `string-body` output, `ai-unavailable`/`response-empty` degrade, never auto-run — `ai-step` cost reason). `npm run check:helio-mcp-types` passes.
- `backend/src/test/scala/com/helio/domain/model/PipelineStepSpec.scala` — task 4.3: `PipelineStepKind.All` set (27 kinds), `generateText` fixture added to `allSubtypes`, pattern-match exhaustiveness case added
- `backend/src/test/scala/com/helio/domain/steps/PipelineStepRequiredConfigSpec.scala` — task 4.2: registry size 26→27, exact keySet, `generatetext` added to the empty-`{}`-seed exemption alongside `analyzewithai`, new "generatetext rejects empty seed" case
- `backend/src/test/scala/com/helio/domain/engine/PipelineAnalyzeServiceSpec.scala` — task 4.4: `generatetext` probe added to `probesByKind` (coverage guard passes with `validationError` `None`)
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeRoutesSpec.scala` — task 4.5 (design D8): re-pointed the unregistered-op 500 probe — drops `pipeline_steps_op_check` in this suite's own `EmbeddedPostgres`, inserts `notarealop` instead of `generatetext` (now registered), with the drop's rationale commented inline
- `backend/src/test/scala/com/helio/services/pipelines/PipelineCreateTransactionalSpec.scala` — task 4.6: removed the now-empty `Seq("generatetext")` reject-loop, added an "accept a generatetext step" case mirroring the `analyzewithai` flip
- `openspec/changes/generatetext-pipeline-step/tasks.md` — all tasks marked complete

## Verified unchanged (task 4.7, design D9's seventh surface)

- `backend/src/test/scala/com/helio/api/protocols/pipelines/PipelineStepConfigCodecSpec.scala` — `"every kind tolerates decode({}) without throwing"` iterates `PipelineStepKind.All`; `GenerateTextConfig.decode`'s tolerant defaults satisfy it with no edit. Ran green (part of the `PipelineStepConfigCodecSpec` run below).
- `backend/src/test/scala/com/helio/domain/engine/PipelineCostEstimatorSpec.scala` — already contains `"deny with generatetext as ai-step too"` and the partition test tolerating `AiOps` naming an unregistered-then-registered op; ran green untouched.
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepositorySpec.scala` — iterates `PipelineStepKind.All` inserting `config='{}'` per kind and asserting decode doesn't throw; tolerant decode satisfies it. Ran green untouched (part of the combined run below).
- `schemas/` — grepped for `analyzewithai`/`convertformat`/an op enumeration: zero hits, confirming design's expectation that no schema file enumerates pipeline step ops. `npm run check:schemas` passes.

## Mutation evidence (task 5.1, C5)

Each of `GenerateTextStep`'s six failure-reason string literals was mutated to `"wrong-code"` one at a time (leaving the file otherwise identical), `GenerateTextStepSpec` was re-run, then the file was restored (`diff` confirmed byte-identical to the pre-mutation state) before the next mutation. Every mutation drove the specific test(s) asserting that code red — none passed vacuously:

| Mutated code (→ `"wrong-code"`) | Test(s) driven red | Result |
| --- | --- | --- |
| `field-missing` | "fail with field-missing when the input row lacks the configured inputField", "...when the input field is explicitly null" | 2 FAILED |
| `field-not-string` | "fail with field-not-string when the input field holds a number" | 1 FAILED |
| `ai-unavailable` | "fail with ai-unavailable when the context uses the default (unconfigured) AiStepClient", "the engine should surface a generatetext failure..." | 2 FAILED |
| `ai-guardrail` | "fail with ai-guardrail for an oversized input, making zero transport calls" | 1 FAILED |
| `ai-error` (Api arm) | "fail with ai-error when the transport reports an API status error" | 1 FAILED |
| `ai-error` (Transport arm) | "fail with ai-error when the transport fails at the network/transport level" | 1 FAILED |
| `response-empty` | "fail with response-empty for an empty response...", "...for a whitespace-only response" | 2 FAILED |

(An earlier attempt appending `-X` to each code, e.g. `field-missing-X`, produced a **false negative** — `should include("field-missing")` still matches the mutated substring, so every test stayed green. Recorded here per MISTAKES.md-style "evidence-shaped non-evidence" — the `"wrong-code"` replacement above is the one that actually falsifies the assertion.)

Baseline and post-restore runs: `GenerateTextStepSpec` — 15/15 succeeded, 0 failed.
