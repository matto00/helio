package com.helio.infrastructure.persistence.home

import com.helio.domain.model.{AuthenticatedUser, ScheduleKind}
import com.helio.infrastructure.persistence.DbContext
import com.helio.services.home.{HomeRunRow, HomeScheduleRow, HomeSummaryLimits, HomeSummaryRows}
import slick.jdbc.PostgresProfile.api._

import java.sql.Timestamp
import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** HEL-1578: the Home summary's reads -- two set-based queries in ONE `withUserContext` transaction, regardless of
 *  how many pipelines the caller owns. Both carry an explicit `p.owner_id = caller` filter (the dev/CI app role is a
 *  superuser and bypasses RLS, MISTAKES.md); the V35 / V62 policies independently enforce the same scoping for a
 *  real app-pool session. */
class HomeSummaryRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  def load(user: AuthenticatedUser, windowStart: Instant): Future[HomeSummaryRows] = {
    val owner  = user.id.value
    val window = Timestamp.from(windowStart)
    val max    = HomeSummaryLimits.ErrorLogMax
    // Real runs only (never `dry_run`); a live (queued/running) run is read whatever its age so a stuck one is seen.
    val runsQuery =
      sql"""SELECT r.id, r.pipeline_id, p.name, r.status, r.started_at, r.completed_at, r.trigger_source, r.row_count,
                   left(r.error_log, $max)
            FROM pipeline_runs r JOIN pipelines p ON p.id = r.pipeline_id
            WHERE p.owner_id = $owner::uuid AND r.status <> 'dry_run'
              AND (r.started_at >= $window OR r.status IN ('queued', 'running'))
            ORDER BY r.started_at DESC"""
        .as[(String, String, String, String, Timestamp, Option[Timestamp], String, Option[Int], Option[String])]
    val schedulesQuery =
      sql"""SELECT s.pipeline_id, p.name, s.kind, s.expression, s.timezone, s.next_run_at
            FROM pipeline_schedules s JOIN pipelines p ON p.id = s.pipeline_id
            WHERE p.owner_id = $owner::uuid AND s.enabled"""
        .as[(String, String, String, String, String, Option[Timestamp])]

    ctx.withUserContext(owner)(runsQuery.zip(schedulesQuery)).map { case (runs, schedules) =>
      HomeSummaryRows(
        runs.map { case (id, pid, name, status, started, completed, trigger, rowCount, error) =>
          HomeRunRow(id, pid, name, status, started.toInstant, completed.map(_.toInstant), trigger, rowCount, error)
        }.toVector,
        schedules.flatMap { case (pid, name, kind, expr, tz, next) =>
          // An unknown kind cannot be projected; skip it rather than fail the whole summary.
          ScheduleKind.fromString(kind).toOption.map(HomeScheduleRow(pid, name, _, expr, tz, next.map(_.toInstant)))
        }.toVector
      )
    }
  }
}
