## Standing Constraints

- [C1] Do not implement `generatetext` (HEL-1107) or tier gating / HELIO_BETA_DAILY_MESSAGE_LIMIT (HEL-1108); keep `AiStepClient.complete` the single call point and name HEL-1108 there.
- [C2] `PipelineCostEstimator.AiOps` is unchanged; no migration; no StepCard (HEL-1109).
- [C3] Tests make zero network calls: fake `ClaudeTransport` behind the real `ClaudeClient`, or a fake `AiStepClient`.
- [C4] Every enforcement failure arm has a test proven failable by a recorded mutation (in files-modified.md or the commit notes).
- [C5] A non-conforming response never emits partial columns; extra fields fail.

### Backend

## 1. Backend: AI seam

- [x] 1.1 Add `com.helio.domain.ai` `AiStepClient` trait, `AiStepRequest` (with optional `ownerUserId`), `AiStepFailure`, and `AiStepClient.Unavailable`
- [x] 1.2 Add `ClaudeAiStepClient` adapter mapping `ClaudeError` to `AiStepFailure`, with a HEL-1108 call-point comment
- [x] 1.3 Add `aiClient` to `PipelineExecutionContext` (defaulting to Unavailable); thread through `InProcessPipelineEngine`, `makeContext` and `PipelineRunService`
- [x] 1.4 Wire in `ApiRoutes` from `ClaudeConfig.fromEnv()` (log-warn on Left)

## 2. Backend: step

- [x] 2.1 `AnalyzeWithAiConfig` (tolerant decode, ordered outputSchema format, shared `validate`) and `AnalyzeWithAiStep`
- [x] 2.2 Prompt build, one-fence strip, strict Jackson parse (end-of-input), enforcement per design D6
- [x] 2.3 Register in `PipelineStep.Registry` / `PipelineStepKind`; add domain package aliases
- [x] 2.4 Codec encode case, `rowToDomain` case, write-path validation (create/add/update/transactional)
- [x] 2.5 `inferAnalyzeWithAi` in `PipelineAnalyzeService`; `AnalyzeWithAiAnalyzeStepResponse` in protocol and `PipelineService`
- [x] 2.6 helio-mcp `write.ts` `add_pipeline_step` op-name list (~376-378) and per-op config docs: add `analyzewithai` (and the missing `convertformat`, a one-word HEL-1105 gap)
- [x] 2.7 Check `schemas/`/OpenAPI by searching op-specific config shapes (e.g. `upsertsource`/`splittext`), not convertformat; edit only if an enumeration exists and record the result; schema-drift check passes

## 3. Tests

- [x] 3.1 Enforcement via fake ClaudeTransport: conforming (types, order), missing field, null field, wrong type (each type), extra field, malformed JSON, trailing content, not-object, fenced response
- [x] 3.2 Input: field-missing, field-not-string; ai-unavailable (default context); guardrail (oversized input maps to ai-guardrail, zero transport calls); api error
- [x] 3.3 Engine: failure surfaces the reason code through StepExecutionException, and no rows are materialized
- [x] 3.4 Config validation tests plus a tolerant legacy decode with fields absent
- [x] 3.5 Analyze: output schema in declared order, bad input field, and persisted-row analyze 200 (PipelineAnalyzeConvertFormatSpec pattern)
- [x] 3.6 Update specs that used analyzewithai as an unregistered stand-in (update, never delete); cost partition stays green
- [x] 3.7 Record a mutation per failure arm (C4); run full sbt test, npm test, lint/typecheck; commit
