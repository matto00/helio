package com.helio.services.pipelines

import com.helio.services.ServiceError
import com.helio.api.protocols.pipelines.{RunResultResponse, TruncatedReadResponse}
import com.helio.api.routes.pipelines.{PipelineRunRegistry, RunStatusEvent}
import com.helio.domain.model.{AssertionResult, AssertionSink, AuthenticatedUser, Pipeline, PipelineId, PipelineRunId}
import com.helio.domain.engine.StepExecutionException
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineRunRepository}
import org.slf4j.LoggerFactory
import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** The terminal persist-then-publish paths: the HEL-1366 `publishTerminalAfter` primitive and the failed,
 *  dry_run, write-back-failed and blocked terminal paths that publish through it. Split out of
 *  `PipelineRunService` (HEL-1371). */
private[pipelines] final class PipelineRunTerminalWrites(
    pipelineRepo: PipelineRepository,
    pipelineRunRepo: PipelineRunRepository,
    registry: PipelineRunRegistry,
    support: PipelineRunSupport
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(classOf[PipelineRunService])
  import support.{executionFailureError, logExecutionFailure, truncatedReadsToJson}

  private[pipelines] def publish(pipelineId: String, event: RunStatusEvent): Unit =
    if (registry != null) registry.publish(pipelineId, event)

  /** HEL-1366: publishes a run's TERMINAL event only once `writes` (the path's own durable terminal
   *  writes) has completed, so any subscriber reacting to it reads the terminal state. Publishes
   *  exactly once whether `writes` succeeds or fails (a subscriber is never left waiting), and
   *  returns `writes` unchanged. Every terminal path calls this exactly once per run. */
  private[pipelines] def publishTerminalAfter[T](pipelineId: String, event: RunStatusEvent, writes: => Future[T]): Future[T] =
    // `writes` is by-name and started inside `Future.unit.flatMap`, so a synchronous throw while
    // building the chain becomes a failed Future and still reaches the publish below.
    Future.unit.flatMap(_ => writes).transformWith { outcome =>
      publish(pipelineId, event)
      Future.fromTry(outcome)
    }

  /** The `Failure(ex)` branch of `executeRun`'s original inline `transformWith` (HEL-505: factored
   *  out, unchanged in behavior, so the guard-check nesting added above it doesn't push this
   *  method's line count past the file-size budget). */
  private[pipelines] def executeRunFailure(
      pipelineId: PipelineId,
      runId: PipelineRunId,
      pidStr: String,
      isDry: Boolean,
      user: AuthenticatedUser,
      assertionSink: AssertionSink,
      ex: Throwable
  ): Future[Either[ServiceError, RunResultResponse]] = {
        // HEL-311: this single `errMsg` fans out to three client-visible
        // surfaces — the SSE `errorLog` event, `RunStatusResponse.error`,
        // and the persisted `PipelineRunRecord.errorLog` returned by
        // run-history. Genericizing here (keeping the static prefix, logging
        // the raw cause server-side) covers all three at construction.
        logExecutionFailure(s"Pipeline execution failed for pipeline ${pipelineId.value}, run ${runId.value}", ex)
        // HEL-859 (design.md Decision 3, Decision 3a): when the failure was
        // attributed to a specific step by the in-process engine, forward its
        // curated message (id, kind, allowlisted reason); the Spark path
        // (out of scope) never produces a StepExecutionException, so it still
        // falls through to the generic constant.
        val errMsg = ex match {
          case see: StepExecutionException => see.getMessage
          case _                           => "Pipeline execution failed"
        }
        def failWork(): Future[Unit] =
          // HEL-509 (419-B, design.md Decision 4): a failed dry run has no
          // `pipeline_runs` row to attach assertion results to (a dry run's
          // row is inserted only on success, see onDryRunSuccess below) — the
          // `insertAssertions` call below MUST stay nested inside this
          // existing `if (!isDry)` guard, never called unconditionally.
          if (!isDry) {
            val updateRun =
              if (pipelineRunRepo != null)
                // HEL-873 (design.md Decision 2a): a failed run records `[]`, never NULL.
                pipelineRunRepo.updateRunTerminal(runId, "failed", Instant.now(), rowCount = None, errorLog = Some(errMsg), user, truncatedReadsJson = Some(PipelineRunService.EmptyTruncationJson))
              else Future.successful(())
            updateRun.flatMap { _ =>
              pipelineRepo.updateLastRun(pipelineId, "failed", Instant.now(), rowCount = None, user, truncated = Some(false))
            }.flatMap { _ =>
              persistAssertions(runId, assertionSink.results)
            }
          } else Future.successful(())
        // HEL-1366: terminal event only after the failed status + last-run + assertions are written.
        publishTerminalAfter(pidStr, RunStatusEvent("failed", errorLog = Some(errMsg), runId = Some(runId.value)), failWork())
          .map(_ => Left(executionFailureError(ex)))
  }

  /** Best-effort persistence of assertion results — wrapped in `recoverWith`
   *  at every call site (design.md Decision 4a), mirroring the file's
   *  existing `insertRun`/`deleteOldRuns` and `insertDryRun`/
   *  `deleteOldDryRuns` best-effort pattern. `insertRun`/`insertDryRun`
   *  already silently no-op for a caller who does not own the parent
   *  pipeline (e.g. an editor grantee triggering a run via
   *  `POST /api/pipelines/:id/run`), leaving no `pipeline_runs` row for
   *  `insertAssertions` to FK against — without this guard, that would turn
   *  today's silent no-op into an unhandled failed `Future`. Skips the call
   *  entirely when there is nothing to persist. */
  private[pipelines] def persistAssertions(runId: PipelineRunId, results: Vector[AssertionResult]): Future[Unit] =
    if (pipelineRunRepo != null && results.nonEmpty)
      pipelineRunRepo.insertAssertions(runId, results).recoverWith { case _ => Future.successful(()) }
    else Future.successful(())

  private[pipelines] def onDryRunSuccess(
      pipelineId:       PipelineId,
      runId:            PipelineRunId,
      startAt:          Instant,
      pidStr:           String,
      rowCount:         Int,
      user:             AuthenticatedUser,
      assertionResults: Vector[AssertionResult],
      // HEL-873 (evaluation-1.md CR1): persisted verbatim alongside `truncatedReads`, never
      // re-inferred from it on read -- see `truncatedReadsToJson`'s doc.
      primaryAvailableRowCount: Option[Long],
      // HEL-873 (design.md Decision 2a): a dry run inserts an already-terminal row in one
      // statement (bypassing `updateRunTerminalInternal` entirely) -- it must never persist NULL.
      truncatedReads:   Vector[TruncatedReadResponse]
  ): Future[Unit] = {
    // HEL-1366: the terminal event is published only after the dry-run record (and its assertions)
    // is durable -- `publishTerminalAfter` wraps the whole write chain below.
    def dryRunWrites(): Future[Unit] =
      if (pipelineRunRepo != null)
        pipelineRunRepo
          .insertDryRun(runId, pipelineId, startAt, rowCount, user, truncatedReadsToJson(primaryAvailableRowCount, truncatedReads))
          .flatMap(_ => pipelineRunRepo.deleteOldDryRuns(pipelineId, user))
          .recoverWith { case _ => Future.successful(()) }
          // HEL-509 (419-B, design.md Decision 5): insertAssertions must be
          // sequenced AFTER insertDryRun's own row insert completes — the FK
          // needs the parent `pipeline_runs` row to exist first. This dry run's
          // row is inserted above (unlike the real-run path, where insertRun
          // already ran during preExec).
          .flatMap(_ => persistAssertions(runId, assertionResults))
      else Future.successful(())
    publishTerminalAfter(pidStr, RunStatusEvent("dry_run", rowCount = Some(rowCount), runId = Some(runId.value)), dryRunWrites())
  }

  /** HEL-1100 (design.md Decision 3): the SAME terminal-failure bookkeeping the `executeRun`
   *  Failure branch performs (`Failure(ex)` above) -- a write-back failure is a run failure,
   *  discovered one step later (after the engine's own Future already succeeded), so it must
   *  leave the pipeline/run rows in the identical terminal "failed" state, with the SAME
   *  assertion-persistence step (assertions were already evaluated even though the run's
   *  eventual write failed). */
  private[pipelines] def onWriteBackFailure(
      pipelineId: PipelineId,
      runId: PipelineRunId,
      pidStr: String,
      user: AuthenticatedUser,
      assertionResults: Vector[AssertionResult],
      errMsg: String
  ): Future[Unit] = {
    log.error(s"Pipeline write-back failed for pipeline ${pipelineId.value}, run ${runId.value}: $errMsg")
    def writes(): Future[Unit] = {
      val updateRun =
        if (pipelineRunRepo != null)
          pipelineRunRepo.updateRunTerminal(runId, "failed", Instant.now(), rowCount = None, errorLog = Some(errMsg), user, truncatedReadsJson = Some(PipelineRunService.EmptyTruncationJson))
        else Future.successful(())
      updateRun.flatMap { _ =>
        pipelineRepo.updateLastRun(pipelineId, "failed", Instant.now(), rowCount = None, user, truncated = Some(false))
      }.flatMap { _ =>
        persistAssertions(runId, assertionResults)
      }
    }
    // HEL-1366: terminal event only after the failed status is durable.
    publishTerminalAfter(pidStr, RunStatusEvent("failed", errorLog = Some(errMsg), runId = Some(runId.value)), writes())
  }

  /** Blocked branch (design.md Decisions 2-4): terminal status `"failed"`
   *  with a real, structured `errorLog` (not the generic exception-path
   *  placeholder), `rowCount = None` (nothing was written, mirroring the
   *  execution-failure branch's own convention), and the FULL assertion
   *  results vector persisted unconditionally (419-B's existing behavior,
   *  unchanged). The Output's schema/row/binary-ref writes and alert
   *  evaluation are never invoked. */
  private[pipelines] def onBlockedRun(
      pipelineId:       PipelineId,
      runId:            PipelineRunId,
      pidStr:           String,
      user:             AuthenticatedUser,
      assertionResults: Vector[AssertionResult],
      blockingFailures: Vector[AssertionResult]
  ): Future[Option[String]] = {
    val summary = summarizeBlockingFailures(blockingFailures)
    def writes(): Future[Option[String]] = {
      val now = Instant.now()
      // HEL-873 (design.md Decision 2a): a blocked run is persisted as a failed run -- `[]`, never
      // NULL.
      val updateMeta = pipelineRepo.updateLastRun(pipelineId, "failed", now, rowCount = None, user, truncated = Some(false)).map(_ => ())
      val updateRun =
        if (pipelineRunRepo != null)
          pipelineRunRepo.updateRunTerminal(runId, "failed", now, rowCount = None, errorLog = Some(summary), user, truncatedReadsJson = Some(PipelineRunService.EmptyTruncationJson)).map(_ => ())
        else Future.successful(())
      val assertionsInsert = persistAssertions(runId, assertionResults)
        for {
          _ <- updateMeta
          _ <- updateRun
          _ <- assertionsInsert
        } yield Some(summary)
    }
    // HEL-1366: terminal event only after the failed status + last-run + assertions are written.
    publishTerminalAfter(pidStr, RunStatusEvent("failed", errorLog = Some(summary), runId = Some(runId.value)), writes())
  }

  /** design.md Decision 2: joins each blocking failure's `kind`/`field`/
   *  `message` into one readable line — a real, structured summary (not the
   *  generic exception-path placeholder), used both for `errorLog` and for
   *  `RunResultResponse.blockedReason`. */
  private def summarizeBlockingFailures(failures: Vector[AssertionResult]): String = {
    val details = failures.map { f =>
      val fieldPart = f.field.map(fld => s"($fld)").getOrElse("")
      val messagePart = f.message.getOrElse("assertion failed")
      s"${f.kind}$fieldPart: $messagePart"
    }.mkString("; ")
    s"Run blocked: ${failures.size} error-severity assertion(s) failed — $details"
  }
}
