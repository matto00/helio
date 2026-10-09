package com.helio.infrastructure.persistence.telemetry

import com.helio.testsupport.ProductTelemetryDbHarness
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api._

import java.time.{Instant, LocalDate}

/** HEL-1420: `product_active_users_daily.monthly_active_users`, the trailing-30-UTC-day distinct
 *  user count written by the real rollup (V121). */
class ProductEventMonthlyActiveSpec extends AnyWordSpec with Matchers with ProductTelemetryDbHarness {

  private val D = LocalDate.parse("2026-06-20")
  private def at(day: LocalDate, hms: String = "10:00:00"): Instant = Instant.parse(s"${day}T${hms}Z")
  private val earlyNow = at(D.plusDays(1), "00:00:00")

  private def mau(day: LocalDate): Option[Long] =
    priv(sql"SELECT monthly_active_users FROM product_active_users_daily WHERE day = CAST(${day.toString} AS date)".as[Option[Long]].headOption).flatten

  "the monthly active users rollup" should {

    "equal the hand-counted distinct users over day-29..day, counting a multi-day user once" in {
      val outsider = newUser()
      rawInsert(userA, "provenance_opened", at(D))
      rawInsert(userA, "provenance_opened", at(D.minusDays(10)))
      rawInsert(userA, "provenance_opened", at(D.minusDays(20)))
      rawInsert(userB, "provenance_opened", at(D.minusDays(29), "00:00:00"))
      rawInsert(outsider, "provenance_opened", at(D.minusDays(30), "23:59:59"))
      await(repo.rollupDay(D, earlyNow, Retention)) shouldBe true
      mau(D) shouldBe Some(2L)
    }

    "be null when the 30-day window starts inside the purged part of retention" in {
      rawInsert(userA, "provenance_opened", at(D))
      // cutoff date = D-10: D is inside retention (rolled), D-29 and D-6 are not.
      await(repo.rollupDay(D, at(D.plusDays(Retention - 10), "12:00:00"), Retention)) shouldBe true
      mau(D) shouldBe None
    }

    "be unchanged by rerolling the same day, and keep an earlier value once the window has partly left retention" in {
      rawInsert(userA, "provenance_opened", at(D))
      rawInsert(userB, "provenance_opened", at(D.minusDays(15)))
      await(repo.rollupDay(D, earlyNow, Retention))
      mau(D) shouldBe Some(2L)
      priv(sqlu"DELETE FROM product_events WHERE user_id = ${userB.value}::uuid")
      await(repo.rollupDay(D, at(D.plusDays(Retention - 10), "12:00:00"), Retention)) shouldBe true
      mau(D) shouldBe Some(2L)
    }
  }
}
