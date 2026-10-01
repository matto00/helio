package com.helio.infrastructure.persistence.telemetry

import com.helio.domain.model.UserId
import com.helio.services.telemetry.{ProductEventRegistry, ValidatedProductEvent}
import com.helio.testsupport.ProductTelemetryDbHarness
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.sql.Timestamp
import java.time.{Instant, LocalDate}
import java.util.UUID

class ProductEventRepositorySpec extends AnyWordSpec with Matchers with ProductTelemetryDbHarness {

  private def ev(name: String, at: Instant, props: JsObject = JsObject.empty) = ValidatedProductEvent(name, props, at)

  private val D   = LocalDate.parse("2026-03-10")
  private def at(day: LocalDate, hms: String) = Instant.parse(s"${day}T${hms}Z")
  private val nowForD = at(D.plusDays(2), "00:00:00")

  "insert under RLS (non-BYPASSRLS app role)" should {

    "store events owned by the calling user" in {
      await(repo.insertBatch(userA, Seq(ev("provenance_opened", Instant.now())))) shouldBe 1
      countEvents("provenance_opened") shouldBe 1
    }

    "not show one user's events to another user's session" in {
      await(repo.insertBatch(userA, Seq(ev("provenance_opened", Instant.now()))))
      val seenByB = await(ctx.withUserContext(userB.value)(sql"SELECT COUNT(*) FROM product_events".as[Int].head))
      val seenByA = await(ctx.withUserContext(userA.value)(sql"SELECT COUNT(*) FROM product_events".as[Int].head))
      seenByB shouldBe 0
      seenByA shouldBe 1
    }

    "refuse an insert that names a different user than the session" in {
      val attempt = ctx.withUserContext(userB.value)(
        sqlu"""INSERT INTO product_events (user_id, event, occurred_at)
               VALUES (${userA.value}::uuid, 'provenance_opened', now())"""
      )
      an[Exception] should be thrownBy await(attempt)
      countEvents("provenance_opened") shouldBe 0
    }

    "keep the first once-per-user event and drop a repeat without failing" in {
      val first = ev("first_dashboard_rendered", Instant.parse("2026-03-10T10:00:00Z"))
      await(repo.insertBatch(userA, Seq(first))) shouldBe 1
      await(repo.insertBatch(userA, Seq(first.copy(occurredAt = Instant.parse("2026-03-11T10:00:00Z"))))) shouldBe 0
      countEvents("first_dashboard_rendered") shouldBe 1
      priv(sql"SELECT occurred_at FROM product_events WHERE event = 'first_dashboard_rendered'".as[Timestamp].head).toInstant shouldBe first.occurredAt
    }

    "store repeatable events every time" in {
      await(repo.insertBatch(userA, Seq(ev("provenance_opened", Instant.now()), ev("provenance_opened", Instant.now()))))
      countEvents("provenance_opened") shouldBe 2
    }
  }

  "the event CHECK constraint" should {

    "allow exactly the names in the Scala registry" in {
      val defn = priv(sql"""SELECT pg_get_constraintdef(oid) FROM pg_constraint
                            WHERE conrelid = 'product_events'::regclass AND contype = 'c'""".as[String])
      val names = defn.flatMap("'([a-z_]+)'".r.findAllMatchIn(_).map(_.group(1))).toSet
      names shouldBe ProductEventRegistry.AllEventNames
    }

    "reject an unlisted event name at the database layer" in {
      an[Exception] should be thrownBy priv(
        sqlu"INSERT INTO product_events (user_id, event, occurred_at) VALUES (${userA.value}::uuid, 'page_viewed', now())"
      )
    }
  }

  "deleting a user" should {
    "remove that user's events via ON DELETE CASCADE and leave others" in {
      val doomed = UserId(UUID.randomUUID().toString)
      priv(sqlu"INSERT INTO users (id, email, created_at) VALUES (${doomed.value}::uuid, ${doomed.value + "@t.local"}, now())")
      await(repo.insertBatch(doomed, Seq(ev("provenance_opened", Instant.now()), ev("signup_completed", Instant.now()))))
      await(repo.insertBatch(userA, Seq(ev("provenance_opened", Instant.now()))))
      priv(sqlu"DELETE FROM users WHERE id = ${doomed.value}::uuid")
      priv(sql"SELECT COUNT(*) FROM product_events WHERE user_id = ${doomed.value}::uuid".as[Int].head) shouldBe 0
      countEvents("provenance_opened") shouldBe 1
    }
  }

  private def seedRollupFixture(): Unit = {
    val users = Vector.fill(9)(UserId(UUID.randomUUID().toString))
    users.foreach(u => priv(sqlu"INSERT INTO users (id, email, created_at) VALUES (${u.value}::uuid, ${u.value + "@t.local"}, now())"))
    val Vector(u1, u2, u3, u4, u5, u6, u7, u8, u9) = users
    // Signups all at 10:00:00; first dashboards at +30s, +120s, +600s, +7200s, +43200s.
    Seq(u1 -> "10:00:30", u2 -> "10:02:00", u3 -> "10:10:00", u4 -> "12:00:00", u5 -> "22:00:00").foreach { case (u, t) =>
      rawInsert(u, "signup_completed", at(D, "10:00:00"))
      rawInsert(u, "first_dashboard_rendered", at(D, t))
    }
    // u6: registered before telemetry shipped (no signup) -> excluded from TTFD.
    rawInsert(u6, "first_dashboard_rendered", at(D, "11:00:00"))
    // u7: negative difference -> excluded.
    rawInsert(u7, "signup_completed", at(D, "15:00:00"))
    rawInsert(u7, "first_dashboard_rendered", at(D, "14:00:00"))
    rawInsert(u1, "provenance_opened", at(D, "13:00:00"))
    rawInsert(u1, "provenance_opened", at(D, "13:05:00"))
    rawInsert(u2, "provenance_opened", at(D, "13:10:00"))
    rawInsert(u8, "provenance_opened", at(D.minusDays(3), "09:00:00"))
    rawInsert(u9, "provenance_opened", at(D.minusDays(7), "09:00:00"))
    rawInsert(u1, "firstrun_template_chosen", at(D, "09:00:00"), """{"template":"blank"}""")
    rawInsert(u2, "firstrun_template_chosen", at(D, "09:01:00"), """{"template":"blank"}""")
    rawInsert(u3, "firstrun_template_chosen", at(D, "09:02:00"), """{"template":"not-on-the-list"}""")
  }

  private def dailyCount(day: LocalDate, event: String): Option[(Long, Long)] =
    priv(sql"SELECT event_count, active_users FROM product_event_daily WHERE day = CAST(${day.toString} AS date) AND event = $event".as[(Long, Long)].headOption)

  "rollupDay" should {

    "produce per-event counts, TTFD median/p90/histogram, DAU/WAU and template counts matching hand-computed values" in {
      seedRollupFixture()
      await(repo.rollupDay(D, nowForD, Retention)) shouldBe true

      dailyCount(D, "signup_completed") shouldBe Some((6L, 6L))
      dailyCount(D, "first_dashboard_rendered") shouldBe Some((7L, 7L))
      dailyCount(D, "provenance_opened") shouldBe Some((3L, 2L))

      // samples [30,120,600,7200,43200]: median 600; p90 at rank 0.9*4=3.6 -> 7200+0.6*36000=28800
      val (n, median, p90, hist) = priv(
        sql"SELECT sample_count, median_seconds, p90_seconds, histogram::text FROM product_ttfd_daily WHERE day = CAST(${D.toString} AS date)"
          .as[(Int, Double, Double, String)].head)
      n shouldBe 5
      median shouldBe 600.0 +- 1e-6
      p90 shouldBe 28800.0 +- 1e-6
      hist.parseJson shouldBe """{"60":1,"300":1,"900":1,"3600":0,"86400":2,"+Inf":0}""".parseJson

      // D has 9 distinct users? u1..u7 active on D; u8 on D-3 (in the trailing 7 days); u9 on D-7 (out).
      priv(sql"SELECT daily_active_users, weekly_active_users FROM product_active_users_daily WHERE day = CAST(${D.toString} AS date)".as[(Long, Long)].head) shouldBe ((7L, 8L))

      val templates = priv(sql"SELECT property_value, event_count FROM product_event_property_daily WHERE day = CAST(${D.toString} AS date) AND event = 'firstrun_template_chosen'".as[(String, Long)])
      templates.toMap shouldBe Map("blank" -> 2L, "other" -> 1L)
    }

    "leave rollup rows unchanged when run twice over the same data" in {
      seedRollupFixture()
      def snapshot() = priv(DBIO.sequence(Seq(
        sql"SELECT day::text, event, event_count, active_users FROM product_event_daily ORDER BY 1,2".as[(String, String, Long, Long)].map(_.toString),
        sql"SELECT day::text, daily_active_users, weekly_active_users FROM product_active_users_daily ORDER BY 1".as[(String, Long, Long)].map(_.toString),
        sql"SELECT day::text, sample_count, median_seconds, p90_seconds, histogram::text FROM product_ttfd_daily ORDER BY 1".as[(String, Int, Double, Double, String)].map(_.toString),
        sql"SELECT day::text, property_value, event_count FROM product_event_property_daily ORDER BY 1,2".as[(String, String, Long)].map(_.toString)
      )))
      await(repo.rollupDay(D, nowForD, Retention))
      val first = snapshot()
      await(repo.rollupDay(D, nowForD, Retention))
      snapshot() shouldBe first
    }

    "exclude a day's TTFD entirely when it has no valid samples" in {
      rawInsert(userA, "first_dashboard_rendered", at(D, "11:00:00"))
      await(repo.rollupDay(D, nowForD, Retention))
      priv(sql"SELECT COUNT(*) FROM product_ttfd_daily".as[Int].head) shouldBe 0
    }
  }

  "purge" should {

    "delete rows older than the window at an injected clock, keep newer rows, and keep the day's rollup" in {
      val now = Instant.parse("2026-06-30T12:00:00Z")
      rawInsert(userA, "provenance_opened", now.minusSeconds(91L * 86400))
      rawInsert(userA, "provenance_opened", now.minusSeconds(89L * 86400))
      await(repo.purge(now, Retention)) shouldBe 1
      countEvents("provenance_opened") shouldBe 1
      val oldDay = now.minusSeconds(91L * 86400).toString.take(10)
      priv(sql"SELECT event_count FROM product_event_daily WHERE day = CAST($oldDay AS date) AND event = 'provenance_opened'".as[Long].headOption) shouldBe Some(1L)
    }

    "roll up a not-yet-covered past-window day before deleting its rows and advance the high-water mark" in {
      val now = Instant.parse("2026-06-30T12:00:00Z")
      rawInsert(userA, "provenance_opened", now.minusSeconds(95L * 86400))
      await(repo.state()).rolledThrough shouldBe None
      await(repo.purge(now, Retention))
      val cutoffDay = LocalDate.parse(now.minusSeconds(90L * 86400).toString.take(10))
      await(repo.state()).rolledThrough shouldBe Some(cutoffDay)
      val day = now.minusSeconds(95L * 86400).toString.take(10)
      priv(sql"SELECT event_count FROM product_event_daily WHERE day = CAST($day AS date)".as[Long].headOption) shouldBe Some(1L)
    }

    "never purge signup_completed or first_dashboard_rendered, however old" in {
      val now = Instant.parse("2026-06-30T12:00:00Z")
      val old = now.minusSeconds(91L * 86400)
      rawInsert(userA, "signup_completed", old)
      rawInsert(userA, "first_dashboard_rendered", old.plusSeconds(60))
      rawInsert(userA, "provenance_opened", old)
      await(repo.purge(now, Retention)) shouldBe 1
      countEvents("signup_completed") shouldBe 1
      countEvents("first_dashboard_rendered") shouldBe 1
    }

    "not overwrite an already-covered, partly purged day's weekly active users" in {
      val early = Instant.parse("2026-03-12T00:00:00Z")
      rawInsert(userA, "provenance_opened", at(D, "10:00:00"))
      rawInsert(userB, "provenance_opened", at(D.minusDays(2), "10:00:00"))
      await(repo.rollupDay(D, early, Retention))
      val before = priv(sql"SELECT weekly_active_users FROM product_active_users_daily WHERE day = CAST(${D.toString} AS date)".as[Long].head)
      before shouldBe 2L
      val late = at(D.plusDays(100), "00:00:00")
      await(repo.purge(late, Retention))
      await(repo.rollupDay(D, late, Retention)) shouldBe false
      priv(sql"SELECT weekly_active_users FROM product_active_users_daily WHERE day = CAST(${D.toString} AS date)".as[Long].head) shouldBe 2L
    }

    "keep an existing weekly figure when the trailing window has partly left retention" in {
      val y = D
      rawInsert(userA, "provenance_opened", at(y, "10:00:00"))
      rawInsert(userB, "provenance_opened", at(y.minusDays(5), "10:00:00"))
      await(repo.rollupDay(y, at(y.plusDays(1), "00:00:00"), Retention))
      priv(sql"SELECT weekly_active_users FROM product_active_users_daily WHERE day = CAST(${y.toString} AS date)".as[Long].head) shouldBe 2L
      priv(sqlu"DELETE FROM product_events WHERE user_id = ${userB.value}::uuid")
      // cutoff date = y-3: y is after it (not covered), but y-6 is not.
      val laterNow = at(y.plusDays(Retention - 3), "12:00:00")
      await(repo.rollupDay(y, laterNow, Retention)) shouldBe true
      priv(sql"SELECT daily_active_users, weekly_active_users FROM product_active_users_daily WHERE day = CAST(${y.toString} AS date)".as[(Long, Long)].head) shouldBe ((1L, 2L))
    }

    "run at most once per throttle interval" in {
      val now = Instant.parse("2026-06-30T12:00:00Z")
      await(repo.purgeIfDue(now, Retention, 3600)) shouldBe Some(0)
      await(repo.purgeIfDue(now.plusSeconds(3599), Retention, 3600)) shouldBe None
      await(repo.purgeIfDue(now.plusSeconds(3600), Retention, 3600)) shouldBe Some(0)
    }
  }
}
