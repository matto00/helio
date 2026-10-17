package com.helio.testsupport

import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future}

/** HEL-1578: privileged-pool seeds for the Home summary specs (pipelines, runs, schedules). */
trait HomeSummarySeeding {
  protected def privilegedDb: JdbcBackend.Database

  private def run[T](f: Future[T]): T = Await.result(f, 20.seconds)

  protected def seedPipelineFor(owner: String, name: String): String = {
    val id = UUID.randomUUID().toString
    run(privilegedDb.run(sqlu"INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($id, $name, $owner::uuid, now(), now())"))
    id
  }

  protected def seedRun(
      pipelineId: String, status: String, startedAt: Instant, errorLog: Option[String] = None, rowCount: Option[Int] = None
  ): String = {
    val id        = UUID.randomUUID().toString
    val started   = Timestamp.from(startedAt)
    val completed = if (status == "queued" || status == "running") None else Some(Timestamp.from(startedAt.plusSeconds(30)))
    run(privilegedDb.run(
      sqlu"""INSERT INTO pipeline_runs (id, pipeline_id, status, started_at, completed_at, row_count, error_log)
             VALUES ($id, $pipelineId, $status, $started, $completed, $rowCount, $errorLog)"""
    ))
    id
  }

  protected def seedSchedule(pipelineId: String, kind: String, expression: String, nextRunAt: Option[Instant], enabled: Boolean = true): Unit = {
    val next = nextRunAt.map(Timestamp.from)
    run(privilegedDb.run(
      sqlu"""INSERT INTO pipeline_schedules (id, pipeline_id, kind, expression, enabled, timezone, next_run_at)
             VALUES (${UUID.randomUUID().toString}, $pipelineId, $kind, $expression, $enabled, 'UTC', $next)"""
    ))
  }

  protected def resetPipelines(): Unit = { run(privilegedDb.run(sqlu"TRUNCATE pipelines CASCADE")); () }
}
