package com.helio.infrastructure

import com.helio.domain.{AssertionResult, AuthenticatedUser, PipelineId, PipelineRunId}
import slick.jdbc.PostgresProfile.api._
import PipelineRepository.instantColumnType

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Persistence layer for `pipeline_runs`.
 *
 *  HEL-265 CS2: all reads and writes are gated by the parent pipeline's
 *  `owner_id`. Runs inherit ACL from their parent pipeline (no separate
 *  `owner_id` column). Writes that the caller cannot prove ownership of
 *  become silent no-ops — keeps the run-lifecycle path resilient to a
 *  pipeline being deleted mid-run.
 *
 *  The privileged Spark driver path uses [[insertRunInternal]] /
 *  [[insertDryRunInternal]] / [[updateRunTerminalInternal]] /
 *  [[deleteOldRunsInternal]] / [[deleteOldDryRunsInternal]]; the
 *  pipeline ACL was checked at submit time and the background driver
 *  does not carry a request-bound user. */
class PipelineRunRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  import PipelineRunRepository._

  private val runsTable       = TableQuery[PipelineRunTable]
  private val pipelinesTable  = TableQuery[PipelineRepository.PipelineTable]
  private val assertionsTable = TableQuery[PipelineRunAssertionTable]

  private def pipelineOwnedAction(pipelineId: PipelineId, user: AuthenticatedUser) = {
    val ownerUuid = UUID.fromString(user.id.value)
    pipelinesTable.filter(p => p.id === pipelineId.value && p.ownerId === ownerUuid).exists.result
  }

  /** Owner-scoped insert. Silent no-op when the caller does not own the
    * parent pipeline. `triggerSource` defaults to `"manual"` (rather than
    * requiring every test/caller to pass the literal) -- the real callers
    * that care (`PipelineRunService.executeRun`, the HEL-415 scheduler path)
    * always pass it explicitly. `triggeredByTokenId` (HEL-369) is the id of
    * the scoped or unscoped PAT that authenticated an external trigger, or
    * `None` for every other trigger source. */
  def insertRun(
      runId: PipelineRunId,
      pipelineId: PipelineId,
      startedAt: Instant,
      user: AuthenticatedUser,
      triggerSource: String = "manual",
      triggeredByTokenId: Option[String] = None
  ): Future[Unit] =
    ctx.withUserContext(user.id.value)(pipelineOwnedAction(pipelineId, user)).flatMap {
      case false => Future.successful(())
      case true  => insertRunInternal(runId, pipelineId, startedAt, triggerSource, triggeredByTokenId)
    }

  /** ACL-bypassing insertRun for the privileged Spark driver path.
    * `triggeredByTokenId` is the domain-facing `ApiTokenId.value` string;
    * converted to the column's `UUID` type here (mirrors every other
    * String-domain-id-over-UUID-column conversion in this repository, e.g.
    * `user.id.value` -> `UUID.fromString` above). */
  def insertRunInternal(
      runId: PipelineRunId,
      pipelineId: PipelineId,
      startedAt: Instant,
      triggerSource: String = "manual",
      triggeredByTokenId: Option[String] = None
  ): Future[Unit] = {
    val row = PipelineRunRow(
      id                 = runId.value,
      pipelineId         = pipelineId.value,
      status             = "queued",
      startedAt          = startedAt,
      completedAt        = None,
      rowCount           = None,
      errorLog           = None,
      triggerSource      = triggerSource,
      triggeredByTokenId = triggeredByTokenId.map(UUID.fromString)
    )
    ctx.withSystemContext(runsTable += row).map(_ => ())
  }

  /** Owner-scoped terminal update via JOIN to `pipelines.owner_id`. Silent
    * no-op when the caller does not own the parent pipeline. */
  def updateRunTerminal(
      runId: PipelineRunId,
      status: String,
      completedAt: Instant,
      rowCount: Option[Int],
      errorLog: Option[String],
      user: AuthenticatedUser
  ): Future[Unit] = {
    val ownerUuid = UUID.fromString(user.id.value)
    val ownedRunQuery = for {
      run      <- runsTable if run.id === runId.value
      pipeline <- pipelinesTable if pipeline.id === run.pipelineId && pipeline.ownerId === ownerUuid
    } yield run.id
    ctx.withUserContext(user.id.value)(ownedRunQuery.result.headOption).flatMap {
      case None      => Future.successful(())
      case Some(rid) => updateRunTerminalInternal(PipelineRunId(rid), status, completedAt, rowCount, errorLog)
    }
  }

  /** ACL-bypassing terminal update for the privileged Spark driver path. */
  def updateRunTerminalInternal(
      runId: PipelineRunId,
      status: String,
      completedAt: Instant,
      rowCount: Option[Int] = None,
      errorLog: Option[String] = None
  ): Future[Unit] =
    ctx.withSystemContext(
      runsTable
        .filter(_.id === runId.value)
        .map(r => (r.status, r.completedAt, r.rowCount, r.errorLog))
        .update((status, Some(completedAt), rowCount, errorLog))
    ).map(_ => ())

  /** Owner-scoped dry-run insert. Silent no-op when the caller does not own
    * the parent pipeline. Dry runs are always triggered interactively (the
    * scheduler never dry-runs), so `triggerSource` is always `"manual"` --
    * no caller-supplied parameter. */
  def insertDryRun(runId: PipelineRunId, pipelineId: PipelineId, startedAt: Instant, rowCount: Int, user: AuthenticatedUser): Future[Unit] =
    ctx.withUserContext(user.id.value)(pipelineOwnedAction(pipelineId, user)).flatMap {
      case false => Future.successful(())
      case true  => insertDryRunInternal(runId, pipelineId, startedAt, rowCount)
    }

  /** ACL-bypassing dry-run insert for the privileged Spark driver path. */
  def insertDryRunInternal(runId: PipelineRunId, pipelineId: PipelineId, startedAt: Instant, rowCount: Int): Future[Unit] = {
    val row = PipelineRunRow(
      id            = runId.value,
      pipelineId    = pipelineId.value,
      status        = "dry_run",
      startedAt     = startedAt,
      completedAt   = Some(startedAt),
      rowCount      = Some(rowCount),
      errorLog      = None,
      triggerSource = "manual"
    )
    ctx.withSystemContext(runsTable += row).map(_ => ())
  }

  /**
   * Owner-scoped retention pass. Silent no-op when the caller does not own
   * the parent pipeline.
   */
  def deleteOldRuns(pipelineId: PipelineId, user: AuthenticatedUser, keepN: Int = 10): Future[Unit] =
    ctx.withUserContext(user.id.value)(pipelineOwnedAction(pipelineId, user)).flatMap {
      case false => Future.successful(())
      case true  => deleteOldRunsInternal(pipelineId, keepN)
    }

  /** ACL-bypassing retention pass for the privileged Spark driver path. */
  def deleteOldRunsInternal(pipelineId: PipelineId, keepN: Int = 10): Future[Unit] = {
    val pid = pipelineId.value
    val keepIds = runsTable
      .filter(r => r.pipelineId === pid && r.status =!= "dry_run")
      .sortBy(_.startedAt.desc)
      .take(keepN)
      .map(_.id)

    val action = runsTable
      .filter(r => r.pipelineId === pid && r.status =!= "dry_run" && !r.id.in(keepIds))
      .delete

    ctx.withSystemContext(action).map(_ => ())
  }

  /**
   * Owner-scoped dry-run retention. Silent no-op when the caller does not
   * own the parent pipeline.
   */
  def deleteOldDryRuns(pipelineId: PipelineId, user: AuthenticatedUser, keepN: Int = 10): Future[Unit] =
    ctx.withUserContext(user.id.value)(pipelineOwnedAction(pipelineId, user)).flatMap {
      case false => Future.successful(())
      case true  => deleteOldDryRunsInternal(pipelineId, keepN)
    }

  /** ACL-bypassing dry-run retention for the privileged Spark driver path. */
  def deleteOldDryRunsInternal(pipelineId: PipelineId, keepN: Int = 10): Future[Unit] = {
    val pid = pipelineId.value
    val keepIds = runsTable
      .filter(r => r.pipelineId === pid && r.status === "dry_run")
      .sortBy(_.startedAt.desc)
      .take(keepN)
      .map(_.id)

    val action = runsTable
      .filter(r => r.pipelineId === pid && r.status === "dry_run" && !r.id.in(keepIds))
      .delete

    ctx.withSystemContext(action).map(_ => ())
  }

  /** Owner-scoped list of runs for a pipeline. Empty vector when the caller
    * does not own the parent pipeline. */
  def listByPipeline(pipelineId: PipelineId, user: AuthenticatedUser): Future[Vector[PipelineRunRow]] = {
    val ownerUuid = UUID.fromString(user.id.value)
    val query = for {
      run      <- runsTable if run.pipelineId === pipelineId.value
      pipeline <- pipelinesTable if pipeline.id === run.pipelineId && pipeline.ownerId === ownerUuid
    } yield run
    ctx.withUserContext(user.id.value)(query.sortBy(_.startedAt.desc).result).map(_.toVector)
  }

  /** ACL-bypassing list of runs. Safe to call only after the caller's pipeline
    * access has been confirmed via PipelineRepository.findByIdShared. Used by
    * PipelineRunService.history to support viewer/editor grantees. */
  def listByPipelineInternal(pipelineId: PipelineId): Future[Vector[PipelineRunRow]] =
    ctx.withSystemContext(
      runsTable
        .filter(_.pipelineId === pipelineId.value)
        .sortBy(_.startedAt.desc)
        .result
    ).map(_.toVector)

  /** ACL-bypassing check for an in-flight run (`completed_at IS NULL`) for a
    * pipeline — the persisted half of `PipelineSchedulerService`'s overlap
    * guard (HEL-415). Catches a still-running run across a scheduler
    * restart (the in-memory guard is lost) or a manually-submitted run in
    * flight when a schedule comes due. System context: the scheduler
    * background job has no request-bound user. */
  def hasActiveRunInternal(pipelineId: PipelineId): Future[Boolean] =
    ctx.withSystemContext(
      runsTable.filter(r => r.pipelineId === pipelineId.value && r.completedAt.isEmpty).exists.result
    )

  /** ACL-bypassing lookup of the in-flight run (`completed_at IS NULL`) for a
    * pipeline, if any -- same predicate as [[hasActiveRunInternal]], but
    * returning the row so `HookTriggerService` can collapse a duplicate
    * external trigger into the existing run's id/status (HEL-369 design.md
    * Decision 6) instead of starting a second one. `headOption` is safe:
    * at most one run per pipeline can have a null `completed_at` at a time
    * (the scheduler/hook overlap guard is what keeps that invariant true). */
  def findActiveRunInternal(pipelineId: PipelineId): Future[Option[PipelineRunRow]] =
    ctx.withSystemContext(
      runsTable.filter(r => r.pipelineId === pipelineId.value && r.completedAt.isEmpty).result.headOption
    )

  // ── HEL-509 (419-B): pipeline_run_assertions ──────────────────────────────

  /** Privileged insert for the [[AssertionResult]]s evaluated during a run
    * (design.md Decision 6 — always `withSystemContext`, mirroring
    * `insertRunInternal`'s privileged pattern; the run itself was already
    * inserted owner-scoped, so there is no meaningfully-different ownership
    * check to perform here). No-op for an empty `results`. */
  def insertAssertions(runId: PipelineRunId, results: Seq[AssertionResult]): Future[Unit] =
    if (results.isEmpty) Future.successful(())
    else {
      val rows = results.map { r =>
        PipelineRunAssertionRow(
          id       = UUID.randomUUID().toString,
          runId    = runId.value,
          stepId   = r.stepId,
          kind     = r.kind,
          field    = r.field,
          severity = r.severity,
          passed   = r.passed,
          observed = r.observed,
          message  = r.message
        )
      }
      ctx.withSystemContext(assertionsTable ++= rows).map(_ => ())
    }

  /** Owner-scoped list of assertion results for a run, via JOIN through the
    * parent `pipeline_runs` row to `pipelines.owner_id`. Empty vector when
    * the caller does not own the parent pipeline. */
  def listAssertionsByRun(runId: PipelineRunId, user: AuthenticatedUser): Future[Vector[PipelineRunAssertionRow]] = {
    val ownerUuid = UUID.fromString(user.id.value)
    val query = for {
      a        <- assertionsTable if a.runId === runId.value
      run      <- runsTable if run.id === a.runId
      pipeline <- pipelinesTable if pipeline.id === run.pipelineId && pipeline.ownerId === ownerUuid
    } yield a
    ctx.withUserContext(user.id.value)(query.result).map(_.toVector)
  }

  /** ACL-bypassing list of assertion results for a run. Safe to call only
    * after the caller's run/pipeline access has been confirmed at the
    * service layer (mirrors `listByPipelineInternal` — a future
    * grantee-aware caller's job to wire up, per design.md Decision 6). */
  def listAssertionsByRunInternal(runId: PipelineRunId): Future[Vector[PipelineRunAssertionRow]] =
    ctx.withSystemContext(assertionsTable.filter(_.runId === runId.value).result).map(_.toVector)
}

object PipelineRunRepository {

  case class PipelineRunRow(
      id: String,
      pipelineId: String,
      status: String,
      startedAt: Instant,
      completedAt: Option[Instant],
      rowCount: Option[Int],
      errorLog: Option[String],
      triggerSource: String,
      // HEL-369: UUID (not String) -- matches the column's REFERENCES
      // api_tokens(id) type; converted to/from the domain-facing
      // ApiTokenId.value string at the repository boundary (insertRunInternal's
      // param, PipelineRunService.history's mapping).
      triggeredByTokenId: Option[UUID] = None
  )

  class PipelineRunTable(tag: Tag) extends Table[PipelineRunRow](tag, "pipeline_runs") {
    def id                 = column[String]("id", O.PrimaryKey)
    def pipelineId         = column[String]("pipeline_id")
    def status             = column[String]("status")
    def startedAt          = column[Instant]("started_at")
    def completedAt        = column[Option[Instant]]("completed_at")
    def rowCount           = column[Option[Int]]("row_count")
    def errorLog           = column[Option[String]]("error_log")
    def triggerSource      = column[String]("trigger_source")
    def triggeredByTokenId = column[Option[UUID]]("triggered_by_token_id")

    def * = (id, pipelineId, status, startedAt, completedAt, rowCount, errorLog, triggerSource, triggeredByTokenId).mapTo[PipelineRunRow]
  }

  // ── HEL-509 (419-B): pipeline_run_assertions ──────────────────────────────

  case class PipelineRunAssertionRow(
      id: String,
      runId: String,
      stepId: String,
      kind: String,
      field: Option[String],
      severity: String,
      passed: Boolean,
      observed: Option[String],
      message: Option[String]
  )

  class PipelineRunAssertionTable(tag: Tag) extends Table[PipelineRunAssertionRow](tag, "pipeline_run_assertions") {
    def id       = column[String]("id", O.PrimaryKey)
    def runId    = column[String]("run_id")
    def stepId   = column[String]("step_id")
    def kind     = column[String]("kind")
    def field    = column[Option[String]]("field")
    def severity = column[String]("severity")
    def passed   = column[Boolean]("passed")
    def observed = column[Option[String]]("observed")
    def message  = column[Option[String]]("message")

    def * = (id, runId, stepId, kind, field, severity, passed, observed, message).mapTo[PipelineRunAssertionRow]
  }
}
