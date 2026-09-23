package com.helio.infrastructure.persistence.pipelines

import com.helio.infrastructure.persistence.DbContext
import com.helio.domain.model.UserId
import slick.jdbc.PostgresProfile.api._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** Persistence for the pipeline-run guard's DB-backed, globally-consistent rate limit (HEL-505
 *  design.md Decision 2) -- `pipeline_run_rate_window` (V109) has one row per (user, window
 *  bucket). Enforcement is a SINGLE atomic statement: `INSERT ... ON CONFLICT (user_id,
 *  window_start) DO UPDATE SET request_count = request_count + 1 WHERE request_count < :limit
 *  RETURNING request_count` -- race-safe without an explicit transaction (Postgres serializes the
 *  upsert per conflicting row), mirroring `AssistantDailyUsageRepository.incrementIfUnderCap`
 *  exactly, just bucketed by a configurable window instead of a UTC calendar day.
 *
 *  Routed through [[DbContext.withUserContext]] (never raw `db.run`, per CONTRIBUTING.md) -- every
 *  one of `PipelineRunService.submit`'s three trigger-path callers already has a real
 *  `AuthenticatedUser` in scope (including the scheduler's synthetic owner-identity), so there is
 *  no pre-identity read path here, exactly like `AssistantDailyUsageRepository`. */
class PipelineRunGuardRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  private val table = TableQuery[PipelineRunGuardRepository.PipelineRunRateWindowTable]

  /** Buckets `now` to the configured window's boundary, matching design.md Decision 2's
   *  `to_timestamp(floor(extract(epoch from now()) / windowSeconds) * windowSeconds)` -- computed
   *  in application code (not SQL `now()`) so the returned `Instant` is directly usable both as
   *  the write's PK component and as the basis for `Retry-After` computation, and so a test can
   *  inject a fixed `now` deterministically. */
  private[pipelines] def bucketStart(now: Instant, windowSeconds: Int): Instant = {
    val epochSeconds = now.getEpochSecond
    val bucketed = (epochSeconds / windowSeconds) * windowSeconds
    Instant.ofEpochSecond(bucketed)
  }

  /** `Right(())` iff the caller's submission count for the CURRENT window was under `limit` and
   *  has now been incremented by one; `Left(retryAfterSeconds)` iff the caller was already at (or
   *  `limit` is < 1, i.e. "always capped") -- nothing is written in either `Left` case.
   *  `retryAfterSeconds` is the window's remaining seconds (design.md Decision 2). A `limit` of 0
   *  or less is short-circuited BEFORE touching the database, mirroring
   *  `AssistantDailyUsageRepository.incrementIfUnderCap`'s own `limit < 1` guard -- the
   *  `ON CONFLICT ... WHERE` clause only gates the UPDATE branch, not a bucket's very first
   *  INSERT, so a caller with no row yet for the current window would otherwise be allowed exactly
   *  one submission even at `limit = 0`. */
  def incrementRateIfUnderLimit(userId: UserId, limit: Int, windowSeconds: Int, now: Instant = Instant.now()): Future[Either[Long, Unit]] = {
    val windowStart = bucketStart(now, windowSeconds)
    val retryAfterSeconds = math.max(0L, windowStart.getEpochSecond + windowSeconds - now.getEpochSecond)
    if (limit < 1) Future.successful(Left(retryAfterSeconds))
    else {
      val action =
        sql"""INSERT INTO pipeline_run_rate_window (user_id, window_start, request_count)
              VALUES (${userId.value}::uuid, ${java.sql.Timestamp.from(windowStart)}, 1)
              ON CONFLICT (user_id, window_start)
              DO UPDATE SET request_count = pipeline_run_rate_window.request_count + 1
              WHERE pipeline_run_rate_window.request_count < $limit
              RETURNING request_count"""
          .as[Int]
          .headOption
      ctx.withUserContext(userId.value)(action).map {
        case Some(_) => Right(())
        case None    => Left(retryAfterSeconds)
      }
    }
  }

  /** Bounded cleanup (design.md Decision 2, C3): deletes every window row older than
   *  `retainSeconds` (default 1 hour -- several multiples of the largest realistic window). Run
   *  as a privileged, cross-user sweep (no single user's `withUserContext` could delete every
   *  user's stale rows) -- mirrors `deleteOldRunsInternal`'s own privileged retention pattern.
   *  Piggybacked on `PipelineSchedulerService.tick()`'s existing cadence (design.md Decision 2). */
  def cleanupOldWindows(retainSeconds: Int = 3600, now: Instant = Instant.now()): Future[Int] = {
    val cutoff: Instant = now.minusSeconds(retainSeconds.toLong)
    ctx.withSystemContext(table.filter(_.windowStart < cutoff).delete)
  }
}

object PipelineRunGuardRepository {

  case class PipelineRunRateWindowRow(userId: String, windowStart: Instant, requestCount: Int)

  class PipelineRunRateWindowTable(tag: Tag) extends Table[PipelineRunRateWindowRow](tag, "pipeline_run_rate_window") {
    def userId       = column[String]("user_id")
    def windowStart  = column[Instant]("window_start")(PipelineRepository.instantColumnType)
    def requestCount = column[Int]("request_count")

    def * = (userId, windowStart, requestCount).mapTo[PipelineRunRateWindowRow]
  }
}
