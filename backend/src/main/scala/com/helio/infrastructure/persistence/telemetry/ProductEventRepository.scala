package com.helio.infrastructure.persistence.telemetry

import com.helio.domain.model.UserId
import com.helio.infrastructure.persistence.DbContext
import com.helio.services.telemetry.{ProductEventRegistry, ValidatedProductEvent}
import slick.jdbc.PostgresProfile.api._

import java.sql.Timestamp
import java.time.{Instant, LocalDate, ZoneOffset}
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Persistence for `product_events` and its daily rollups (V113, HEL-1208).
 *
 *  Two pools, by design (design.md Decision 2): inserts are user-owned and go through
 *  [[DbContext.withUserContext]] so RLS scopes them to the caller; rollup and purge read every
 *  user's rows and so run on [[DbContext.withSystemContext]] (BYPASSRLS), under one advisory lock
 *  so two Cloud Run instances ticking concurrently serialise instead of interleaving. */
class ProductEventRepository(
    ctx: DbContext,
    // Injectable so a test can exercise an allow-listed slug; production uses the registry's set.
    rolledUpTemplateSlugs: Set[String] = ProductEventRegistry.RolledUpTemplateSlugs
)(implicit ec: ExecutionContext) {

  import ProductEventRepository._

  /** Inserts the batch owned by `userId`; returns the number of rows actually stored. A repeat
   *  of a once-per-user event conflicts on the partial unique index and is silently skipped. */
  def insertBatch(userId: UserId, events: Seq[ValidatedProductEvent]): Future[Int] =
    if (events.isEmpty) Future.successful(0)
    else ctx.withUserContext(userId.value)(DBIO.sequence(events.map(insertOne(userId, _))).map(_.sum))

  private def insertOne(userId: UserId, e: ValidatedProductEvent): DBIO[Int] =
    sqlu"""INSERT INTO product_events (id, user_id, event, properties, occurred_at)
           VALUES (${UUID.randomUUID().toString}::uuid, ${userId.value}::uuid, ${e.event},
                   ${e.properties.compactPrint}::jsonb, ${Timestamp.from(e.occurredAt)})
           ON CONFLICT (user_id, event) WHERE event IN ('signup_completed', 'first_dashboard_rendered')
           DO NOTHING"""

  /** Recomputes every rollup for one UTC `day` from its raw rows (idempotent). Returns `false`
   *  without writing when the day is already covered AND partly purged (`day <= rolled_through`
   *  and `day <= cutoff date`), since recomputing from partial rows would corrupt it. */
  def rollupDay(day: LocalDate, now: Instant, retentionDays: Int): Future[Boolean] =
    ctx.withSystemContext(lock.andThen(rollupDayAction(day, now, retentionDays)))

  /** Current high-water mark and last purge time. */
  def state(): Future[RollupState] = ctx.withSystemContext(readState)

  /** Rolls up every day in `[from, to]` in order, advancing `rolled_through` to each day that is
   *  `<= advanceThrough` only right after that day's rollup has just run. One transaction, one
   *  advisory lock. */
  def rollupRange(from: LocalDate, to: LocalDate, advanceThrough: LocalDate, now: Instant, retentionDays: Int): Future[Unit] =
    ctx.withSystemContext(lock.andThen(rollupRangeAction(from, to, Some(advanceThrough), now, retentionDays)))

  /** Purges rows older than `retentionDays` before `now` (injected, never read from the wall
   *  clock), exempting the once-per-user events. First rolls up any not-yet-covered day up to the
   *  cutoff date and advances the high-water mark, so a row is never deleted before its day has
   *  been aggregated. Returns the number of rows deleted. */
  def purge(now: Instant, retentionDays: Int): Future[Int] =
    ctx.withSystemContext(lock.andThen(purgeAction(now, retentionDays)))

  /** [[purge]] gated to at most once per `minIntervalSeconds` via `product_rollup_state.last_purge_at`;
   *  `None` when the throttle skipped it. The check and the stamp share the advisory lock. */
  def purgeIfDue(now: Instant, retentionDays: Int, minIntervalSeconds: Long): Future[Option[Int]] =
    ctx.withSystemContext(
      lock.andThen(readState).flatMap { st =>
        val due = st.lastPurgeAt.forall(last => !last.plusSeconds(minIntervalSeconds).isAfter(now))
        if (!due) DBIO.successful(None)
        else
          purgeAction(now, retentionDays).flatMap { deleted =>
            sqlu"UPDATE product_rollup_state SET last_purge_at = ${Timestamp.from(now)} WHERE id = 1".map(_ => Some(deleted))
          }
      }
    )

  /** Earliest day with any raw event row, or `None` when there are none. */
  def earliestEventDay(): Future[Option[LocalDate]] =
    ctx.withSystemContext(
      sql"SELECT (MIN(occurred_at) AT TIME ZONE 'UTC')::date::text FROM product_events".as[Option[String]].head
    ).map(_.map(LocalDate.parse))

  private val lock: DBIO[Unit] =
    sql"SELECT pg_advisory_xact_lock($AdvisoryLockKey)".as[String].map(_ => ())

  private def readState: DBIO[RollupState] =
    sql"SELECT rolled_through::text, last_purge_at FROM product_rollup_state WHERE id = 1"
      .as[(Option[String], Option[Timestamp])]
      .head
      .map { case (rt, lp) => RollupState(rt.map(LocalDate.parse), lp.map(_.toInstant)) }

  private def setRolledThrough(day: LocalDate): DBIO[Int] =
    sqlu"""UPDATE product_rollup_state SET rolled_through = CAST(${day.toString} AS date)
           WHERE id = 1 AND (rolled_through IS NULL OR rolled_through < CAST(${day.toString} AS date))"""

  private def cutoffDate(now: Instant, retentionDays: Int): LocalDate =
    now.minusSeconds(retentionDays.toLong * 86400L).atOffset(ZoneOffset.UTC).toLocalDate

  private def dayStart(day: LocalDate): Timestamp = Timestamp.from(day.atStartOfDay(ZoneOffset.UTC).toInstant)

  private def rollupDayAction(day: LocalDate, now: Instant, retentionDays: Int): DBIO[Boolean] =
    readState.flatMap { st =>
      val cutoff  = cutoffDate(now, retentionDays)
      val covered = st.rolledThrough.exists(rt => !day.isAfter(rt))
      if (covered && !day.isAfter(cutoff)) DBIO.successful(false)
      else {
        // WAU spans day-6..day; it is computable only while the window's first day is still
        // inside retention, otherwise partial purged rows would under-count.
        val wauComputable = day.minusDays(6).isAfter(cutoff)
        val start         = dayStart(day)
        val end           = dayStart(day.plusDays(1))
        val weekStart     = dayStart(day.minusDays(6))
        val dayStr        = day.toString
        val slugs         = rolledUpTemplateSlugs.mkString(",")
        DBIO.seq(
          sqlu"DELETE FROM product_event_daily WHERE day = CAST($dayStr AS date)",
          sqlu"""INSERT INTO product_event_daily (day, event, event_count, active_users)
                 SELECT CAST($dayStr AS date), event, COUNT(*), COUNT(DISTINCT user_id)
                 FROM product_events WHERE occurred_at >= $start AND occurred_at < $end
                 GROUP BY event""",
          activeUsersUpsert(dayStr, start, end, weekStart, wauComputable),
          sqlu"DELETE FROM product_ttfd_daily WHERE day = CAST($dayStr AS date)",
          ttfdUpsert(dayStr, start, end),
          sqlu"DELETE FROM product_event_property_daily WHERE day = CAST($dayStr AS date)",
          sqlu"""INSERT INTO product_event_property_daily (day, event, property_key, property_value, event_count)
                 SELECT CAST($dayStr AS date), 'firstrun_template_chosen', 'template',
                        CASE WHEN properties->>'template' = ANY(string_to_array($slugs, ','))
                             THEN properties->>'template' ELSE 'other' END,
                        COUNT(*)
                 FROM product_events
                 WHERE event = 'firstrun_template_chosen' AND occurred_at >= $start AND occurred_at < $end
                 GROUP BY 4"""
        ).map(_ => true)
      }
    }

  private def activeUsersUpsert(dayStr: String, start: Timestamp, end: Timestamp, weekStart: Timestamp, wau: Boolean): DBIO[Int] =
    if (wau)
      sqlu"""INSERT INTO product_active_users_daily (day, daily_active_users, weekly_active_users)
             SELECT CAST($dayStr AS date),
                    (SELECT COUNT(DISTINCT user_id) FROM product_events WHERE occurred_at >= $start AND occurred_at < $end),
                    (SELECT COUNT(DISTINCT user_id) FROM product_events WHERE occurred_at >= $weekStart AND occurred_at < $end)
             ON CONFLICT (day) DO UPDATE SET daily_active_users = EXCLUDED.daily_active_users,
                                             weekly_active_users = EXCLUDED.weekly_active_users"""
    else
      sqlu"""INSERT INTO product_active_users_daily (day, daily_active_users, weekly_active_users)
             SELECT CAST($dayStr AS date),
                    (SELECT COUNT(DISTINCT user_id) FROM product_events WHERE occurred_at >= $start AND occurred_at < $end),
                    NULL
             ON CONFLICT (day) DO UPDATE SET daily_active_users = EXCLUDED.daily_active_users"""

  /** TTFD per design.md Decision 9: seconds from `signup_completed` to `first_dashboard_rendered`;
   *  users without a signup row and negative differences are excluded. Histogram buckets are
   *  non-cumulative (`prev < seconds <= bound`). */
  private def ttfdUpsert(dayStr: String, start: Timestamp, end: Timestamp): DBIO[Int] =
    sqlu"""WITH samples AS (
             SELECT EXTRACT(EPOCH FROM (f.occurred_at - s.occurred_at)) AS secs
             FROM product_events f
             JOIN product_events s ON s.user_id = f.user_id AND s.event = 'signup_completed'
             WHERE f.event = 'first_dashboard_rendered' AND f.occurred_at >= $start AND f.occurred_at < $end
           ), valid AS (SELECT secs FROM samples WHERE secs >= 0)
           INSERT INTO product_ttfd_daily (day, sample_count, median_seconds, p90_seconds, histogram)
           SELECT CAST($dayStr AS date), COUNT(*),
                  percentile_cont(0.5) WITHIN GROUP (ORDER BY secs),
                  percentile_cont(0.9) WITHIN GROUP (ORDER BY secs),
                  jsonb_build_object(
                    '60',    COUNT(*) FILTER (WHERE secs <= 60),
                    '300',   COUNT(*) FILTER (WHERE secs > 60 AND secs <= 300),
                    '900',   COUNT(*) FILTER (WHERE secs > 300 AND secs <= 900),
                    '3600',  COUNT(*) FILTER (WHERE secs > 900 AND secs <= 3600),
                    '86400', COUNT(*) FILTER (WHERE secs > 3600 AND secs <= 86400),
                    '+Inf',  COUNT(*) FILTER (WHERE secs > 86400))
           FROM valid HAVING COUNT(*) > 0"""

  private def purgeAction(now: Instant, retentionDays: Int): DBIO[Int] =
    readState.flatMap { st =>
      val cutoff   = cutoffDate(now, retentionDays)
      val cutoffTs = Timestamp.from(now.minusSeconds(retentionDays.toLong * 86400L))
      val exempt   = ProductEventRegistry.OncePerUserEvents.mkString(",")
      val firstUncovered: DBIO[Option[LocalDate]] = st.rolledThrough match {
        case Some(rt) => DBIO.successful(Some(rt.plusDays(1)))
        case None =>
          sql"SELECT (MIN(occurred_at) AT TIME ZONE 'UTC')::date::text FROM product_events"
            .as[Option[String]].head.map(_.map(LocalDate.parse))
      }
      firstUncovered.flatMap {
        case Some(from) if !from.isAfter(cutoff) => rollupRangeAction(from, cutoff, Some(cutoff), now, retentionDays)
        case _                                   => DBIO.successful(())
      }.andThen(
        sqlu"""DELETE FROM product_events
               WHERE occurred_at < $cutoffTs AND event <> ALL(string_to_array($exempt, ','))"""
      )
    }

  private def rollupRangeAction(from: LocalDate, to: LocalDate, advanceThrough: Option[LocalDate], now: Instant, retentionDays: Int): DBIO[Unit] =
    DBIO.sequence(
      Iterator.iterate(from)(_.plusDays(1)).takeWhile(!_.isAfter(to)).toSeq.map { d =>
        rollupDayAction(d, now, retentionDays).flatMap { _ =>
          if (advanceThrough.exists(!d.isAfter(_))) setRolledThrough(d) else DBIO.successful(0)
        }
      }
    ).map(_ => ())
}

object ProductEventRepository {

  /** Arbitrary constant namespace for `pg_advisory_xact_lock` so rollup and purge serialise
   *  against each other (and against a second instance) without colliding with other locks. */
  private val AdvisoryLockKey: Long = 0x48454C31323038L

  final case class RollupState(rolledThrough: Option[LocalDate], lastPurgeAt: Option[Instant])
}
