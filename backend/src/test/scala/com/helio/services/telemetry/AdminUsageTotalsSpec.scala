package com.helio.services.telemetry

import com.helio.api.protocols.admin.{AdminUsageProtocol, AdminUsageResponse}
import com.helio.domain.model.UserId
import com.helio.domain.util.Clock
import com.helio.infrastructure.persistence.telemetry.ProductUsageRepository
import com.helio.testsupport.{JsonSchemaValidation, ProductTelemetryDbHarness}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.sql.Timestamp
import java.time.{Instant, LocalDate}

/** HEL-1420: the all-time `totals` block over a prod-like fixture -- 8 users created 53..166 days
 *  before `rolled_through` plus the V10 system user -- written through the REAL ingest path and
 *  rolled up by the REAL rollup. The harness's own userA/userB are part of the 8 and every other
 *  `users` row is deleted first, so the exact count never depends on residue. */
class AdminUsageTotalsSpec extends AnyWordSpec with Matchers with ProductTelemetryDbHarness with AdminUsageProtocol {

  private val SystemId = "00000000-0000-0000-0000-000000000001"
  private val Rolled   = LocalDate.parse("2026-10-07")
  private def day(offset: Int): LocalDate = Rolled.plusDays(offset.toLong)
  private def at(d: LocalDate, hms: String = "10:00:00"): Instant = Instant.parse(s"${d}T${hms}Z")

  @volatile private var now: Instant = at(Rolled)
  private val clock: Clock           = new Clock { def now(): Instant = AdminUsageTotalsSpec.this.now }

  private def events()  = new ProductEventService(repo, clock)
  private def rollup()  = new ProductEventRollupService(repo, ProductTelemetryConfig(rateLimitPerWindow = 60, retentionDays = Retention), clock)
  private def usage(days: String = "30"): AdminUsageResponse =
    await(new AdminUsageService(new ProductUsageRepository(ctx), clock).usage(Some(days))).toOption.get

  private def provenance(user: UserId, d: LocalDate): Unit = {
    now = at(d)
    await(events().ingest(user, """{"events":[{"event":"provenance_opened"}]}""".parseJson)).isRight shouldBe true
  }

  /** Eight users, signed up 53..166 days before `Rolled`. Tracked-event activity (signups are far
   *  outside every window): 7-day window = 10-01..10-07, 30-day window = 09-08..10-07.
   *    u1 10-06                    -> 7d and 30d
   *    u2 10-02 and 10-05          -> 7d and 30d, counted once
   *    u3 09-20, u4 09-10          -> 30d only
   *    u5 09-07                    -> one day before the 30d window
   *    u6 10-08                    -> after `Rolled`
   *    u7, u8                      -> signup only
   *  so the hand count is 7d = 2, 30d = 4. */
  private def seedProdLike(): Unit = {
    priv(sqlu"DELETE FROM users WHERE id NOT IN (${SystemId}::uuid, ${userA.value}::uuid, ${userB.value}::uuid)")
    val users = Seq(userA, userB) ++ Seq.fill(6)(newUser())
    val ages  = Seq(53, 60, 75, 90, 110, 130, 150, 166)
    users.zip(ages).foreach { case (u, age) =>
      val created = at(day(-age), "08:00:00")
      priv(sqlu"UPDATE users SET created_at = ${Timestamp.from(created)} WHERE id = ${u.value}::uuid")
      now = created
      await(events().recordSignup(u))
    }
    val Seq(u1, u2, u3, u4, u5, u6, _, _) = users
    provenance(u1, day(-1))
    provenance(u2, day(-5)); provenance(u2, day(-2))
    provenance(u3, day(-17))
    provenance(u4, day(-27))
    provenance(u5, day(-30))
    provenance(u6, day(1))
    now = at(day(2), "12:00:00")
    await(rollup().tickAt(now))
  }

  "totals over the prod-like fixture (8 users 53..166 days old plus the system user)" should {

    "report total users = 8 excluding the system user, independent of the window" in {
      seedProdLike()
      priv(sql"SELECT COUNT(*) FROM users".as[Int].head) shouldBe 9
      Seq("1", "7", "90", "365").foreach { d =>
        withClue(s"days=$d: ")(usage(d).totals.totalUsers shouldBe 8L)
      }
    }

    "report distinct, non-zero 7-day and 30-day active counts as of rolled_through" in {
      seedProdLike()
      val t = usage().totals
      t.asOf shouldBe Some(Rolled.toString)
      t.activeLast7Days shouldBe Some(2L)
      t.activeLast30Days shouldBe Some(4L)
    }

    "keep the totals fixed while the series window changes" in {
      seedProdLike()
      usage("7").totals shouldBe usage("365").totals
    }

    "return null active counts and asOf, but still the user count, before anything is rolled up" in {
      priv(sqlu"DELETE FROM users WHERE id NOT IN (${SystemId}::uuid, ${userA.value}::uuid, ${userB.value}::uuid)")
      val t = usage().totals
      (t.totalUsers, t.activeLast7Days, t.activeLast30Days, t.asOf) shouldBe ((2L, None, None, None))
    }

    "return a null 30-day count, never 0, when the rolled_through row has no monthly value" in {
      seedProdLike()
      priv(sqlu"UPDATE product_active_users_daily SET monthly_active_users = NULL")
      val t = usage().totals
      t.activeLast7Days shouldBe Some(2L)
      t.activeLast30Days shouldBe None
    }

    "carry no user identifier anywhere in the serialised response, totals included" in {
      seedProdLike()
      val text = usage().toJson.compactPrint
      (Seq(userA, userB).map(_.value) :+ SystemId).foreach(id => text should not include id)
      text should not include "userId"
      usage().toJson.asJsObject.fields("totals").asJsObject.fields.keySet shouldBe
        Set("totalUsers", "activeLast7Days", "activeLast30Days", "asOf")
    }

    "serialise to a body that validates against admin-usage-response.schema.json, nulls included" in {
      val schema = JsonSchemaValidation.compile("admin/admin-usage-response.schema.json")
      seedProdLike()
      JsonSchemaValidation.validationErrors(schema, usage("365").toJson.compactPrint) shouldBe empty
      priv(sqlu"UPDATE product_active_users_daily SET monthly_active_users = NULL")
      val withNull = usage().toJson
      withNull.asJsObject.fields("totals").asJsObject.fields("activeLast30Days") shouldBe JsNull
      JsonSchemaValidation.validationErrors(schema, withNull.compactPrint) shouldBe empty
    }
  }
}
