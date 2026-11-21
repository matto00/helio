## Standing Constraints

- [C1] NEVER read/cat/grep/source/print any .env file; never run env-dumping commands; never copy a tree containing one. Only scripts/concertino/.concertino.env may be read by scripts, never printed.
- [C2] Quoted heredocs only (<<'EOF').
- [C3] No pkill/pgrep/killall; exact PIDs only; stop servers with stop-servers.sh.
- [C4] jest 3 workers, Playwright 2 workers, sbt -J-Xmx3g, nice -n 19.
- [C5] Bash timeout 600000; sbt testFull in shards that fit; no background run past the tool timeout.
- [C12] Red first with mutations; run full spec files; record and COMMIT the red run before implementation.
- [C13] Scratch in .concertino/scratch/HEL-1800/; follow-up evidence in .concertino/runs/HEL-1800/evidence/.
- [C14] Lane DB helio_hel1800 for any server/jest/e2e run that touches a DB; any lane backend started with ANTHROPIC_API_KEY exported empty.

## 1. Red tests (committed before implementation)

- [x] 1.1 Route- or service-level red test in a host where auto-run is actually WIRED: `FormSubmitEditorRlsSpec` (services/panels, wires `autoRunDebounceRepo` + a trigger) or a new `HEL1800...Spec` built the same way. Do NOT extend `FormSubmitEditorRoutesSpec` / `FormPanelRouteFixture`: its `ApiRoutes` passes no `autoRunDebounceRepo`, so `deniedPipelines` is always `[]` there (skeptic-design-1 CR1). Setup: a pipeline owned by the form owner, rooted at the form's bound dataset source, the dashboard editor (submitter) holding an editor grant on that pipeline, forced over the bound (`last_run_row_count` above `MaxAutoRunRows` = 10000 for `rows-above-threshold`; a second case with more than 20 enabled steps for `steps-above-bound`). The test FIRST asserts `deniedPipelines` is non-empty with the expected code, THEN asserts the detail equals the HEL-1661 neutral sentence and that neither the row/step count nor the threshold digits appear in the denial. Verify: run the full spec file on current code; the recorded red output must show the editor receiving the raw `Estimated N rows exceeds the auto-run threshold of 10000` detail (not an index/empty-array failure); save under .concertino/scratch/HEL-1800/ and commit before implementation.
- [x] 1.2 Owner-keeps-detail test (same wired host): the pipeline owner's own write gets the full `Estimated N rows exceeds ...` detail. Verify: green before and after (a guard, labelled as such); proven failable by a mutation that neutralizes for everyone.
- [x] 1.3 Service-level coverage in `AutoRunTriggerServiceSpec`: viewer-grantee and editor-grantee denials get neutral estimator details (red on current code); a `step-config-invalid` reason passes through unchanged for a grantee. The reason mapping is factored into a small pure function (same package) whose unknown-code -> `GenericReasonDetail` fallback is unit-tested directly. `canRun`/`hasConfigReason` keep reading the original `verdict.reasons`.

## 2. Implementation

- [x] 2.1 In `AutoRunTriggerService.handleDenied`, map reasons for both non-owner branches via `PipelineAnalyzeReads.NeutralReasonDetail.getOrElse(code, GenericReasonDetail)`, keeping `step-config-invalid` and `stepId`; owner branch unchanged; log line unchanged. Do not edit `PipelineAnalyzeReads.scala`. Verify: tests from group 1 green.
- [x] 2.2 Mutation checks: (a) neutralize for the owner too -> 1.2 fails; (b) skip neutralizing the editor branch -> 1.1 fails; (c) neutralize step-config-invalid -> 1.3 fails. Record in .concertino/scratch/HEL-1800/.

## 3. Verification

- [x] 3.1 Confirm no shape change: `schemas/panels/form-submit-response.schema.json` and the data-source row-write schemas unchanged; existing `RowWriteResponseDenyReasonCoverageSpec`, `FormSubmitRoutesSpec`, `FormSubmitEditorRoutesSpec`, `DataSourceServiceDeniedPipelinesSpec`, `AutoRunTriggerServiceSpec`, and frontend `deniedPipelinesToast`/`denyReasonCopy` tests pass.
- [x] 3.2 Run the backend suite (`sbt -J-Xmx3g testFull`, sharded to fit the timeout) and the pre-commit hooks.
