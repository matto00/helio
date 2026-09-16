## Standing Constraints

- [C1] Do not implement tier gating / `HELIO_BETA_DAILY_MESSAGE_LIMIT` (HEL-1108); keep `AiStepClient.complete` the single model call point and name HEL-1108 there. Leave `AiStepRequest.ownerUserId` as `None` — do not thread run ownership.
- [C2] Owner-ruled: no `content` slot on `OutputBindingSpec.Markdown`, no `PanelContent` change, no fix for the markdown bound-Content defect. Narrative rendering is HEL-921's.
- [C3] Owner-ruled: per-row only — one model call per row, no N-to-1 collapse, and no mode toggle for one.
- [C4] `PipelineCostEstimator.AiOps` unchanged; no migration; no step card (HEL-1109) or op palette (HEL-1136).
- [C5] Tests make zero network calls: a fake `AiStepClient`, or a fake `ClaudeTransport` behind the real `ClaudeClient`. Every failure arm is proven failable by a recorded mutation.
- [C6] Token budget stays with `ClaudeClient`'s existing clamps — never re-implemented. Registry-enumerating probes are re-pointed, never deleted.

### Backend

## 1. Config and step

- [x] 1.1 Add `GenerateTextConfig` (tolerant `decode` defaulting all keys to `""`, custom `format`, shared `validate` requiring non-empty `inputField`/`instruction`/`outputField` per design D2) and verify `GenerateTextConfigSpec` covers valid, each-empty, and all-keys-absent cases
- [x] 1.2 Add `GenerateTextStep` with `Kind = "generatetext"`, per-row sequential `foldLeft` over `ctx.aiClient.complete` mirroring `AnalyzeWithAiStep.apply` (design D1), and verify order and one-call-per-row in `GenerateTextStepSpec`
- [x] 1.3 Implement the `fail(code, detail)` helper and all six reason codes from design D4 (`field-missing`, `field-not-string`, `ai-unavailable`, `ai-guardrail`, `ai-error`, `response-empty`), writing `outputField` only after the non-blank check, and verify each code is reachable
- [x] 1.4 Add the step `companion` (`decodeConfig`/`encodeConfig`/`readFromWire`/`writeToWire`, `validateRawConfig` with the `strictDecodeProblem` + `Try` guard, `requiredConfigProblems` sharing `validate`) and verify `validateRawConfig("\"not-an-object\"")` names the kind

## 2. Registration

- [x] 2.1 Register `GenerateTextStep.Kind -> GenerateTextStep.companion` in `PipelineStep.Registry` and add `PipelineStepKind.GenerateText`; verify `PipelineStepKind.All` contains `generatetext`
- [x] 2.2 Add `domain/package.scala` aliases for `GenerateTextStep`/`GenerateTextConfig` and verify the tree compiles with no fully-qualified names at use sites
- [x] 2.3 Add the `PipelineStepConfigCodec` encode case and the `PipelineStepRepository.rowToDomain` case; verify a persisted row decodes instead of throwing `IllegalStateException`
- [x] 2.4 Add `inferGenerateText` to `PipelineAnalyzeService` per design D6 (validate config, require `inputField` present and `string`/`string-body`, emit `outputField` as `string-body` using the `convertformat` collision pattern) and verify it never calls the model
- [x] 2.5 Add `GenerateTextAnalyzeStepResponse` to `PipelineAnalyzeProtocol` plus its `PipelineService` (~1712) mapping case, and `GenerateTextStepResponse` to `PipelineStepProtocol`; verify both wire round-trips
- [x] 2.6 Add `generatetext` to helio-mcp `write.ts` `add_pipeline_step` op-name list and per-op config docs (per-row cost, `string-body` output, `ai-unavailable` degrade, never auto-run) and verify `npm run check:helio-mcp-types`
- [x] 2.7 Search `schemas/` for an op enumeration (none found for `analyzewithai`/`convertformat`); edit only if one exists, record the result, and verify `npm run check:schemas` passes

### Tests

## 3. Step behavior

- [x] 3.1 Success arms via a fake `AiStepClient`: response text lands in `outputField`; other fields pass through; `outputField` overwrites a colliding input column; multi-row order preserved with exactly one call per row
- [x] 3.2 Zero-row input makes zero calls and yields zero rows; a failure on row 2 of 3 issues no call for row 3
- [x] 3.3 Input arms: `field-missing` (absent and explicit null), `field-not-string` (numeric cell)
- [x] 3.4 Seam arms: `ai-unavailable` from the default `AiStepClient.Unavailable` context; `ai-guardrail` from an oversized input through the real `ClaudeClient` over a fake `ClaudeTransport`, asserting zero transport calls; `ai-error` from an API status and from a transport failure
- [x] 3.5 `response-empty` for an empty and a whitespace-only response, asserting `outputField` is not written
- [x] 3.6 Engine-level: the reason code surfaces verbatim through `StepExecutionException` and no rows are materialized

## 4. Analyze and registration drift

- [x] 4.1 Analyze: `outputField` reported as `string-body`; unknown `inputField` and non-content `inputField` each produce a `validationError` with 200; persisted-row analyze returns 200 (follow `PipelineAnalyzeConvertFormatSpec`)
- [x] 4.2 Update `PipelineStepRequiredConfigSpec`: registry size 26 → 27, exact keySet, and add `generatetext` to the non-empty-`{}`-seed exemption alongside `analyzewithai` (design D2/D9)
- [x] 4.3 Update `PipelineStepSpec`: `PipelineStepKind.All` set, subtype fixture, and the kind-string assertion
- [x] 4.4 Add a fully-valid `probesByKind` entry for `generatetext` over a `string-body` schema in `PipelineAnalyzeServiceSpec` and verify the coverage guard asserts `validationError` is `None`
- [x] 4.5 Re-point `PipelineAnalyzeRoutesSpec`'s unregistered-op 500 probe per design D8: drop `pipeline_steps_op_check` in the suite's own embedded Postgres, insert `notarealop`, comment why the drop is required; verify it still 500s
- [x] 4.6 Replace `PipelineCreateTransactionalSpec`'s now-empty `Seq("generatetext")` reject-loop with an "accept a generatetext step" case, mirroring the `analyzewithai` flip
- [x] 4.7 Verify `PipelineStepConfigCodecSpec`'s `All` decode-`{}` loop and `PipelineCostEstimatorSpec`'s partition test both pass untouched, and that a `generatetext` pipeline is denied with `ai-step`

## 5. Gates

- [x] 5.1 Record one mutation per failure arm from 3.3-3.5 proving each test red (C5), in `files-modified.md`
- [x] 5.2 Run `sbt test`, `npm test`, lint, typecheck, `openspec validate generatetext-pipeline-step --type change`; commit with no `-n`
