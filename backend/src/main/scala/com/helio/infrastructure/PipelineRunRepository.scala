package com.helio.infrastructure

import com.helio.domain.{AuthenticatedUser, PipelineId, PipelineRunId}
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

  private val runsTable      = TableQuery[PipelineRunTable]
  private val pipelinesTable = TableQuery[PipelineRepository.PipelineTable]

  private def pipelineOwnedAction(pipelineId: PipelineId, user: AuthenticatedUser) = {
    val ownerUuid = UUID.fromString(user.id.value)
    pipelinesTable.filter(p => p.id === pipelineId.value && p.ownerId === ownerUuid).exists.result
  }

  /** Owner-scoped insert. Silent no-op when the caller does not own the
    * parent pipeline. */
  def insertRun(runId: PipelineRunId, pipelineId: PipelineId, startedAt: Instant, user: AuthenticatedUser): Future[Unit] =
    ctx.withUserContext(user.id.value)(pipelineOwnedAction(pipelineId, user)).flatMap {
      case false => Future.successful(())
      case true  => insertRunInternal(runId, pipelineId, startedAt)
    }

  /** ACL-bypassing insertRun for the privileged Spark driver path. */
  def insertRunInternal(runId: PipelineRunId, pipelineId: PipelineId, startedAt: Instant): Future[Unit] = {
    val row = PipelineRunRow(
      id          = runId.value,
      pipelineId  = pipelineId.value,
      status      = "queued",
      startedAt   = startedAt,
      completedAt = None,
      rowCount    = None,
      errorLog    = None
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
    * the parent pipeline. */
  def insertDryRun(runId: PipelineRunId, pipelineId: PipelineId, startedAt: Instant, rowCount: Int, user: AuthenticatedUser): Future[Unit] =
    ctx.withUserContext(user.id.value)(pipelineOwnedAction(pipelineId, user)).flatMap {
      case false => Future.successful(())
      case true  => insertDryRunInternal(runId, pipelineId, startedAt, rowCount)
    }

  /** ACL-bypassing dry-run insert for the privileged Spark driver path. */
  def insertDryRunInternal(runId: PipelineRunId, pipelineId: PipelineId, startedAt: Instant, rowCount: Int): Future[Unit] = {
    val row = PipelineRunRow(
      id          = runId.value,
      pipelineId  = pipelineId.value,
      status      = "dry_run",
      startedAt   = startedAt,
      completedAt = Some(startedAt),
      rowCount    = Some(rowCount),
      errorLog    = None
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
}

object PipelineRunRepository {

  case class PipelineRunRow(
      id: String,
      pipelineId: String,
      status: String,
      startedAt: Instant,
      completedAt: Option[Instant],
      rowCount: Option[Int],
      errorLog: Option[String]
  )

  class PipelineRunTable(tag: Tag) extends Table[PipelineRunRow](tag, "pipeline_runs") {
    def id          = column[String]("id", O.PrimaryKey)
    def pipelineId  = column[String]("pipeline_id")
    def status      = column[String]("status")
    def startedAt   = column[Instant]("started_at")
    def completedAt = column[Option[Instant]]("completed_at")
    def rowCount    = column[Option[Int]]("row_count")
    def errorLog    = column[Option[String]]("error_log")

    def * = (id, pipelineId, status, startedAt, completedAt, rowCount, errorLog).mapTo[PipelineRunRow]
  }
}
