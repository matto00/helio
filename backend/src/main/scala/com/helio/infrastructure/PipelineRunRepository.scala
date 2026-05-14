package com.helio.infrastructure

import com.helio.domain.{PipelineId, PipelineRunId}
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import PipelineRepository.instantColumnType

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

class PipelineRunRepository(db: JdbcBackend.Database)(implicit ec: ExecutionContext) {

  import PipelineRunRepository._

  private val runsTable = TableQuery[PipelineRunTable]

  /** Insert a new run record in "queued" state. */
  def insertRun(runId: PipelineRunId, pipelineId: PipelineId, startedAt: Instant): Future[Unit] = {
    val row = PipelineRunRow(
      id          = runId.value,
      pipelineId  = pipelineId.value,
      status      = "queued",
      startedAt   = startedAt,
      completedAt = None,
      rowCount    = None,
      errorLog    = None
    )
    db.run(runsTable += row).map(_ => ())
  }

  /** Update a run to a terminal state (succeeded or failed). */
  def updateRunTerminal(
      runId: PipelineRunId,
      status: String,
      completedAt: Instant,
      rowCount: Option[Int] = None,
      errorLog: Option[String] = None
  ): Future[Unit] =
    db.run(
      runsTable
        .filter(_.id === runId.value)
        .map(r => (r.status, r.completedAt, r.rowCount, r.errorLog))
        .update((status, Some(completedAt), rowCount, errorLog))
    ).map(_ => ())

  /** Insert a completed dry-run record in a single step (no queued → terminal transition). */
  def insertDryRun(runId: PipelineRunId, pipelineId: PipelineId, startedAt: Instant, rowCount: Int): Future[Unit] = {
    val row = PipelineRunRow(
      id          = runId.value,
      pipelineId  = pipelineId.value,
      status      = "dry_run",
      startedAt   = startedAt,
      completedAt = Some(startedAt),
      rowCount    = Some(rowCount),
      errorLog    = None
    )
    db.run(runsTable += row).map(_ => ())
  }

  /**
   * Delete all but the most recent `keepN` non-dry-run records for a given pipeline.
   * Called immediately after insertRun to enforce retention.
   * Dry-run records are managed separately by deleteOldDryRuns.
   */
  def deleteOldRuns(pipelineId: PipelineId, keepN: Int = 10): Future[Unit] = {
    val pid = pipelineId.value
    val keepIds = runsTable
      .filter(r => r.pipelineId === pid && r.status =!= "dry_run")
      .sortBy(_.startedAt.desc)
      .take(keepN)
      .map(_.id)

    val action = runsTable
      .filter(r => r.pipelineId === pid && r.status =!= "dry_run" && !r.id.in(keepIds))
      .delete

    db.run(action).map(_ => ())
  }

  /**
   * Delete all but the most recent `keepN` dry-run records for a given pipeline.
   * Called immediately after insertDryRun to enforce dry-run retention independently
   * of the normal-run cap.
   */
  def deleteOldDryRuns(pipelineId: PipelineId, keepN: Int = 10): Future[Unit] = {
    val pid = pipelineId.value
    val keepIds = runsTable
      .filter(r => r.pipelineId === pid && r.status === "dry_run")
      .sortBy(_.startedAt.desc)
      .take(keepN)
      .map(_.id)

    val action = runsTable
      .filter(r => r.pipelineId === pid && r.status === "dry_run" && !r.id.in(keepIds))
      .delete

    db.run(action).map(_ => ())
  }

  /** Return all runs for a pipeline ordered by startedAt DESC. */
  def listByPipeline(pipelineId: PipelineId): Future[Vector[PipelineRunRow]] =
    db.run(
      runsTable
        .filter(_.pipelineId === pipelineId.value)
        .sortBy(_.startedAt.desc)
        .result
    ).map(_.toVector)
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
