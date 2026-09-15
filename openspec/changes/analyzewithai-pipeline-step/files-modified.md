# Files modified — HEL-1106 `analyzewithai` pipeline step

## New files

- `backend/src/main/scala/com/helio/domain/ai/AiStepClient.scala` — the injectable AI-step
  seam: `AiStepClient` trait, `AiStepRequest`, `AiStepFailure` (Unavailable/Guardrail/Api/
  Transport), `AiStepClient.Unavailable` context default.
- `backend/src/main/scala/com/helio/ai/ClaudeAiStepClient.scala` — production adapter mapping
  `ClaudeError` onto `AiStepFailure`; carries the HEL-1108 tier-gating call-point comment.
- `backend/src/main/scala/com/helio/domain/steps/AnalyzeWithAiConfig.scala` — `AnalyzeWithAiConfig`
  / `AnalyzeWithAiOutputField`, tolerant decode, order-preserving `JsArray` wire format, shared
  `validate`.
- `backend/src/main/scala/com/helio/domain/steps/AnalyzeWithAiStep.scala` — the step itself:
  sequential per-row model calls, one-fence strip, strict Jackson parse (end-of-input), full D6
  enforcement, `PipelineStep.Companion`.
- `backend/src/test/scala/com/helio/domain/steps/AnalyzeWithAiConfigSpec.scala` — config decode/
  format/validate unit tests (tasks.md 3.4).
- `backend/src/test/scala/com/helio/domain/steps/AnalyzeWithAiStepSpec.scala` — enforcement +
  input/client-failure + engine-propagation tests via a fake `ClaudeTransport` behind the real
  `ClaudeClient` (tasks.md 3.1-3.3).
- `backend/src/test/scala/com/helio/services/pipelines/PipelineAnalyzeAnalyzeWithAiSpec.scala` —
  persisted-row `GET /pipelines/:id/analyze` 200 coverage, `PipelineAnalyzeConvertFormatSpec`
  pattern (tasks.md 3.5).
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceAiStepClientWiringSpec.scala`
  — proves `PipelineRunService(aiStepClient = ...)` genuinely reaches the execution context (the
  same wiring shape `ApiRoutes` uses in production), not merely that the parameter compiles.

## Modified files

- `backend/src/main/scala/com/helio/domain/model/PipelineStep.scala` — `aiClient` field on
  `PipelineExecutionContext` (default `AiStepClient.Unavailable`); registered
  `AnalyzeWithAiStep.Kind -> AnalyzeWithAiStep.companion` in `PipelineStep.Registry`;
  `PipelineStepKind.AnalyzeWithAi`.
- `backend/src/main/scala/com/helio/domain/package.scala` — domain package-object aliases for
  `AnalyzeWithAiStep`/`AnalyzeWithAiConfig`/`AnalyzeWithAiOutputField`.
- `backend/src/main/scala/com/helio/domain/engine/InProcessPipelineEngine.scala` — constructor
  param `aiStepClient: AiStepClient = AiStepClient.Unavailable`, threaded into `makeContext`.
- `backend/src/main/scala/com/helio/domain/engine/PipelineAnalyzeService.scala` — `inferAnalyzeWithAi`
  dispatch case + implementation (design.md D7: input-field check, shared `validate`, declared
  columns appended in declared order, never calls the model).
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` — constructor
  param `aiStepClient: AiStepClient = AiStepClient.Unavailable`, passed to
  `InProcessPipelineEngine`.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — `toAnalyzeStepResponse`
  dispatch case for `AnalyzeWithAiConfig` -> `AnalyzeWithAiAnalyzeStepResponse`.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — `aiStepClient` val built once from
  `ClaudeConfig.fromEnv()` (log-warn on `Left`, mirrors `assistantServiceOpt`), wired into
  `pipelineRunService`.
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineStepProtocol.scala` —
  `AnalyzeWithAiStepResponse`, config/response JSON formats, discriminated-union dispatch entries.
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineAnalyzeProtocol.scala` —
  `AnalyzeWithAiAnalyzeStepResponse`, format, discriminated-union dispatch entries.
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineStepConfigCodec.scala` —
  `encodeConfig` case for `AnalyzeWithAiConfig`.
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepository.scala`
  — `rowToDomain` case for `AnalyzeWithAiConfig` -> `AnalyzeWithAiStep`.
- `helio-mcp/src/tools/write.ts` — `add_pipeline_step` op-name list gains `convertformat` (HEL-1105
  one-word gap) and `analyzewithai`; per-op config docs added for both.

## Test-file updates (existing specs that assumed `analyzewithai` was unregistered)

- `backend/src/test/scala/com/helio/domain/model/PipelineStepSpec.scala` — added `analyzeWithAi`
  to `allSubtypes`/`PipelineStepKind.All`/the pattern-match exhaustiveness guard.
- `backend/src/test/scala/com/helio/domain/steps/PipelineStepRequiredConfigSpec.scala` — registry
  size 25 -> 26 + `analyzewithai` in the keyset; the picker-empty-seed GUARD test now excludes
  `analyzewithai` by name (design.md D1's deliberate write-time non-empty requirement) with its
  own companion test asserting the rejection names the missing fields.
- `backend/src/test/scala/com/helio/domain/engine/PipelineAnalyzeServiceSpec.scala` — added an
  `analyzewithai` probe to the registry-vs-dispatch coverage guard's `probesByKind`, plus six new
  `analyzewithai —` cases (valid, string-body input, unknown field, non-string field, invalid
  config caught pre-inference, malformed config).
- `backend/src/test/scala/com/helio/services/pipelines/PipelineCreateTransactionalSpec.scala` —
  the `Seq("analyzewithai", "generatetext")` unregistered-rejection loop narrowed to
  `Seq("generatetext")`; added an "accept an 'analyzewithai' step" case mirroring the
  `convertformat`/`upsertsource` flips.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeRoutesSpec.scala` — the
  "persisted unregistered-op row 500s at decode" probe swapped from `analyzewithai` (now
  registered by this ticket) to `generatetext` (still HEL-1107, genuinely unregistered).

## Task 2.7 — schemas/OpenAPI enumeration check

Searched `schemas/` and `openspec/specs/` for op-specific config-shape enumerations the way
`upsertsource`/`splittext` appear there; found none (no JSON Schema enumerates step op names or
per-op config shapes — the wire contract is carried entirely by the Scala protocol layer). No
edit was needed; `npm run check:schemas` (schema-drift check) passes unchanged.

## Root cause / probe notes (systematic-debugging.md, non-mutation fixes made during development)

1. **`response-missing-field` didn't fire for a JSON-null declared value.** Root cause:
   `enforce`'s original `missing`/`extra` computation diffed against `obj.fieldNames()` (structural
   presence), which includes a key holding `null` — so a declared key present-but-null was
   silently accepted and then crashed inside the per-field type check instead of failing with the
   named reason. Probe: `AnalyzeWithAiStepSpec` "present but JSON null" test, run before the fix,
   failed with `response-wrong-type` instead of `response-missing-field`. Fix: split into
   `actualKeys` (structural presence, used for the extra-field check) and `nonNullKeys` (used for
   the missing-field check), per design.md D6's explicit "JSON null counts as missing" rule.
2. **`validateRawConfig`/`requiredConfigProblems` could throw uncaught on malformed JSON.**
   Root cause: `AnalyzeWithAiConfig.decode` legitimately throws for non-JSON/non-object raw text
   (by design, mirroring every other step's decoder), but the two `Companion` overrides called it
   unguarded, so a malformed persisted/submitted config crashed `validateStepConfig` instead of
   degrading to the pre-existing "invalid config" category. Probe: the new
   `"analyzewithai — malformed config produces validationError and identity outputSchema"` case in
   `PipelineAnalyzeServiceSpec` failed with an uncaught `JsonParseException` before the fix. Fix:
   wrapped both overrides in `scala.util.Try`, mirroring `ConvertFormatConfig.pairError`'s
   identical guard.

## Mutation record (tasks.md C4 — every enforcement failure arm proven failable)

Each mutation below was applied to `AnalyzeWithAiStep.scala`, the named test(s) were run with
`sbt testOnly com.helio.domain.steps.AnalyzeWithAiStepSpec -- -z "<substring>"`, confirmed
**RED**, then reverted; the full 18-case `AnalyzeWithAiStepSpec` + 13-case `AnalyzeWithAiConfigSpec`
suite (31 tests) was re-run green after every revert.

| # | Arm | Mutation | Red test(s) | Failure observed |
|---|-----|----------|--------------|-------------------|
| 1 | `response-missing-field` | `if (false && missing.nonEmpty) fail(...)` | "response omits a declared key", "present but JSON null" | `NullPointerException` / wrong reason code (`response-wrong-type`) instead of the expected exception |
| 2 | `response-extra-field` | `if (false && extra.nonEmpty) fail(...)` | "includes an undeclared key" | no exception thrown |
| 3 | `response-wrong-type` (string) | `if (true) ... else fail(...)` | "string key holds a number" | no exception thrown |
| 4 | `response-wrong-type` (integer) | `if (true) ... else fail(...)` | "integer key holds a fractional number" | no exception thrown |
| 5 | `response-wrong-type` (float) | `if (true) ... else fail(...)` | "float key holds a string" | no exception thrown |
| 6 | `response-wrong-type` (boolean) | `if (true) ... else fail(...)` | "boolean key holds a string" | no exception thrown |
| 7 | `response-malformed-json` (trailing content) | dropped `parser.nextToken() != null` | "valid object followed by trailing content" | no exception thrown |
| 8 | `response-malformed-json` (unparseable) | catch block returns `null` instead of `fail(...)` | "unparseable JSON" | `NullPointerException` instead of the expected exception |
| 9 | `response-not-object` | `if (false && !node.isObject) fail(...)` | "response is a JSON array" | `ClassCastException` instead of the expected exception |
| 10 | `field-missing` / `field-not-string` | both cases replaced with placeholder strings instead of `fail(...)` | "lacks the configured inputField", "present but not a string" | wrong reason code (`response-missing-field`, since the placeholder content produced a downstream enforcement failure instead) |
| 11 | `ai-unavailable` / `ai-guardrail` / `ai-error` (Api+Transport) | all four `Left(...)` cases replaced with `acc` (silently drop the row) | "default (unconfigured) AiStepClient", "oversized input", "transport reports an API error" | no exception thrown (all 3 red together) |

`response-extra-field`'s "extra fields fail" policy (tasks.md C5, design.md D6) is exercised by
mutation #2 above — dropping the check accepts a response with an undeclared key instead of
failing, which is exactly the "silently discarding keys" behavior design.md rejects.

## Verification gates

- `cd backend && sbt test` — see commit message / final run summary for the exact command output.
- `npm run check:schemas` — passes (no schema enumeration touches `analyzewithai`, task 2.7).
- No `frontend/**` changes in this diff — frontend gates (`lint`/`format:check`/`test`/`build`)
  are out of scope per `concertino.config.json`'s `when` globs.
