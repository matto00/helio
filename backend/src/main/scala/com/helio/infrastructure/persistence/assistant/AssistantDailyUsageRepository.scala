package com.helio.infrastructure.persistence.assistant

import com.helio.infrastructure.persistence.DbContext
import com.helio.domain.model.UserId
import com.helio.domain.util.{Clock, SystemClock}
import slick.jdbc.PostgresProfile.api._

import java.time.{LocalDate, ZoneOffset}
import scala.concurrent.{ExecutionContext, Future}

/** Persistence for the beta-tier daily chat cap (HEL-703, design.md D5) -- `assistant_daily_usage`
 *  (V88) has one row per (user, UTC day). Enforcement is a SINGLE atomic statement:
 *  `INSERT ... ON CONFLICT (user_id, usage_date) DO UPDATE SET message_count = message_count + 1
 *  WHERE message_count < :limit RETURNING message_count` -- race-safe without an explicit
 *  transaction (Postgres serializes the upsert per conflicting row), so a pair of concurrent
 *  converse calls can never together push the count above `limit`.
 *
 *  Routed through [[DbContext.withUserContext]] (never raw `db.run`, per CONTRIBUTING.md) --
 *  unlike `UserRepository`, every access here happens strictly post-`authenticate` (there is no
 *  pre-identity read path), so the caller's own user context is always available.
 *
 *  The UTC day comes from the injected [[Clock]] (HEL-1473), defaulting to [[SystemClock]] so
 *  production behaviour is unchanged; specs pin it so a run straddling real UTC midnight cannot
 *  split a day bucket. */
class AssistantDailyUsageRepository(ctx: DbContext, clock: Clock = SystemClock)(implicit ec: ExecutionContext) {

  /** `true` iff the caller's count for TODAY (UTC) plus `weight` is within `limit` and has now been
   *  incremented by `weight`; `false` iff the caller was already at (or the configured `limit` is < 1,
   *  i.e. "always capped") -- nothing is written in either `false` case. A `limit` of 0 or less is
   *  short-circuited BEFORE touching the database: the `ON CONFLICT ... WHERE` guard only gates
   *  the UPDATE branch, not the very first INSERT of a user's day, so a caller with no row yet
   *  would otherwise be allowed exactly one message even at `limit = 0`. */
  def incrementIfUnderCap(userId: UserId, limit: Int, weight: Int = 1): Future[Boolean] =
    // HEL-1755 D7: `weight` units are added at once (Haiku 1 / Sonnet 4 / Opus 8 by default); the send is allowed
    // only when `count + weight <= limit`. A weight above the limit can never fit, so it never reaches the INSERT
    // (whose first-row branch has no WHERE guard).
    if (limit < 1 || weight < 1 || weight > limit) Future.successful(false)
    else {
      val today = LocalDate.ofInstant(clock.now(), ZoneOffset.UTC).toString
      val action =
        sql"""INSERT INTO assistant_daily_usage (user_id, usage_date, message_count)
              VALUES (${userId.value}::uuid, $today::date, $weight)
              ON CONFLICT (user_id, usage_date)
              DO UPDATE SET message_count = assistant_daily_usage.message_count + $weight
              WHERE assistant_daily_usage.message_count + $weight <= $limit
              RETURNING message_count"""
          .as[Int]
          .headOption
      ctx.withUserContext(userId.value)(action).map(_.isDefined)
    }
}
