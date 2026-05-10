package com.helio.infrastructure

import slick.jdbc.PostgresProfile.api._
import PipelineRepository.instantColumnType

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

class PipelineRunRepository(db: slick.jdbc.JdbcBackend.Database)(implicit ec: ExecutionContext) {

  import PipelineRunRepository._

  private val runsTable = TableQuery[PipelineRunTable]

  /** Insert a new run record in "queued" state. */
  def insertRun(runId: String, pipelineId: String, startedAt: Instant): Future[Unit] = {
    val row = PipelineRunRow(
      id          = runId,
      pipelineId  = pipelineId,
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
      runId: String,
      status: String,
      completedAt: Instant,
      rowCount: Option[Int] = None,
      errorLog: Option[String] = None
  ): Future[Unit] =
    db.run(
      runsTable
        .filter(_.id === runId)
        .map(r => (r.status, r.completedAt, r.rowCount, r.errorLog))
        .update((status, Some(completedAt), rowCount, errorLog))
    ).map(_ => ())

  /** Insert a completed dry-run record in a single step (no queued → terminal transition). */
  def insertDryRun(runId: String, pipelineId: String, startedAt: Instant, rowCount: Int): Future[Unit] = {
    val row = PipelineRunRow(
      id          = runId,
      pipelineId  = pipelineId,
      status      = "dry_run",
      startedAt   = startedAt,
      completedAt = Some(startedAt),
      rowCount    = Some(rowCount),
      errorLog    = None
    )
    db.run(runsTable += row).map(_ => ())
  }

  /**
   * Delete all but the most recent `keepN` runs for a given pipeline.
   * Called immediately after insertRun to enforce retention.
   */
  def deleteOldRuns(pipelineId: String, keepN: Int = 10): Future[Unit] = {
    val keepIds = runsTable
      .filter(_.pipelineId === pipelineId)
      .sortBy(_.startedAt.desc)
      .take(keepN)
      .map(_.id)

    val action = runsTable
      .filter(r => r.pipelineId === pipelineId && !r.id.in(keepIds))
      .delete

    db.run(action).map(_ => ())
  }

  /** Return all runs for a pipeline ordered by startedAt DESC. */
  def listByPipeline(pipelineId: String): Future[Vector[PipelineRunRow]] =
    db.run(
      runsTable
        .filter(_.pipelineId === pipelineId)
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
