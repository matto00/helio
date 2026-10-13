# Mutation / red evidence (HEL-1518)

Each mutation applied temporarily to main code, `testOnly com.helio.services.pipelines.LateFinisherRunSpec`, then reverted.

- M1 guard keyed on `completed_at IS NULL` alone (dropped `|| status == "succeeded"`): positive control FAILED
  (`false was not equal to true`, result not Right); C1 non-vacuous.
- M2 run row `FOR KEY SHARE` instead of `FOR SHARE`: "make a reap wait for an open node transaction" FAILED
  ("no backend ever blocked on a lock").
- M3 pipeline-row `FOR KEY SHARE` removed: "concurrent pipeline delete ... without a deadlock" FAILED
  (`PSQLException: ERROR: deadlock detected ... while deleting tuple in relation "pipeline_runs"`).
- M4 guard not passed to node writes: reaped-in-window case returned Right; deleted-in-window case failed with an FK
  violation on `output_snapshot_history_output_id_fkey`.
- M5 Missing always mapped to 409: both 404 cases FAILED (`Left(Conflict(...)) was not equal to Left(NotFound(...))`).
- M6 (CR1) `failIfLostTerminalWrite` replaced by `Future.unit`: both D7 cases FAILED, each with
  `Right(RunResultResponse(...))` where 404 / 409 is required (delete before Output list; reap after last node).
- Red on unmodified main (first cycle): 404 case `Left(Conflict(...)) was not equal to Left(NotFound(...))`; reap-in-window
  `Right(RunResultResponse(...))`.

## Task 3.1 call-site evidence (`grep -n -B..`)
--- backend/src/main/scala/com/helio/services/pipelines/OrphanedRunReaper.scala
24-  def reap(now: Instant): Future[Unit] =
25-    // Privileged (system context): the scheduler tick has no request user, and the reap must see and finalize every
26-    // owner's stale runs; the user pool's owner-scoped RLS would match none of them. Bypassing RLS is correct here: the
27-    // statement takes no caller input and only finalizes runs past the stale bound.
28:    runRepo
--- backend/src/main/scala/com/helio/services/pipelines/PipelineRunExecutor.scala
390-  private def runState(runId: PipelineRunId): Future[RunState] =
391-    // Privileged read (`runStateInternal`): the run id is server-generated, inserted by this executor, and an
392-    // editor-admitted run belongs to the pipeline OWNER, so it is invisible to the editor's own RLS context. Bypassing
393-    // RLS is correct: the lookup discloses nothing to the caller beyond the open/terminal/missing outcome.
394:    if (pipelineRunRepo == null) Future.successful(RunState.Open) else pipelineRunRepo.runStateInternal(runId)
--- backend/src/main/scala/com/helio/services/pipelines/PipelineRunExecutor.scala
--- backend/src/main/scala/com/helio/services/pipelines/PipelineRunSucceededWrites.scala
--- PipelineRunExecutor findByIdInternal
60:        pipelineRepo.findByIdInternal(pipelineId).map {
--
373-    case RunState.Missing =>
374-      // Privileged existence check (read-only), keyed by the id `submit` already authorized -- the same pattern as
375-      // the submit-time `pipelineGone` check; the user pool may not see a pipeline the run's submitter only edits.
376:      pipelineRepo.findByIdInternal(pipelineId).map {
--- PipelineRunSucceededWrites guard
72-      // HEL-1518 (design.md D3): each node's snapshot transaction starts with the run guard, so a run reaped or
73-      // deleted since the early open-check writes nothing for that node. Only a real run (a wired run repository)
74-      // has one, matching the executor's early-check fixture rule. Privileged: the guard runs inside the node write's
75-      // own `withSystemContext` transaction (which already bypasses RLS to write `node_snapshots`/history), and the
76-      // pipeline and run rows it locks may belong to an owner other than the submitting editor; locking them discloses
77-      // nothing and writes nothing.
78:      val guard: Option[DBIO[Unit]] = Option(pipelineRunRepo).map(_.runGuardAction(pipelineId, runId))
--- PipelineRunRepository runStateInternal / runGuardAction
334-    * finalized) or missing (deleted with its pipeline, or pruned). The success chain reads it before any side effect,
335-    * so a run reaped while its instance stalled cannot write snapshots or write-backs. */
336:  def runStateInternal(runId: PipelineRunId): Future[RunState] =
--
351-    * eager sibling of the node fold, so on a healthy run it can commit before a node's write). Must run inside an
352-    * already-privileged (`withSystemContext`) transaction: it reads rows the user pool's RLS may hide. */
353:  def runGuardAction(pipelineId: PipelineId, runId: PipelineRunId): DBIO[Unit] =
