## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 524c431fc7701856de798c18317b175e8bbd4972 (base 0fac82ce38ee0c391f8473fb4b3bb58d87fb5c7a, resolved live by resolve-review-base.sh).
Commits: 143b46306 (red tests) -> 524c431fc (implementation).

### Phase 1: Spec Review — PASS
Issues: none

- AC1 (a failing test on current code: an editor's form submit refused for cost carries no cost figure). `FormSubmitEditorRlsSpec` "show an editor grantee the neutral sentence, with no row count or threshold digit" plus the steps-above-bound case. I re-ran both at the red commit 143b46306 in a throwaway detached worktree. They fail with the raw detail ("Estimated 12345 rows exceeds the auto-run threshold of 10000", "21 enabled steps exceeds the auto-run bound of 20"). Each test first asserts the code, so the red is non-vacuous and is not an index or empty-array failure. Output: .concertino/scratch/HEL-1800/eval-red-recheck.txt. The red commit contains only tests and the excerpt, and it comes before the implementation commit.
- AC2 (the owner keeps the full reason). Covered by the owner guards in both specs. I mutated the owner branch to neutralize too (AutoRunTriggerService.scala:142), and both owner guards plus one viewer test failed (3 failures). Output: .concertino/scratch/HEL-1800/eval-mutation-owner.txt. The guard can fail, as its label claims.
- AC3 (a seam test if the shape changes). The shape does not change: the diff touches no protocol, `schemas/` or `frontend/` file. `DeniedPipelineResponse.fromDomain` still copies `reasons` as-is. The client never reads `detail`: I grepped `denyReasonCopy.ts`, `deniedPipelinesToast.ts`, `FormPanelView.tsx`, `runToUpdate.ts` and `SpineStatusStrip.tsx`, and the only `detail` hits are in comments. No seam test is needed (design D4).
- I checked the inventory claim that every in-scope write goes through `handleDenied`. The only producer of `EvaluatedPipeline.Denied` is `AutoRunTriggerService.handleDenied`. The only consumers are `DataSourceService.triggerAutoRunAwaited`, at the append, form-append, replace and patch call sites (DataSourceService.scala:844/887/911/939). Delete is fire-and-forget (965) and returns no body.
- The `step-config-invalid` pass-through matches analyze: PipelineAnalyzeReads.scala:213 passes config reasons through unchanged and neutralizes only cost reasons (218).
- Every task in tasks.md is checked and matches the diff. There is no scope creep. The non-retired CONSTRAINTS C1–C14 are honored: no .env access, scratch is in .concertino/scratch/HEL-1800/, and the red was committed first.

### Phase 2: Code Review — PASS
Issues: none

Gates, which I ran myself in WORKTREE_PATH (backend-only change, so `frontend/**` gates do not apply). I ran `sbt -J-Xmx3g` with `nice -n 19`, split into shards that together cover all 754 spec files:
- `com.helio.services.*`: 261 suites, 2552 passed, 0 failed, 5 canceled. All 5 cancellations are opt-in `HELIO_MEASURE` measurements (RunPathHeapSpec, OutputFilteredMetricMeasurementSpec, DatasetWriteSubmitLatencySpec x3) and are expected.
- `com.helio.api.*`: 220 suites, 2927 passed, 0 failed.
- `com.helio.infrastructure.*`, `spark`, `eval`, `testkit`, `testsupport`: 126 suites, 1271 passed, 0 failed.
- `com.helio.domain.*`: 145 suites, 3443 passed, 0 failed.
- Root `DevEnvSpec`, `ScalaTestSummaryGuardSpec`: 2 suites, 15 passed.
- Targeted run (AutoRunTriggerServiceSpec, FormSubmitEditorRlsSpec, RowWriteResponseDenyReasonCoverageSpec, FormSubmitRoutesSpec, FormSubmitEditorRoutesSpec, DataSourceServiceDeniedPipelinesSpec, PipelineAnalyze*): 18 suites, 321 passed.

One process note: the api shard ran longer than the 600 s tool timeout (668 s), so the harness moved it to the background. It finished with exit 0, and I waited for it before going on.

Code:
- `neutralizeReasons` (AutoRunTriggerService.scala:175-179) is a small pure function. It reuses HEL-1661's `NeutralReasonDetail`/`GenericReasonDetail` rather than copying them (DRY), and does not edit PipelineAnalyzeReads.scala. Unknown codes fall back to the generic sentence, and a unit test covers this directly.
- `hasConfigReason`/`canRun` and the log line still read the original `verdict.reasons`, so neither behavior changes.
- No inline FQNs (only object-qualified names). No dead code, no TODO, no over-engineering.
- The tests are meaningful: the red at 143b46306 is confirmed and my own mutation turned them red.

### Phase 3: UI Review — N/A
No file matches the triggers (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`).

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `proposal.md`, `design.md`, `ticket.md`, `skeptic-design-*.md`, `.openspec.yaml` and `specs/` under the change dir are untracked; only `tasks.md`, `files-modified.md` and the red excerpt are committed. Make sure the archive step commits them, so the spec delta (`dataset-write-auto-run`) reaches `openspec/specs/`.
- AC1 is met at the service level, not over HTTP. The route copies `detail` unchanged, and the existing `RowWriteResponseDenyReasonCoverageSpec` covers that, so this is acceptable as designed (skeptic-design-1 CR1 explains why the route fixture cannot host it).
