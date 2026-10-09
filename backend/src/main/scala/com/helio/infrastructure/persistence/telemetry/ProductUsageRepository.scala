package com.helio.infrastructure.persistence.telemetry

import com.helio.infrastructure.persistence.DbContext
import slick.jdbc.PostgresProfile.api._

import java.time.LocalDate
import scala.concurrent.{ExecutionContext, Future}

/** Read-only access to the product-telemetry rollup tables (V113, HEL-1211) and one identifier-free
 *  `users` count for the owner page's all-time totals (HEL-1420).
 *
 *  Role/pool (design.md Decision 2): the rollup tables hold aggregates only (no user id) and carry
 *  no RLS, so the access path is the explicit V113 `GRANT SELECT ... TO helio_privileged`. Reads
 *  run on [[DbContext.withSystemContext]] (the privileged pool the rollup writes already use), not
 *  because RLS needs bypassing -- there is none on these tables -- but because that pool's role is
 *  the one holding the grant. It NEVER touches `product_events` (the FORCE-RLS per-user table):
 *  the page reads rollups only. The one non-rollup read is [[totalUsers]], a bare `COUNT(*)` over
 *  `users` (no RLS; readable through V38's blanket `GRANT SELECT` to `helio_privileged`). */
class ProductUsageRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  import ProductUsageRepository._

  /** Last fully rolled UTC day (`product_rollup_state.rolled_through`), or `None` before the
   *  first rollup has advanced the mark. */
  def rolledThrough(): Future[Option[LocalDate]] =
    ctx.withSystemContext(
      sql"SELECT rolled_through::text FROM product_rollup_state WHERE id = 1".as[Option[String]].headOption
    ).map(_.flatten.map(LocalDate.parse))

  /** Per-day, per-event counts and distinct-user counts for `events` over `[from, to]`. */
  def eventDaily(from: LocalDate, to: LocalDate, events: Seq[String]): Future[Seq[EventDayRow]] =
    ctx.withSystemContext(
      sql"""SELECT day::text, event, event_count, active_users FROM product_event_daily
            WHERE day BETWEEN CAST(${from.toString} AS date) AND CAST(${to.toString} AS date)
              AND event = ANY(string_to_array(${events.mkString(",")}, ','))
            ORDER BY day, event""".as[(String, String, Long, Long)]
    ).map(_.map { case (d, e, c, u) => EventDayRow(LocalDate.parse(d), e, c, u) })

  def activeUsersDaily(from: LocalDate, to: LocalDate): Future[Seq[ActiveUsersRow]] =
    ctx.withSystemContext(
      sql"""SELECT day::text, daily_active_users, weekly_active_users FROM product_active_users_daily
            WHERE day BETWEEN CAST(${from.toString} AS date) AND CAST(${to.toString} AS date)
            ORDER BY day""".as[(String, Long, Option[Long])]
    ).map(_.map { case (d, dau, wau) => ActiveUsersRow(LocalDate.parse(d), dau, wau) })

  /** Registered users excluding the system user: a single count, never a row or identifier. */
  def totalUsers(): Future[Long] =
    ctx.withSystemContext(
      sql"SELECT COUNT(*) FROM users WHERE id <> CAST($SystemUserId AS uuid)".as[Long].head
    )

  /** Trailing-7/30-day distinct-active-user counts stored on `day`'s rollup row; `None` when the
   *  row is missing, otherwise each count is `None` where it was not computable. */
  def activeTotals(day: LocalDate): Future[Option[ActiveTotalsRow]] =
    ctx.withSystemContext(
      sql"""SELECT weekly_active_users, monthly_active_users FROM product_active_users_daily
            WHERE day = CAST(${day.toString} AS date)""".as[(Option[Long], Option[Long])].headOption
    ).map(_.map { case (w, m) => ActiveTotalsRow(w, m) })

  def ttfdDaily(from: LocalDate, to: LocalDate): Future[Seq[TtfdRow]] =
    ctx.withSystemContext(
      sql"""SELECT day::text, sample_count, median_seconds, p90_seconds FROM product_ttfd_daily
            WHERE day BETWEEN CAST(${from.toString} AS date) AND CAST(${to.toString} AS date)
            ORDER BY day""".as[(String, Int, Double, Double)]
    ).map(_.map { case (d, n, med, p90) => TtfdRow(LocalDate.parse(d), n, med, p90) })

  /** Summed `event_count` per `property_value` of `(event, key)` over `[from, to]`. */
  def propertyTotals(from: LocalDate, to: LocalDate, event: String, key: String): Future[Seq[(String, Long)]] =
    ctx.withSystemContext(
      sql"""SELECT property_value, SUM(event_count)::bigint FROM product_event_property_daily
            WHERE day BETWEEN CAST(${from.toString} AS date) AND CAST(${to.toString} AS date)
              AND event = $event AND property_key = $key
            GROUP BY property_value
            ORDER BY SUM(event_count) DESC, property_value""".as[(String, Long)]
    )
}

object ProductUsageRepository {
  /** The V10-seeded system user, excluded from `totalUsers`. One constant so HEL-1421 (which
   *  decides the system user's fate) changes a single line. */
  val SystemUserId: String = "00000000-0000-0000-0000-000000000001"

  final case class ActiveTotalsRow(weekly: Option[Long], monthly: Option[Long])
  final case class EventDayRow(day: LocalDate, event: String, eventCount: Long, activeUsers: Long)
  final case class ActiveUsersRow(day: LocalDate, dailyActiveUsers: Long, weeklyActiveUsers: Option[Long])
  final case class TtfdRow(day: LocalDate, sampleCount: Int, medianSeconds: Double, p90Seconds: Double)
}
