# claims.md - HEL-1451 verification of every factual sentence (tree at e982754f5 + this change)

## A. PipelineSchedulerService.scala comment (D1)

### A1. executeRun Failure branch yields a successful Future carrying Left (PipelineRunService.submit delegates to PipelineRunExecutor.executeRun)
```
$ grep -nE 'executeRun|Left\(|Future.successful\(Left' backend/src/main/scala/com/helio/services/pipelines/PipelineRunExecutor.scala | head -20
40:  import terminal.{executeRunFailure, onBlockedRun, onDryRunSuccess, onWriteBackFailure, publish}
61:          case None    => Left(pipelineGone(pipelineId))
62:          case Some(_) => Left(ServiceError.UnprocessableEntity("DataSource not found for pipeline: " + pipelineId.value))
70:        // rest_api/sql) now reaches executeRun uniformly — the engine's own
82:            // pre-flight is the create-time gate). Rejected at SUBMIT time, before `executeRun`/
86:              Future.successful(Left(ServiceError.UnprocessableEntity(
89:            else executeRun(pipeline, roots, allSteps, isDry, user, triggerSource, triggeredByTokenId)
99:  private def executeRun(
146:          case Left(retryAfterSecs) => Left(ServiceError.TooManyRequests(retryAfterSecs, "Pipeline-run rate limit exceeded"))
151:      case Left(err) => Future.successful(Left(err))
157:        // (cap reached), `executeRun` returns `Left(TooManyRequests(...))` immediately, WITHOUT
178:                Future.successful(Left(ServiceError.TooManyRequests(guardConfig.concurrencyRetryAfterSeconds, "Pipeline-run concurrency limit exceeded")))
181:                Future.successful(Left(ServiceError.Forbidden("Forbidden")))
184:                Future.successful(Left(pipelineGone(pipelineId)))
192:              case PipelineRunRepository.RunAuthorization.NotAuthorized => Left(ServiceError.Forbidden("Forbidden"))
193:              case PipelineRunRepository.RunAuthorization.PipelineGone  => Left(pipelineGone(pipelineId))
198:          case Left(err) => Future.successful(Left(err))
251:        executeRunFailure(pipelineId, runId, pidStr, isDry, user, ownerRun, assertionSink, ex)
253:        executeRunSuccess(
260:  /** The `Success(...)` branch of `executeRun`'s original inline `transformWith` (HEL-505:
```

### A2. gatedSubmit is an outer transformWith; the empty-reasons branch has an inner .transform on submit(...)
```
$ grep -nE 'transformWith|\.transform|def gatedSubmit|\.submit\(|recordUnrunnable' backend/src/main/scala/com/helio/services/pipelines/PipelineSchedulerService.scala
216:        // submit branch's inner `.transform` in `gatedSubmit` (not its outer `transformWith`)
219:        // among several (the outer `transformWith` and the recordUnrunnable branch's `.transform`
232:  private def gatedSubmit(schedule: PipelineSchedule, owner: AuthenticatedUser): Future[Unit] = {
234:    Future.delegate(pipelineStepRepo.listByPipelineInternal(pid).map(RunConfigGate.stepConfigReasons)).transformWith {
237:          .submit(pid, isDry = false, owner, triggerSource = TriggerSource.Scheduled)
238:          .transform {
250:          .recordUnrunnable(
254:          .transform {
```

### A3. submit lookups named in the comment (findByIdShared, findGrantRole) are submit own pre-run lookups
```
$ grep -nE 'def submit|findByIdShared|findGrantRole|runPipeline' backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala | head
157:  import executor.runPipeline
187:  def submit(
194:    pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
199:        pipelineRepo.findGrantRole(pipelineId, user).flatMap {
202:            runPipeline(pipeline, pipelineId, isDry, user, triggerSource, triggeredByTokenId)
208:        runPipeline(pipeline, pipelineId, isDry, user, triggerSource, triggeredByTokenId)
215:   *  skips [[submit]] entirely rather than reaching [[PipelineRunExecutor.runPipeline]]'s
313:    pipelineRepo.findByIdShared(pipelineId, Some(user)).map(_.isDefined)
324: *  `InProcessPipelineEngine.loadRows` (`PipelineRunExecutor.runPipeline`/`PipelineRunPreview.previewStep` no longer
```

### A4. outer transformWith Failure arm and recordUnrunnable .transform also return a successful Future
```
$ sed -n 230,267p backend/src/main/scala/com/helio/services/pipelines/PipelineSchedulerService.scala
   *  evaluation or record failure never submits and never throws, so the caller's schedule advance
   *  always runs (bounded: one occurrence lost, never a retry every tick). */
  private def gatedSubmit(schedule: PipelineSchedule, owner: AuthenticatedUser): Future[Unit] = {
    val pid = schedule.pipelineId
    Future.delegate(pipelineStepRepo.listByPipelineInternal(pid).map(RunConfigGate.stepConfigReasons)).transformWith {
      case Success(reasons) if reasons.isEmpty =>
        pipelineRunService
          .submit(pid, isDry = false, owner, triggerSource = TriggerSource.Scheduled)
          .transform {
            case Success(_) => Success(())
            case Failure(ex) =>
              log.error(s"PipelineSchedulerService: submit raised unexpectedly for pipeline ${pid.value}", ex)
              Success(())
          }
      case Success(reasons) =>
        log.info(
          "PipelineSchedulerService: scheduled run of pipeline {} not attempted (schedule {}): {}",
          pid.value, schedule.id.value, reasons.map(r => s"${r.code}: ${r.detail}").mkString("; ")
        )
        pipelineRunService
          .recordUnrunnable(
            pid, RunConfigGate.scheduledSkipReason(reasons), owner,
            triggerSource = TriggerSource.Scheduled, pruneOldRuns = true
          )
          .transform {
```

### A5. fire() bookkeeping (updateAfterTickInternal) runs after gatedSubmit via flatMap
```
$ sed -n 219,226p backend/src/main/scala/com/helio/services/pipelines/PipelineSchedulerService.scala
        // among several (the outer `transformWith` and the recordUnrunnable branch's `.transform`
        // also return a successful Future), and together they keep the bookkeeping below running.
        gatedSubmit(schedule, owner)
          .flatMap { _ =>
            val next = nextFireTimeLogged(schedule, now)
            scheduleRepo.updateAfterTickInternal(schedule.id, nextRunAt = next, lastRunAt = Some(now))
          }
    }
```

## B. PipelineRunBackfill.scala comment (D2)

### B1. sole production call site of backfillOutputNode is OutputService, via PipelineRunService pass-through
```
$ grep -rn 'backfillOutputNode(' backend/src/main
backend/src/main/scala/com/helio/services/pipelines/PipelineRunBackfill.scala:61:  def backfillOutputNode(
backend/src/main/scala/com/helio/services/pipelines/OutputService.scala:77:        val done = pipelineRunService.backfillOutputNode(output.node.pipelineId, output.node.stepId, user, output.node.rootId)
backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala:274:  def backfillOutputNode(
backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala:287:    backfill.backfillOutputNode(pipelineId, nodeStepId, user, explicitRootId)
```

### B2. the pass-through exists at PipelineRunService and delegates to backfill (PipelineRunBackfill)
```
$ sed -n 273,288p backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala
  /** Delegates to [[PipelineRunBackfill.backfillOutputNode]], where the method and its documentation live. */
  def backfillOutputNode(
      pipelineId: PipelineId,
      nodeStepId: Option[PipelineStepId],
      user: AuthenticatedUser,
      // HEL-913 task 5.10: names WHICH root when `nodeStepId` is `None` (a root-bound Output) --
      // without it, the backfill always evaluates the LOWEST-positioned root regardless of which
      // root the Output is actually bound to (`OutputRepository.rootIdOpt`'s job at write time;
      // this is the corresponding read/backfill-time thread-through). Required (no default): every
      // caller passes it explicitly -- the sole production caller (`OutputService`) passes the
      // Output's own `node.rootId`, which is `None` for a step-bound Output (`nodeStepId` already
      // names the node). `None` with `nodeStepId = None` names no root, so every root is evaluated.
      explicitRootId: Option[PipelineRootId]
  ): Future[Unit] =
    backfill.backfillOutputNode(pipelineId, nodeStepId, user, explicitRootId)

```

### B3. OutputService passes the Output node rootId
```
$ sed -n 72,82p backend/src/main/scala/com/helio/services/pipelines/OutputService.scala
    if (pipelineRunService != null)
      // HEL-913 task 5.10: threads the Output's OWN root id through so a root-bound backfill
      // evaluates the root this Output is actually attached to, not always the lowest-positioned
      // one -- see PipelineRunService.backfillOutputNode's doc.
      {
        val done = pipelineRunService.backfillOutputNode(output.node.pipelineId, output.node.stepId, user, output.node.rootId)
        // The observer must never fail create/update.
        try backfillObserver(output.id, done)
        catch { case NonFatal(e) => log.warn(s"backfillObserver threw for output ${output.id.value}", e) }
      }

```

### B4. PipelineRunService copy (L282) of the sentence is accurate: OutputService is the sole caller of that method
```
$ grep -rn 'backfillOutputNode' backend/src/main backend/src/test | grep -v 'PipelineRunBackfill.scala\|PipelineRunService.scala' | head
backend/src/main/scala/com/helio/api/ApiRoutes.scala:478:  // `pipelineRunService.backfillOutputNode` off the request path on a newly-Output-bound node
backend/src/main/scala/com/helio/services/pipelines/OutputService.scala:41:    // way -- see PipelineRunService.backfillOutputNode's own doc for why this is a targeted,
backend/src/main/scala/com/helio/services/pipelines/OutputService.scala:50:    // `PipelineRunService.backfillOutputNode` (completes once the whole backfill chain has
backend/src/main/scala/com/helio/services/pipelines/OutputService.scala:53:    // exactly what `backfillOutputNode`'s returned Future covers -- work it detaches is not
backend/src/main/scala/com/helio/services/pipelines/OutputService.scala:64:  /** HEL-947: fires `PipelineRunService.backfillOutputNode` off the request path -- NOT
backend/src/main/scala/com/helio/services/pipelines/OutputService.scala:67:   *  per `backfillOutputNode`'s own contract, degrades to a complete no-op (never throws into
backend/src/main/scala/com/helio/services/pipelines/OutputService.scala:75:      // one -- see PipelineRunService.backfillOutputNode's doc.
backend/src/main/scala/com/helio/services/pipelines/OutputService.scala:77:        val done = pipelineRunService.backfillOutputNode(output.node.pipelineId, output.node.stepId, user, output.node.rootId)
backend/src/main/scala/com/helio/services/pipelines/OutputService.scala:220:                    // and cheap when the node is already snapshotted (backfillOutputNode's own
backend/src/test/scala/com/helio/api/routes/pipelines/OutputRoutesSpec.scala:153:    // per request would work too -- `backfillOutputNode` is stateless -- but one instance mirrors
```

## C. README (D3) - every file named; re-derive

### C1. file list re-derive command + count
```
$ ls backend/src/main/scala/com/helio/services/pipelines/*.scala | xargs -n1 basename | sed 's/\.scala$//' | wc -l
52
```

### C2. every .scala file is named in the README (no output = none missing)
```
$ for f in backend/src/main/scala/com/helio/services/pipelines/*.scala; do b=$(basename $f .scala); grep -q "\`$b\`" backend/src/main/scala/com/helio/services/pipelines/README.md || echo MISSING $b; done; echo checked
checked
```

### C3. every capitalised name in backticks in the README is a real file (no output = none stale)
```
$ grep -o '`[A-Z][A-Za-z]*`' backend/src/main/scala/com/helio/services/pipelines/README.md | tr -d '`' | sort -u | while read n; do [ -f backend/src/main/scala/com/helio/services/pipelines/$n.scala ] || echo NOFILE $n; done; echo checked
checked
```

### C4. visibility claims: private[pipelines] files named so
```
$ grep -nE '^private\[pipelines\] (final )?(class|object|case class|sealed)' backend/src/main/scala/com/helio/services/pipelines/*.scala | sed 's|backend/src/main/scala/com/helio/services/pipelines/||'
InlineSourceCompensation.scala:17:private[pipelines] object InlineSourceCompensation {
OrphanedRunReaper.scala:15:private[pipelines] final class OrphanedRunReaper(
OutputRootResolution.scala:12:private[pipelines] final class OutputRootResolution(pipelineRootRepo: PipelineRootRepository)(implicit ec: ExecutionContext) {
OutputRowReads.scala:14:private[pipelines] final class OutputRowReads(
PipelineAnalyzeReads.scala:19:private[pipelines] final class PipelineAnalyzeReads(
PipelineAutoRunDebounceFirer.scala:19:private[pipelines] final class PipelineAutoRunDebounceFirer(
PipelineAutoRunDebounceFirer.scala:135:private[pipelines] sealed trait FireOutcome
PipelineAutoRunDebounceFirer.scala:136:private[pipelines] object FireOutcome {
PipelineCreateTransaction.scala:19:private[pipelines] final class PipelineCreateTransaction(
PipelineCreateWrites.scala:14:private[pipelines] final class PipelineCreateWrites(
PipelineNodeReads.scala:17:private[pipelines] final class PipelineNodeReads(
PipelineProposalAnalyze.scala:17:private[pipelines] final class PipelineProposalAnalyze(
PipelineRootWrites.scala:15:private[pipelines] final class PipelineRootWrites(
PipelineRunBackfill.scala:13:private[pipelines] final class PipelineRunBackfill(
PipelineRunDeletedRecovery.scala:28:private[pipelines] final class PipelineRunDeletedRecovery(pipelineRepo: PipelineRepository)(implicit ec: ExecutionContext) {
PipelineRunExecutor.scala:23:private[pipelines] final class PipelineRunExecutor(
PipelineRunPreview.scala:13:private[pipelines] final class PipelineRunPreview(
PipelineRunQueries.scala:18:private[pipelines] final class PipelineRunQueries(
PipelineRunSucceededWrites.scala:23:private[pipelines] final class PipelineRunSucceededWrites(
PipelineRunSupport.scala:15:private[pipelines] final class PipelineRunSupport(
PipelineRunTerminalWrites.scala:16:private[pipelines] final class PipelineRunTerminalWrites(
PipelineServiceSupport.scala:21:private[pipelines] final class PipelineServiceSupport(
PipelineStepCreate.scala:14:private[pipelines] final class PipelineStepCreate(
PipelineStepWrites.scala:15:private[pipelines] final class PipelineStepWrites(
StepPlacement.scala:10:private[pipelines] final case class CreateAnchor(anchor: Option[PipelineStepId], explicitRootId: Option[PipelineRootId], attachAsTail: Boolean)
StepPlacement.scala:15:private[pipelines] object StepPlacement {
StepReferenceChecks.scala:15:private[pipelines] final case class LaneScope(
StepReferenceChecks.scala:23:private[pipelines] object LaneScope {
StepReferenceChecks.scala:43:private[pipelines] final class StepReferenceChecks(
UpsertTargetAnalysis.scala:16:private[pipelines] object UpsertTargetAnalysis {
```

### C5. private[services]: PipelineCreatePreflight is private[services]
```
$ grep -n 'private\[services\] object' backend/src/main/scala/com/helio/services/pipelines/PipelineCreatePreflight.scala
19:private[services] object PipelineCreatePreflight {
```

### C6. files named public/entry points are unqualified (PipelineService, PipelineRunService, OutputService)
```
$ grep -nE '^final class (PipelineService|PipelineRunService|OutputService)' backend/src/main/scala/com/helio/services/pipelines/*.scala
backend/src/main/scala/com/helio/services/pipelines/OutputService.scala:24:final class OutputService(
backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala:31:final class PipelineRunService(
backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala:37:final class PipelineService(
```

### C7. PipelineRunService / PipelineService collaborators hold the listed roles: OutputRowReads = materialized-row reads; OutputRootResolution = create-time root anchoring
```
$ sed -n 10,13p backend/src/main/scala/com/helio/services/pipelines/OutputRowReads.scala; sed -n 9,11p backend/src/main/scala/com/helio/services/pipelines/OutputRootResolution.scala

/** The materialized-row read surface of `OutputService` (`rows`, `filterCapabilities`, `distinctValues`):
 *  reads an Output's own node snapshot behind the same sharing-aware `outputRepo.findById` ACL gate.
 *  Collaborators keep `OutputService`'s nullable-optional wiring (null degrades, never an NPE). */

/** Create-time root anchoring for `OutputService.create`: which pipeline root a new Output binds to.
 *  `pipelineRootRepo == null` (a fixture that doesn't wire one) skips the ambiguity check and rejects an explicit `rootId` with 400. */
```

### C8. PipelineCostInputGathering is shared by PipelineService.analyze and AutoRunTriggerService
```
$ grep -rln 'PipelineCostInputGathering' backend/src/main/scala/com/helio/services
backend/src/main/scala/com/helio/services/pipelines/PipelineCostInputGathering.scala
backend/src/main/scala/com/helio/services/pipelines/README.md
backend/src/main/scala/com/helio/services/pipelines/PipelineAnalyzeReads.scala
backend/src/main/scala/com/helio/services/pipelines/AutoRunTriggerService.scala
backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala
```

### C9. Retained: "never db.run directly" - no db.run in directory (grep exits 1 = no match)
```
$ grep -n 'db\.run' backend/src/main/scala/com/helio/services/pipelines/*.scala; echo grep-rc=$?
grep-rc=1
```

### C10. Retained: CONTRIBUTING forbids db.run outside DbContext
```
$ grep -n 'never call .db.run' CONTRIBUTING.md
105:All database access goes through `DbContext` — **never call `db.run(...)` directly in a repository**. `DbContext` wraps every action in an explicit transaction and sets the `app.current_user_id` Postgres session variable before running the action:
```

### C11. Retained: private[services] members stay reachable from other subpackage (patchsets uses PipelineCreatePreflight, which is private[services])
```
$ grep -rn 'PipelineCreatePreflight' backend/src/main/scala/com/helio/services/patchsets
backend/src/main/scala/com/helio/services/patchsets/PatchSetPipelineResolvers.scala:6:import com.helio.services.pipelines.PipelineCreatePreflight
backend/src/main/scala/com/helio/services/patchsets/PatchSetPipelineResolvers.scala:138:              PipelineCreatePreflight.run(request).left.map(prefixedWithEdit(index, _))
```

### C12. Retained: persistence dir exists
```
$ ls backend/src/main/scala/com/helio/infrastructure/persistence/pipelines | head -3
BinaryRefRepository.scala
HistoryThinBatching.scala
NodePayloadHistoryRepository.scala
```

## D. FireTimeRunConfigGateSpec banners (D4)

### D1. file length before (git HEAD) / after
```
$ git show HEAD:backend/src/test/scala/com/helio/services/pipelines/FireTimeRunConfigGateSpec.scala | wc -l; wc -l < backend/src/test/scala/com/helio/services/pipelines/FireTimeRunConfigGateSpec.scala; git show HEAD:backend/src/test/scala/com/helio/services/pipelines/FireTimeRunConfigGateSpec.scala | grep -c '// ------'; grep -c '// ------' backend/src/test/scala/com/helio/services/pipelines/FireTimeRunConfigGateSpec.scala
459
443
8
0
```

### D2. CONTRIBUTING divider threshold
```
$ sed -n 53,56p CONTRIBUTING.md
**Section dividers** (`// ── Foo ─────`) are justified only in genuinely large
files — roughly 1,000 lines and up — where they measurably cut the cost of
finding a section. In a normal-sized file they are noise; if you feel you need
them to navigate, the file wants splitting instead (see the size budgets above).
```

### D3. each banner fact is already in the class doc / names (red-first base 1bf11f55, gaps, GUARD)
```
$ grep -nE '1bf11f55|Gap 1|GUARDS|Red-first|\(gap|red-first\)|\(GUARD\)' backend/src/test/scala/com/helio/services/pipelines/FireTimeRunConfigGateSpec.scala
37: *  Gap 1 (debounced auto-run, config + cost verdict flipped after the write), gap 2 (scheduled cron
40: *  Red-first (assertion failures on unmodified main): the "gap" tests below, and the two
41: *  undecodable-step-config tests (HEL-1429: re-run against 1bf11f55, the parent of HEL-1384's merge,
43: *  GUARDS (green on main by design; each is shown failing against a deliberate mutation in the
226:  "a scheduled fire of a pipeline with a misconfigured enabled step (gap 2)" should {
278:    "skip, log and release the claim when a step is made misconfigured after the allowed write (gap 1, config)" in {
296:    "skip, log and release the claim when the cost verdict flips to denied before fire, with no dataset write (gap 1, cost)" in {
316:    "not fire a row left pending by an allowed write once a second write is denied at write time (gap 3)" in {
338:  "fire-time evaluation error: undecodable step config (red-first)" should {
379:  "negative controls (GUARD)" should {
418:  "fire-time evaluation error (GUARD)" should {
```

### D4. test names/blocks identical before and after (diff of names; empty diff = same)
```
$ diff <(git show HEAD:backend/src/test/scala/com/helio/services/pipelines/FireTimeRunConfigGateSpec.scala | grep -E '" (in|should) *\{|" (in|should)\b' | sed 's/^ *//') <(grep -E '" (in|should) *\{|" (in|should)\b' backend/src/test/scala/com/helio/services/pipelines/FireTimeRunConfigGateSpec.scala | sed 's/^ *//'); echo diff-rc=$?
diff-rc=0
```

### D5. non-comment diff of the spec = none (only removed // lines and blank lines)
```
$ git diff -U0 -- backend/src/test/scala/com/helio/services/pipelines/FireTimeRunConfigGateSpec.scala | grep '^[-+]' | grep -v '^---\|^+++' | grep -vE '^-\s*(//.*)?$'; echo rc=$?
rc=1
```

### A1b. executeRun Failure branch -> executeRunFailure returns a successful Future of Left (run-history record)
```
$ sed -n 245,258p PipelineRunExecutor.scala; grep -n -A12 "def executeRunFailure" PipelineRunTerminalWrites.scala
      .execute(pipeline, roots, steps, dataSourceRepo, assertionSink, truncationSink, onNodeProgress, writeBackSink,
        ownerUserId = Some(pipeline.ownerId.value))
      .map(outcome => (outcome.rows, outcome.stepCounts, outcome.sourceRowCount, outcome.primaryStats, outcome.nodeOutcomes))

    runFuture.transformWith {
      case Failure(ex) =>
        executeRunFailure(pipelineId, runId, pidStr, isDry, user, ownerRun, assertionSink, ex)
      case Success((resultRows, stepCounts, sourceCount, primaryStats, nodeOutcomes)) =>
        executeRunSuccess(
          pipeline, roots, pipelineId, runId, startAt, pidStr, isDry, user, ownerRun, triggerSource, assertionSink, truncationSink, writeBackSink,
          resultRows, stepCounts, sourceCount, primaryStats, nodeOutcomes
        )
    }
  }
80:  private[pipelines] def executeRunFailure(
81-      pipelineId: PipelineId,
82-      runId: PipelineRunId,
83-      pidStr: String,
84-      isDry: Boolean,
85-      user: AuthenticatedUser,
86-      ownerRun: Boolean,
87-      assertionSink: AssertionSink,
88-      ex: Throwable
89-  ): Future[Either[ServiceError, RunResultResponse]] = {
90-    // HEL-311: this single `errMsg` fans out to three client-visible
91-    // surfaces — the SSE `errorLog` event, `RunStatusResponse.error`,
92-    // and the persisted `PipelineRunRecord.errorLog` returned by
93-    // run-history. Genericizing here (keeping the static prefix, logging
94-    // the raw cause server-side) covers all three at construction.
```

## Cycle 2: C4 inverse probes (README visibility notes)
### C4b. For each of the 25 files the README marks private[pipelines]: any UNQUALIFIED top-level class/object/trait (only the documented StepReferenceChecks companion may appear)
```
$ grep -nE '^(final |sealed |abstract )*(case )?(class|object|trait) ' InlineSourceCompensation.scala OrphanedRunReaper.scala OutputRootResolution.scala OutputRowReads.scala PipelineAnalyzeReads.scala PipelineAutoRunDebounceFirer.scala PipelineCreateTransaction.scala PipelineCreateWrites.scala PipelineNodeReads.scala PipelineProposalAnalyze.scala PipelineRootWrites.scala PipelineRunBackfill.scala PipelineRunDeletedRecovery.scala PipelineRunExecutor.scala PipelineRunPreview.scala PipelineRunQueries.scala PipelineRunSucceededWrites.scala PipelineRunSupport.scala PipelineRunTerminalWrites.scala PipelineServiceSupport.scala PipelineStepCreate.scala PipelineStepWrites.scala StepPlacement.scala StepReferenceChecks.scala UpsertTargetAnalysis.scala
StepReferenceChecks.scala:80:object StepReferenceChecks {
rc=0

### C4c. Any private[services] top-level in those files (README says private[pipelines] for all of them)
$ grep -nE '^private\[services\]' InlineSourceCompensation.scala OrphanedRunReaper.scala OutputRootResolution.scala OutputRowReads.scala PipelineAnalyzeReads.scala PipelineAutoRunDebounceFirer.scala PipelineCreateTransaction.scala PipelineCreateWrites.scala PipelineNodeReads.scala PipelineProposalAnalyze.scala PipelineRootWrites.scala PipelineRunBackfill.scala PipelineRunDeletedRecovery.scala PipelineRunExecutor.scala PipelineRunPreview.scala PipelineRunQueries.scala PipelineRunSucceededWrites.scala PipelineRunSupport.scala PipelineRunTerminalWrites.scala PipelineServiceSupport.scala PipelineStepCreate.scala PipelineStepWrites.scala StepPlacement.scala StepReferenceChecks.scala UpsertTargetAnalysis.scala
rc=1

### C4d. StepReferenceChecks companion member and its cross-package use
88:  private[services] def secondarySourceOwnershipF(
../patchsets/PatchSetPipelineStepResolvers.scala:259:    StepReferenceChecks.secondarySourceOwnershipF(ctx.dataSourceRepo, typedConfig, user).map(_.left.map(id =>
```
