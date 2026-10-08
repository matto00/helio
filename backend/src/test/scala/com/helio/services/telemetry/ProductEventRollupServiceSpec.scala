package com.helio.services.telemetry

import com.helio.domain.util.Clock
import com.helio.testsupport.ProductTelemetryDbHarness
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api._

import java.time.{Instant, LocalDate}
import java.util.UUID
import scala.io.Source

class ProductEventRollupServiceSpec extends AnyWordSpec with Matchers with ProductTelemetryDbHarness {

  private val E = LocalDate.parse("2026-04-10")
  private def at(day: LocalDate, hms: String) = Instant.parse(s"${day}T${hms}Z")

  private def service(): ProductEventRollupService =
    new ProductEventRollupService(repo, ProductTelemetryConfig(rateLimitPerWindow = 60, retentionDays = Retention), new Clock { def now(): Instant = at(E, "00:00:00") })

  private def eventCount(day: LocalDate, event: String): Option[Long] =
    priv(sql"SELECT event_count FROM product_event_daily WHERE day = CAST(${day.toString} AS date) AND event = $event".as[Long].headOption)

  "tickAt" should {

    "roll up yesterday and today but not advance the high-water mark past a day less than 2 days old" in {
      rawInsert(userA, "provenance_opened", at(E, "09:00:00"))
      await(service().tickAt(at(E.plusDays(1), "12:00:00")))
      eventCount(E, "provenance_opened") shouldBe Some(1L)
      await(repo.state()).rolledThrough.forall(_.isBefore(E)) shouldBe true
    }

    "run a final rollup of a day immediately before advancing the mark past it" in {
      rawInsert(userA, "provenance_opened", at(E, "09:00:00"))
      await(service().tickAt(at(E.plusDays(1), "12:00:00")))
      rawInsert(userB, "provenance_opened", at(E, "23:59:00"))
      await(service().tickAt(at(E.plusDays(2), "12:00:00")))
      eventCount(E, "provenance_opened") shouldBe Some(2L)
      await(repo.state()).rolledThrough shouldBe Some(E)
    }

    "purge rows past the injected-clock window on a tick, keeping their rollup" in {
      rawInsert(userA, "provenance_opened", at(E, "09:00:00"))
      await(service().tickAt(at(E.plusDays(Retention + 1L), "12:00:00")))
      countEvents("provenance_opened") shouldBe 0
      eventCount(E, "provenance_opened") shouldBe Some(1L)
    }

    "do nothing and not fail when there are no events" in {
      await(service().tickAt(at(E, "12:00:00")))
      priv(sql"SELECT COUNT(*) FROM product_event_daily".as[Int].head) shouldBe 0
    }
  }

  // ---- HEL-1244: V114 signup backfill x rollup consequence --------------------------------

  private val BackfillNow   = Instant.parse("2026-10-03T12:00:00Z")
  private val BackfillToday = LocalDate.parse("2026-10-03")

  private def runBackfill(): Unit = {
    val src = Source.fromResource("db/migration/V114__backfill_signup_completed_events.sql")
    val sqlText = try src.mkString finally src.close()
    priv(sqlu"#$sqlText")
  }

  /** A non-backfill user whose email has the exact shape of a harness user whose random UUID starts with "bf". */
  private val DecoyId = "bf222222-2222-4222-8222-222222222222"

  /** Backfill fixture users use the reserved `@backfill.invalid` domain, which no harness, newUser() or migration email can match.
    * ~400 historical users (one per day, 1..400 days before BackfillNow) plus the harness's two and a "bf"-UUID decoy. */
  private def withHistoricalUsers[T](body: Set[String] => T): T = {
    priv(sqlu"INSERT INTO users (id, email, created_at) VALUES (${DecoyId}::uuid, ${DecoyId + "@t.local"}, now())")
    // every pre-existing user (harness users + any migration-seeded baseline user) lands on a day a bf user also uses
    priv(sqlu"""UPDATE users SET created_at = TIMESTAMPTZ '2026-09-23 10:00:00+00'""")
    // pin-time roster by exact id: every user here carries the literal created_at above; never recomputed at assertion time
    val roster = priv(sql"SELECT id::text FROM users".as[String]).toSet
    roster should contain allOf (userA.value, userB.value, DecoyId)
    // a non-backfill user dated AFTER BackfillToday (what a wall-clock newUser() looks like on any day past the anchor),
    // inserted after the pin and the roster capture so it is in neither
    priv(sqlu"INSERT INTO users (id, email, created_at) VALUES (${LateId}::uuid, ${LateId + "@t.local"}, TIMESTAMPTZ '2026-10-05 09:00:00+00')")
    priv(sqlu"""INSERT INTO users (id, email, created_at)
                SELECT gen_random_uuid(), 'bf' || g || '@backfill.invalid', TIMESTAMPTZ '2026-10-03 09:00:00+00' - (g || ' days')::interval
                FROM generate_series(1, 400) g""")
    try {
      val result =
        try body(roster)
        finally priv(sqlu"DELETE FROM users WHERE email LIKE '%@backfill.invalid'")
      // reached only when body completed: the cleanup must not have deleted userA, userB or the decoy
      val survivors = priv(
        sql"SELECT COUNT(*) FROM users WHERE id IN (${userA.value}::uuid, ${userB.value}::uuid, ${DecoyId}::uuid)".as[Int].head
      )
      survivors shouldBe 3
      result
    } finally priv(sqlu"DELETE FROM users WHERE id IN (${DecoyId}::uuid, ${LateId}::uuid)")
  }

  /** Fixed non-"bf", non-backfill-domain user dated 2026-10-05, after BackfillToday: V114 backfills its signup but a 2026-10-03 tick never rolls it. */
  private val LateId = "5a7e0000-0000-4000-8000-000000000005"
  private val LateDay = LocalDate.parse("2026-10-05")

  /** Raw signup rows belonging to the fixture's own users: the pin-time roster (exact ids) plus the `@backfill.invalid` users. */
  private def fixtureSignups(roster: Set[String]): Int = {
    val ids = roster.map(id => s"'${UUID.fromString(id)}'").mkString(", ") // ids were read from users.id; parsed to guarantee UUID shape
    priv(sql"""SELECT COUNT(*) FROM product_events
               WHERE event = 'signup_completed'
                 AND (user_id IN (#$ids) OR user_id IN (SELECT id FROM users WHERE email LIKE '%@backfill.invalid'))""".as[Int].head)
  }

  private def wau(day: LocalDate): Option[Long] =
    priv(sql"SELECT weekly_active_users FROM product_active_users_daily WHERE day = CAST(${day.toString} AS date)".as[Option[Long]].headOption).flatten

  "V114 backfilled history" should {

    "roll up in ONE tick when rolled_through is NULL, with WAU in-window only and signup rows surviving the purge" in withHistoricalUsers { roster =>
      runBackfill()
      fixtureSignups(roster) shouldBe 400 + roster.size
      priv(sql"SELECT COUNT(*) FROM product_events WHERE event = 'signup_completed' AND user_id = ${LateId}::uuid".as[Int].head) shouldBe 1
      // an old non-exempt row that the purge must remove while the signups survive
      rawInsert(userA, "provenance_opened", BackfillNow.minusSeconds(200L * 86400L))
      await(repo.state()).rolledThrough shouldBe None

      val t0 = System.nanoTime()
      await(service().tickAt(BackfillNow))
      val ms = (System.nanoTime() - t0) / 1000000L
      info(s"one tickAt over ~400 days of backfilled history took ${ms} ms")

      await(repo.state()).rolledThrough shouldBe Some(BackfillToday.minusDays(2))
      priv(sql"SELECT COUNT(DISTINCT day) FROM product_event_daily WHERE event = 'signup_completed'".as[Int].head) shouldBe 400
      priv(sql"SELECT SUM(event_count) FROM product_event_daily WHERE event = 'signup_completed'".as[Long].head) shouldBe (400L + roster.size)
      eventCount(LateDay, "signup_completed") shouldBe None // the 2026-10-03 tick never rolls a later day
      // WAU: computable inside retention, NULL (by existing design) once the window left it
      wau(BackfillToday.minusDays(1)) should not be None
      wau(BackfillToday.minusDays(2)) should not be None
      wau(BackfillToday.minusDays(400)) shouldBe None
      priv(sql"SELECT COUNT(*) FROM product_active_users_daily".as[Int].head) should be >= 400
      // purge exempts signup_completed, removes the old provenance_opened
      fixtureSignups(roster) shouldBe 400 + roster.size
      priv(sql"SELECT COUNT(*) FROM product_events WHERE event = 'signup_completed' AND user_id = ${LateId}::uuid".as[Int].head) shouldBe 1
      countEvents("provenance_opened") shouldBe 0
      eventCount(BackfillToday.minusDays(200), "provenance_opened") shouldBe Some(1L)
    }

    "become visible when rolled_through was ALREADY set: V114 lowers the mark and the next tick re-rolls history" in withHistoricalUsers { _ =>
      // a previous tick had already advanced the mark (recent days only)
      priv(sqlu"UPDATE product_rollup_state SET rolled_through = CAST(${BackfillToday.minusDays(2).toString} AS date) WHERE id = 1")
      runBackfill()
      await(repo.state()).rolledThrough shouldBe Some(BackfillToday.minusDays(401))

      await(service().tickAt(BackfillNow))
      await(repo.state()).rolledThrough shouldBe Some(BackfillToday.minusDays(2))
      priv(sql"SELECT COUNT(DISTINCT day) FROM product_event_daily WHERE event = 'signup_completed'".as[Int].head) shouldBe 400
      eventCount(BackfillToday.minusDays(400), "signup_completed") shouldBe Some(1L)
    }

    "document the accepted limitation: lowering the mark defeats the partly-purged guard for days past retention" in withHistoricalUsers { _ =>
      val old = BackfillToday.minusDays(200)
      // Control: with the mark left alone, the guard keeps an old, already-purged day's rollup.
      priv(sqlu"UPDATE product_rollup_state SET rolled_through = CAST(${BackfillToday.minusDays(2).toString} AS date) WHERE id = 1")
      priv(sqlu"""INSERT INTO product_event_daily (day, event, event_count, active_users)
                  VALUES (CAST(${old.toString} AS date), 'provenance_opened', 5, 3)""")
      await(service().tickAt(BackfillNow))
      eventCount(old, "provenance_opened") shouldBe Some(5L)

      // After V114 lowers the mark, that day is recomputed from the (purged, hence partial) raw rows.
      runBackfill()
      await(service().tickAt(BackfillNow))
      eventCount(old, "provenance_opened") shouldBe None // accepted limitation; V114 runs once, at a ~1-day-old telemetry history
    }
  }
}
