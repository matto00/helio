## Standing Constraints

## 1. Repro (red first)

- [x] 1.1 Live repro on the worktree backend (port from workflow-state.md): create a pipeline with one misconfigured enabled step, GET /analyze, record step validationError + `canRun:true` in the evidence; record every created id
- [x] 1.2 Write the backend route test + PipelineServiceCanRunSpec cases from the spec scenarios; run them RED on unfixed code and save the output

### Backend

- [x] 2.1 `PipelineService.analyze`/`toCostVerdictResponse`: derive `step-config-invalid` reasons from `analyzed`, gate `autoRunnable`/`canRun` (design D1-D3); verify 1.2 goes green
- [x] 2.2 Update `CostVerdictResponse` doc in PipelineAnalyzeProtocol.scala and add the code to `pipeline-analyze-response.schema.json` enum + canRun description; verify schema validation test passes

### Frontend

- [x] 3.1 Add `step-config-invalid` to `ALL_COST_REASON_CODES` + `DENY_REASON_COPY` (design D4); dedupe identical sentences in the footer join (skeptic note 2); verify denyReasonCopy coverage test passes
- [x] 3.2 helio-mcp: `canRun` on `CostVerdictResponse`, `analyze_pipeline` description sentence, `context.test.ts` fixtures at ~L147 and ~L710 (design D6); verify helio-mcp tests/typecheck

### Tests

- [x] 4.1 Seam test: shared fixture read by backend route test (schema-validated, normalized equality) and a frontend denial-block test (copy shown, no "Run to update") (design D5)
- [x] 4.2 Scenario coverage: two misconfigured steps -> two reasons; disabled misconfigured step -> no reason; viewer -> canRun false, no config reason; owner clean -> canRun true
- [x] 4.3 Mutation: revert the `canRun` gate only -> named tests red; revert the frontend copy entry -> frontend seam test red asserting the SPECIFIC misconfigured-step wording (not merely non-fallback); confirm jest can import the shared fixture path; record both
- [x] 4.4 Re-grep e2e/, frontend/e2e, unit tests for canRun reliance; full gates: `nice -n 19 sbt testFull` (timeout 600000), frontend lint/typecheck/test, helio-mcp tests
- [x] 4.5 Live check: denial block with the new copy in light and dark (own headless context), plus live GET /analyze green; record ids; delete only by exact id
