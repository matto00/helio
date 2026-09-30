package com.helio.services.telemetry

import com.helio.domain.util.Clock
import com.helio.testsupport.ProductTelemetryDbHarness
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api._

import java.time.{Instant, LocalDate}

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
}
