# HEL-1429 evidence: verdicts

## Item 1 (D2) - FireTimeRunConfigGateSpec on 1bf11f55
Current spec copied into a detached throwaway worktree at 1bf11f55 (removed afterwards). It did NOT compile unmodified
(`newScheduler` uses the post-HEL-1384 constructor: "parameter 'pipelineRunGuardRepo' is already specified at parameter
position 6", "unknown parameter name: autoRunTriggerService"); a compile failure is not red, so the only shim was making
`newScheduler` use the pre-HEL-1384 constructor (no pipelineStepRepo, no autoRunTriggerService), in the throwaway copy only.
Result (`item1-red-on-1bf11f55.log`): 10 run, 3 passed, 7 failed.
- undecodable step config, scheduled path: FAILED on assertion `true was not equal to false` (:397, `submitAttempted(s) shouldBe false`) -> red-first
- undecodable step config, auto-run path: FAILED on assertion `true was not equal to false` (:419) -> red-first
  (the stack traces logged are the production code logging the decode failure; the test failure itself is an assertion, not an uncaught exception)
- 2.4a (recording the failed run itself fails): PASSED on 1bf11f55 -> stays GUARD
- negative controls (2 tests): PASSED -> stay GUARD
- Discrepancy to report: the run-history cap test (1.1a, header calls its prune assertion a GUARD) also FAILED on 1bf11f55, on the
  `startWith(SkipPrefix)` assertion (:272, which carries its own "Red on main" comment) and on the :240 count assertion in the first
  gap test. Not relabelled (outside the ticket's two; its size/prune assertions are the guard half). Flagged for the evaluator.

## Item 8 (D6) - "Defaulted to `None`" per hit
- OutputProtocol.scala:27 (`OutputResponse.rootId: Option[String] = None`, :43) - TRUE, kept
- DataSource.scala:56 (`CsvSourceConfig.sourceUrl: Option[String] = None`) - TRUE, kept
- model.scala:860 (`NodeRef.rootId: Option[PipelineRootId] = None`) - TRUE, kept
- PipelineStepRepository.scala:434 (`insertInternalAction ... explicitRootId: Option[PipelineRootId]`, no default) - FALSE, corrected
- NodeSnapshotRepository.scala:170 (`listRows ... explicitRootId: Option[String]`, no default) - FALSE, corrected
- OutputRepository.scala:197 (`insertInternal ... explicitRootId: Option[PipelineRootId]`, no default) - FALSE, corrected
(also OutputProtocol.scala:25 sibling comment untouched: true.)

## Item 9 (D7)
Sole production caller: `OutputService.scala:77` passes `output.node.rootId` (the Output's own root; None for a step-bound Output).
With `nodeStepId = None` and `explicitRootId = None`, PipelineRunBackfill:111-114 evaluates every root. Both comment sites reworded accordingly.

## Item 5 (D3) - per-title: what each test calls
- :447 "executeRun (HEL-509...)" : calls `service.submit` only -> `PipelineRunService.submit -> PipelineRunExecutor.executeRun` (executeRun is private in PipelineRunExecutor:89)
- :547 "onRunSuccess (HEL-570...)" : calls `service.submit` only -> `PipelineRunService.submit -> PipelineRunExecutor.onRunSuccess` (private, PipelineRunExecutor:271)
- :749 "onRunSuccess (HEL-462 baseline capture)" : calls `service.submit` only; last_source_schema is written in PipelineRunSucceededWrites:240-252 -> `PipelineRunService.submit -> PipelineRunSucceededWrites.onUnblockedRunSuccess`
- :2167 "previewStep / evaluateNodeRowsForBackfill (HEL-970)" : calls `service.previewStep` (public delegator to PipelineRunPreview.previewStep) and `service.backfillOutputNode` (-> PipelineRunBackfill, private evaluateNodeRowsForBackfill) -> retitled `PipelineRunService.previewStep (PipelineRunPreview) / backfillOutputNode -> PipelineRunBackfill.evaluateNodeRowsForBackfill`
- :2144 comment: verbatim quote of the deleted describe kept; note appended that `onUnblockedRunSuccess` lives in PipelineRunSucceededWrites
- :197 comment (snapshotRows doc) naming `PipelineRunService.onUnblockedRunSuccess`: corrected to PipelineRunSucceededWrites (same family; comment only)
- Unchanged (still-public members the tests call): history, recordUnrunnable, submit, previewStep, previewOutputs, composeTruncationNotice, EmptyTruncationJson.

## Item 6 (D4)
`grep -rn findPrimaryDataSourceIdInternal backend frontend helio-mcp docs scripts` before: definition + 3 doc comments in PipelineRepository + 3 comments in PipelineService; zero call sites (incl. backend/src/test). Deleted; refs rewritten (2 historical-phrasing comments in PipelineService left, they say "was"/"used to"). `Test/compile` succeeds (testFull compiled it).

## Item 4 (D8) - audit_events scoping: REASONED SKIP, no MISTAKES.md line
Searched git log, MISTAKES.md (no audit_events entry) and test sources. The hazard (audit_events append-only, not truncatable) is already documented at point of use in GoogleOAuthRoutesSpec:116, AuditMutationInstrumentationSpec:134 and :350, and every audit assertion in PipelineSchedulerServiceSpec:57 / FireTimeRunConfigGateSpec:196 is already scoped by unique pipeline id. No commit or failure shows cross-test bleed actually biting; so no demonstrated recurrence -> no MISTAKES.md line.
