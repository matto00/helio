## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 0dd29fcf297e1cf54a4f677fdbbfeab35bfd2d41. Base resolved live via resolve-review-base.sh: 2fb8deb5 (= merge-base with origin/main 0a528316).

### What I verified (with evidence)

- **Spawn guard:** assert-cwd.sh → `READY ambient=/home/matt/Development/helio branch=task/relabel-gate-tests-tidy-refs/HEL-1429`.
- **Main has moved since the base (HEL-1385 #891, HEL-1376 #893).** `git merge-tree --write-tree HEAD origin/main` merges cleanly (tree b7c9b0b2), with no conflicts. Neither commit touches any file this change edits. The only file they touch in this package is AutoRunTriggerService.scala, and that change is a comment reflow. On the merged tree, grep finds no live reference to `findPrimaryDataSourceIdInternal`, and every remaining `processAutoRunDebounce`/`processAutoRunClaim`/`fireAutoRun` reference is in the firer or the scheduler's `tick()`. The remaining true "Defaulted to `None`" hit moves from model.scala:860 to model.scala:595 after HEL-1376, and its text is unchanged.
- **Item 1 (red-first relabel).**
  - The two undecodable-config tests move verbatim into a new "(red-first)" group. I checked the diff and the bodies are byte-identical.
  - The persisted log (`.concertino/runs/HEL-1429/evidence/.../item1-red-on-1bf11f55.log`) shows both tests failing on assertions (`true was not equal to false` at :397/:419), not on a compile error or an uncaught exception. 2.4a passes there and stays GUARD.
  - The shim only changes the constructor call in the throwaway copy. The red result also follows from the code: 1bf11f55 has no fire-time config gate, so `submitAttempted` is necessarily true. The header was updated to match.
  - I did not re-run 1bf11f55 myself. The pasted output is specific (UUIDs, line numbers), unambiguous, and consistent with the code.
- **Item 2.** The fire() comment (PipelineSchedulerService.scala:186-190) now points at the `Failure` case of `gatedSubmit`'s `transform`. That is the construct that actually guards `submit`, since gatedSubmit has no `recover`.
- **Item 3 (split).** I read the full diff.
  - Bodies of `processAutoRunDebounce`/`processAutoRunClaim`/`fireAutoRun` move verbatim. The changes are the null check becoming `Option.when` + `fold` in `tick()`, and comment back-references qualified with the class name.
  - The logger is `classOf[PipelineSchedulerService]`. Base used `getClass` on a `final class`, so the logger name is the same.
  - Log strings, levels and arguments are identical. Constructor signature, defaults and `require`s are unchanged.
  - The moved code reads no scheduler state (no inFlight), so nothing is duplicated.
  - The `.recover` around the pass in `tick()` keeps its position.
  - Line counts: scheduler 251, firer 98.
- **Item 5 (renames).** I grepped each renamed block's calls.
  - :447, :547 and :749 call only `service.submit`.
  - :2169 calls `service.previewStep` and `service.backfillOutputNode`.
  - The named owners exist: `PipelineRunExecutor.executeRun`:89, `onRunSuccess`:271, `PipelineRunSucceededWrites.onUnblockedRunSuccess`:53 (last_source_schema written at :240-252), `PipelineRunBackfill.evaluateNodeRowsForBackfill`:101 and `PipelineRunPreview.previewStep`:27.
  - The :2144 quote is kept verbatim with a note appended, as D3 requires.
- **Item 6.** No call sites remain, and only historical-phrasing comments survive. The head suites compile and run (below).
- **Item 7.** The appended section F matches ExistenceNotLeakedRoutesSpec:529-530 (`PipelineRunPreview.scala -> 1`, `PipelineRunService.scala -> 1`) and PipelineRunPreview.scala:244 (`authorizedForAi`). The original line 52 is left as written.
- **Item 8.**
  - The three corrected params have no default.
  - The three kept hits are truly defaulted: OutputResponse.rootId:43, `CsvSourceConfig.sourceUrl = None`, `NodeRef.rootId = None`.
- **Item 9.** OutputService.scala:77 is the only production call, passing `output.node.rootId`. PipelineRunBackfill:111-114 evaluates all roots when `explicitRootId` is `None`. The wording is accurate.
- **Item 4.** The reasoned skip is recorded in verdicts.md, as D8 allows.
- **Behaviour proof.**
  - I ran the targeted suites myself at head: `nice -n 19 sbt -J-Xmx3g "testOnly FireTimeRunConfigGateSpec PipelineSchedulerServiceSpec PipelineRunServiceSpec ExistenceNotLeakedRoutesSpec *AutoRun*"` → `Total number of tests run: 204 / Suites: completed 10, aborted 0 / Tests: succeeded 204, failed 0`, exit 0.
  - The relabelled group and all four renamed titles appear in that output. AutoRunGuardBurstProofSpec passed on the first run.
  - The evaluator's pasted full testFull on head (6440/0 failed/4 canceled) stands, and `cmp` of the two suite-count JSONs → identical.
- **No UI changes.** The diff touches no `frontend/**`, so step 4 is N/A.

### Verdict: CONFIRM

### Non-blocking notes
- backend/src/main/scala/com/helio/services/pipelines/README.md:5 lists PipelineRunService's `private[pipelines]` collaborators but not the new `PipelineAutoRunDebounceFirer`. The list is not exhaustive (AutoRunTriggerService and RunConfigGate are also absent), so this is not a defect. A one-word addition would keep it parallel with the HEL-1393 entry.
- PipelineRunBackfill.scala:69 says "sole production caller (`OutputService`)". The direct caller is PipelineRunService's delegator, and OutputService is the sole caller of that. The meaning is clear.
- The evaluator's notes stand:
  - the gatedSubmit has two `transform`s, so the comment could say "the submit branch's";
  - item1 log is gitignored, but a durable copy exists;
  - testfull-comparison.md compares per-suite test counts, not per-suite pass/fail counts.
