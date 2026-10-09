package com.helio.services.telemetry

import com.helio.api.protocols.admin.{AdminUsageDayCount, AdminUsageProtocol, AdminUsageResponse}
import com.helio.domain.model.UserId
import com.helio.domain.util.Clock
import com.helio.infrastructure.persistence.telemetry.ProductUsageRepository
import com.helio.services.ServiceError
import com.helio.testsupport.ProductTelemetryDbHarness
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.{Instant, LocalDate}

/** HEL-1211 seeded-events test: every number is produced by the REAL write path
 *  (`ProductEventService.ingest` / `recordSignup`, clamping and dedupe included) and the REAL
 *  rollup (`ProductEventRollupService.tickAt`); no rollup row is hand-inserted. The aggregates
 *  `AdminUsageService` returns are then asserted exactly. */
class AdminUsageServiceSpec extends AnyWordSpec with Matchers with ProductTelemetryDbHarness with AdminUsageProtocol {

  private val D1 = LocalDate.parse("2026-04-10")
  private val D2 = D1.plusDays(1)
  private val D3 = D1.plusDays(2)
  private def at(day: LocalDate, hms: String): Instant = Instant.parse(s"${day}T${hms}Z")

  @volatile private var now: Instant = at(D1, "00:00:00")
  private val clock: Clock           = new Clock { def now(): Instant = AdminUsageServiceSpec.this.now }

  private def events(): ProductEventService = new ProductEventService(repo, clock)
  private def rollup(): ProductEventRollupService =
    new ProductEventRollupService(repo, ProductTelemetryConfig(rateLimitPerWindow = 60, retentionDays = Retention), clock)
  private def usage(days: Option[String] = Some("7")): Either[ServiceError, AdminUsageResponse] =
    await(new AdminUsageService(new ProductUsageRepository(ctx), clock).usage(days))

  private def emit(user: UserId, when: Instant, json: String): Unit = {
    now = when
    await(events().ingest(user, json.parseJson)).isRight shouldBe true
  }
  private def signup(user: UserId, when: Instant): Unit = {
    now = when
    await(events().recordSignup(user))
  }

  private def seed(): (UserId, UserId, UserId, UserId) = {
    val (u1, u2, u3, u4) = (newUser(), newUser(), newUser(), newUser())
    // D1
    signup(u1, at(D1, "08:00:00"))
    signup(u2, at(D1, "09:00:00"))
    emit(u1, at(D1, "08:05:00"), """{"events":[{"event":"firstrun_file_dropped","properties":{"source":"drop"}},{"event":"firstrun_template_chosen","properties":{"template":"streamer"}}]}""")
    emit(u1, at(D1, "08:08:00"), """{"events":[{"event":"firstrun_dashboard_created","properties":{"panelCount":3}}]}""")
    emit(u1, at(D1, "08:10:00"), """{"events":[{"event":"first_dashboard_rendered","properties":{"panelCount":3}}]}""")
    emit(u2, at(D1, "09:05:00"), """{"events":[{"event":"firstrun_file_dropped","properties":{"source":"paste"}}]}""")
    // D2
    signup(u3, at(D2, "10:00:00"))
    emit(u3, at(D2, "10:01:00"), """{"events":[{"event":"firstrun_file_dropped","properties":{"source":"drop"}},{"event":"firstrun_template_chosen","properties":{"template":"streamer"}}]}""")
    emit(u3, at(D2, "10:02:00"), """{"events":[{"event":"first_dashboard_rendered"}]}""")
    emit(u2, at(D2, "09:30:00"), """{"events":[{"event":"first_dashboard_rendered"},{"event":"firstrun_dashboard_created","properties":{"panelCount":2}},{"event":"firstrun_template_chosen","properties":{"template":"founder"}}]}""")
    emit(u1, at(D2, "11:00:00"), """{"events":[{"event":"provenance_opened"},{"event":"provenance_opened"}]}""")
    emit(u3, at(D2, "11:30:00"), """{"events":[{"event":"provenance_opened"}]}""")
    // a repeated once-per-user event must not double count
    emit(u1, at(D2, "12:00:00"), """{"events":[{"event":"first_dashboard_rendered"}]}""")
    // D3
    signup(u4, at(D3, "07:00:00"))
    emit(u4, at(D3, "07:05:00"), """{"events":[{"event":"firstrun_template_chosen","properties":{"template":"zzz-custom"}}]}""")
    emit(u2, at(D3, "08:00:00"), """{"events":[{"event":"provenance_opened"}]}""")
    now = at(D1.plusDays(5), "12:00:00")
    await(rollup().tickAt(now))
    (u1, u2, u3, u4)
  }

  private def counts(series: Seq[AdminUsageDayCount]): Map[String, Long] = series.filter(_.count > 0).map(c => c.day -> c.count).toMap

  "AdminUsageService over really-ingested, really-rolled-up events" should {

    "return exactly the aggregates the events imply" in {
      seed()
      val r = usage().toOption.get
      // window = 7 days ending at rolled_through (tick day 04-15 minus 2 = 04-13)
      r.rolledThrough shouldBe Some("2026-04-13")
      (r.from, r.to) shouldBe (("2026-04-07", "2026-04-13"))
      r.signupsPerDay.map(_.day) shouldBe (0 until 7).map(i => D1.minusDays(3).plusDays(i.toLong).toString)
      counts(r.signupsPerDay) shouldBe Map(D1.toString -> 2L, D2.toString -> 1L, D3.toString -> 1L)
      counts(r.provenanceOpensPerDay) shouldBe Map(D2.toString -> 3L, D3.toString -> 1L)

      // funnel is event-day distinct users summed over the window, not a cohort
      r.funnel.map(s => s.stage -> s.users) shouldBe Seq("firstrun_file_dropped" -> 3L, "firstrun_dashboard_created" -> 2L, "first_dashboard_rendered" -> 3L)
      r.funnel.head.conversionFromPrevious shouldBe None
      r.funnel(1).conversionFromPrevious.get shouldBe (2.0 / 3.0 +- 1e-9)
      r.funnel(2).conversionFromPrevious.get shouldBe (1.5 +- 1e-9)

      // streamer x2, founder x1, the unlisted slug bucketed to `other`
      r.templateChoices.map(t => t.template -> t.count) shouldBe Seq("streamer" -> 2L, "founder" -> 1L, "other" -> 1L)

      // TTFD: D1 = U1 600s; D2 = U3 120s and U2 (signed up D1 09:00, rendered D2 09:30) 88200s
      r.ttfd.newUsersOnly shouldBe true
      val byDay = r.ttfd.perDay.map(d => d.day -> d).toMap
      byDay(D1.toString).sampleCount shouldBe 1
      byDay(D1.toString).medianSeconds.get shouldBe (600.0 +- 1e-6)
      byDay(D2.toString).sampleCount shouldBe 2
      byDay(D2.toString).medianSeconds.get shouldBe (44160.0 +- 1e-6)
      byDay(D2.toString).p90Seconds.get shouldBe (79392.0 +- 1e-6)
      byDay(D3.toString).sampleCount shouldBe 0
      byDay(D3.toString).medianSeconds shouldBe None
      r.ttfd.latest.map(_.day) shouldBe Some(D2.toString)

      // DAU zero-filled; WAU null (gap) for days with no rollup row, never 0
      val au = r.activeUsers.map(a => a.day -> a).toMap
      (au(D1.toString).dailyActiveUsers, au(D1.toString).weeklyActiveUsers) shouldBe ((2L, Some(2L)))
      (au(D2.toString).dailyActiveUsers, au(D2.toString).weeklyActiveUsers) shouldBe ((3L, Some(3L)))
      (au(D3.toString).dailyActiveUsers, au(D3.toString).weeklyActiveUsers) shouldBe ((2L, Some(4L)))
      (au("2026-04-13").dailyActiveUsers, au("2026-04-13").weeklyActiveUsers) shouldBe ((0L, Some(4L)))
      (au("2026-04-08").dailyActiveUsers, au("2026-04-08").weeklyActiveUsers) shouldBe ((0L, None))
    }

    "carry no user identifier anywhere in the serialised response" in {
      val (u1, u2, u3, u4) = seed()
      val r    = usage().toOption.get
      val text = r.toJson.compactPrint
      Seq(u1, u2, u3, u4).foreach(u => text should not include u.value)
      text should not include "userId"
    }

    "narrow the window when days is smaller" in {
      seed()
      val r = usage(Some("2")).toOption.get
      (r.from, r.to) shouldBe (("2026-04-12", "2026-04-13"))
      counts(r.signupsPerDay) shouldBe Map(D3.toString -> 1L)
      r.templateChoices.map(t => t.template -> t.count) shouldBe Seq("other" -> 1L)
    }

    "return an empty, zero-filled window ending today when nothing has been rolled up" in {
      now = at(D1, "12:00:00")
      val r = usage(Some("3")).toOption.get
      r.rolledThrough shouldBe None
      r.to shouldBe D1.toString
      r.signupsPerDay.map(_.count) shouldBe Seq(0L, 0L, 0L)
      r.funnel.map(_.users) shouldBe Seq(0L, 0L, 0L)
      r.templateChoices shouldBe empty
      r.ttfd.latest shouldBe None
      r.activeUsers.map(_.weeklyActiveUsers) shouldBe Seq(None, None, None)
    }

    "ignore the still-moving rollup rows and return the zero-filled window while rolled_through is null" in {
      val u = newUser()
      signup(u, at(D1, "08:00:00"))
      emit(u, at(D1, "08:05:00"), """{"events":[{"event":"provenance_opened"}]}""")
      now = at(D1, "12:00:00")
      await(rollup().tickAt(now))
      priv(sql"SELECT COUNT(*) FROM product_event_daily".as[Int].head) should be > 0
      await(repo.state()).rolledThrough shouldBe None
      val r = usage(Some("3")).toOption.get
      r.rolledThrough shouldBe None
      r.signupsPerDay.map(_.count) shouldBe Seq(0L, 0L, 0L)
      r.provenanceOpensPerDay.map(_.count) shouldBe Seq(0L, 0L, 0L)
      r.funnel.map(_.users) shouldBe Seq(0L, 0L, 0L)
    }

    "reject days that is not an integer in 1..365 as BadRequest rather than clamping" in {
      Seq("abc", "0", "366", "-1", "").foreach { d =>
        usage(Some(d)) match {
          case Left(ServiceError.BadRequest(_)) => succeed
          case other                            => fail(s"days=$d -> $other")
        }
      }
      usage(None).toOption.get.days shouldBe 30
      usage(Some("365")).toOption.get.days shouldBe 365
      usage(Some("1")).toOption.get.days shouldBe 1
    }
  }
}
