## Standing Constraints

- [C1] convertformat is a deterministic local converter: no ClaudeClient, no AI hooks (owner ruling; AI deferred to HEL-1135).
- [C2] Supported pairs are exactly CSV<->JSON and text<->Markdown.
- [C3] AiOps in PipelineCostEstimator is untouched; only its HEL-1105/1106 comment is corrected to HEL-1106/1107.
- [C4] Tests using convertformat as an unregistered stand-in are updated, never deleted; any remaining unregistered-op probe uses a different fake op.
- [C5] No StepCard editor (HEL-1109) and no migration.
- [C6] Failure-arm tests must be proven failable by a recorded mutation.

## 1. Backend: step model

- [x] 1.1 Add `ConvertFormatConfig` (tolerant `decode`, `format`, strict `validateRawConfig`) and `ConvertFormatStep` with `SupportedPairs`; verify `sbt compile`
- [x] 1.2 Implement CSV<->JSON conversion per design D4 (RFC 4180 parse, canonical serialize, named reason codes); verify unit tests in 4.x
- [x] 1.3 Implement text<->Markdown conversion per design D5; verify round-trip unit tests in 4.x
- [x] 1.4 Register in `PipelineStep.Registry`/`PipelineStepKind`; verify kind-set parity test passes

## 2. Backend: wiring

- [x] 2.1 Codec encode case in `PipelineStepConfigCodec` and `rowToDomain` case in `PipelineStepRepository`; verify persisted-row decode test
- [x] 2.2 Write-path validation hooked where upsertsource's is (create/add/update); verify 400 on unsupported pair
- [x] 2.3 `inferConvertFormat` in `PipelineAnalyzeService` sharing `SupportedPairs`; verify analyze tests
- [x] 2.4 `ConvertFormatAnalyzeStepResponse` in `PipelineAnalyzeProtocol` + `PipelineService` mapping; verify analyze returns 200 for a persisted step
- [x] 2.5 `PipelineCostEstimator`: add `ContentConversionOps` + `content-conversion` code; fix AiOps comment; add code to `schemas/pipelines/pipeline-analyze-response.schema.json` enum; verify estimator spec
- [x] 2.6 Update schemas/OpenAPI wherever upsertsource config/response is enumerated; verify schema-drift check passes

## 3. Docs

- [x] 3.1 Correct design spec section 6 (`docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md`) so only analyzewithai/generatetext route through ClaudeClient; verify by grep

## 4. Tests

- [x] 4.1 Round-trip tests: CSV with commas/quotes/embedded newlines/CRLF; JSON string objects; header-only documented case; text with Markdown-significant chars, leading/trailing spaces and tabs, blank lines, lines of only spaces/tabs, literal `&#32;` and `&#9;` in input, lines ending in 1/2/3 literal backslashes before a newline, a text that is exactly one backslash; plus a property-style test over generated strings
- [x] 4.2 One failure test per reason code asserting the code appears in the run error and no rows are emitted; record a mutation per arm showing it red
- [x] 4.3 Engine test: failure surfaces through `StepExecutionException` with the reason code (not "step execution failed")
- [x] 4.4 Config validation tests (supported/unsupported pairs, from==to, tolerant legacy decode)
- [x] 4.5 Analyze tests: missing field, non-string-body field, bad pair, output schema; persisted-row analyze 200
- [x] 4.6 `PipelineCostEstimatorSpec`: four-set partition, `content-conversion` verdict, stand-in renamed to `notarealop`
- [x] 4.7 `PipelineCreateTransactionalSpec`: remove convertformat from rejection loop, add accept case
- [x] 4.8 Run full `sbt test`, frontend `npm test`, lint/typecheck; commit
