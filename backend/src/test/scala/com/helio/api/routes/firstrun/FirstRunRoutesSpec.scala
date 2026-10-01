package com.helio.api.routes.firstrun

import com.helio.api._
import com.helio.api.http.{AuthDirectives, SessionCookies}
import com.helio.api.protocols.firstrun.FirstRunDashboardResponse
import com.helio.domain.model.{AuthenticatedUser, UserId}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.infrastructure.ai._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.{ResourcePermissionRepository, UserPreferenceRepository, UserRepository, UserSessionRepository}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.sources.DataSourceService
import com.helio.spark.{PipelineRunCache, SparkJobSubmitter}
import com.helio.testkit.TempDirectorySupport
import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.NotUsed
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, HttpRequest, StatusCodes}
import org.apache.pekko.http.scaladsl.model.headers.{Cookie, RawHeader}
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.SystemMaterializer
import org.apache.pekko.stream.scaladsl.Source
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future}

/** HEL-1209: `POST /api/first-run/dashboard` on the FULL `ApiRoutes` under real RLS, a real CSV on a
 *  real filesystem, and a counting Claude transport wired through every Claude-bearing service
 *  (via ApiRoutes' test seams). A free-tier build must reach a rendered dashboard with zero
 *  transport calls; a positive control proves the same transport IS reachable from this wiring. */
class FirstRunRoutesSpec extends AnyWordSpec with Matchers with FirstRunRoutesFixture {

  protected def build(sourceId: String) =
    authed(Post("/api/first-run/dashboard", HttpEntity(ContentTypes.`application/json`, s"""{"sourceId":"$sourceId"}""")))

  "POST /api/first-run/dashboard" should {

    "build a dashboard with rendered rows for a free-tier user and make ZERO Claude calls" in {
      val srcId  = csvSource(user, "Sales", datedCsv)
      val before = claudeCalls.get
      build(srcId) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val r = responseAs[FirstRunDashboardResponse]
        r.panelCount shouldBe 3
        r.sourceId shouldBe srcId
        sql1(sql"SELECT COUNT(*) FROM panels WHERE dashboard_id = ${r.dashboardId}".as[Int].head) shouldBe 3
        val tableOutput = sql1(sql"SELECT id FROM outputs WHERE pipeline_id = ${r.pipelineId} AND kind = 'table'".as[String].head)
        authed(Get(s"/api/outputs/$tableOutput/rows")) ~> routes ~> check {
          status shouldBe StatusCodes.OK
          val body  = responseAs[String].parseJson.asJsObject
          val items = body.fields("items").convertTo[Vector[JsObject]]
          body.fields("materialized") shouldBe JsBoolean(true)
          items should have size 3
          items.map(_.fields("amount")).foreach(_ shouldBe a[JsNumber])
        }
      }
      claudeCalls.get shouldBe before
    }

    "materialize the chart outputs with real aggregated rows: 3 daily buckets and a 2-category top-n summing amount" in {
      val srcId = csvSource(user, "Sales2", datedCsv)
      build(srcId) ~> routes ~> check {
        val r = responseAs[FirstRunDashboardResponse]
        def itemsOf(name: String): Vector[JsObject] = {
          val id = sql1(sql"SELECT id FROM outputs WHERE pipeline_id = ${r.pipelineId} AND name = ${s"Sales2 $name"}".as[String].head)
          authed(Get(s"/api/outputs/$id/rows")) ~> routes ~> check {
            responseAs[String].parseJson.asJsObject.fields("items").convertTo[Vector[JsObject]]
          }
        }
        itemsOf("over time").map(_.fields("day")) shouldBe Vector("2026-01-01", "2026-01-02", "2026-01-03").map(JsString(_))
        itemsOf("top region").map(o => o.fields("region") -> o.fields("amount_sum")) shouldBe
          Vector(JsString("North") -> JsNumber(40), JsString("South") -> JsNumber(20))
      }
    }

    "reach the counting transport from the same wiring once the user is beta (positive control for the zero-call assertion)" in {
      sql1(sqlu"UPDATE users SET tier = 'beta' WHERE id = $userId::uuid")
      val before = claudeCalls.get
      authed(Post("/api/authoring/dashboard", HttpEntity(ContentTypes.`application/json`, """{"goal":"Show sales"}"""))) ~> routes ~> check {
        status should not be StatusCodes.Forbidden
      }
      claudeCalls.get should be > before
      sql1(sqlu"UPDATE users SET tier = 'free' WHERE id = $userId::uuid")
    }

    "persist a full-width, non-overlapping layout at every breakpoint for 1, 2 and 3 panels" in {
      val oneCol  = csvSource(user, "Names", "name,city\na,x\nb,y\nc,x\n")
      val twoCols = csvSource(user, "Trend", "day,amount\n2026-01-01,1\n2026-01-02,2\n2026-01-03,3\n")
      val widths  = Map("lg" -> 12, "md" -> 10, "sm" -> 6, "xs" -> 2)
      for ((src, expected) <- Seq(oneCol -> 1, twoCols -> 2, csvSource(user, "Full", datedCsv) -> 3)) {
        build(src) ~> routes ~> check {
          status shouldBe StatusCodes.Created
          val r = responseAs[FirstRunDashboardResponse]
          r.panelCount shouldBe expected
          val layout = layoutOf(r.dashboardId)
          widths.foreach { case (bp, cols) =>
            layout(bp) should have size expected.toLong
            layout(bp).foreach { case (x, _, w, _) => (x, w) shouldBe ((0, cols)) }
            noOverlap(layout(bp)) shouldBe true
          }
        }
      }
    }

    "produce a single table panel and no cast step for a CSV with no numeric column" in {
      val src = csvSource(user, "Names", "name,city\na,x\nb,y\nc,x\n")
      build(src) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val r = responseAs[FirstRunDashboardResponse]
        r.panelCount shouldBe 1
        sql1(sql"SELECT COUNT(*) FROM pipeline_steps WHERE pipeline_id = ${r.pipelineId} AND op = 'cast'".as[Int].head) shouldBe 0
      }
    }

    "404 for an unknown source and for another user's source, creating nothing" in {
      val theirs = csvSource(other, "Theirs", datedCsv)
      val pipelinesBefore = sql1(sql"SELECT COUNT(*) FROM pipelines".as[Int].head)
      build(UUID.randomUUID().toString) ~> routes ~> check { status shouldBe StatusCodes.NotFound }
      build(theirs) ~> routes ~> check { status shouldBe StatusCodes.NotFound }
      sql1(sql"SELECT COUNT(*) FROM pipelines".as[Int].head) shouldBe pipelinesBefore
    }

    "400 for a header-only CSV and for a non-csv source" in {
      val headerOnly = csvSource(user, "Empty", "a,b\n")
      build(headerOnly) ~> routes ~> check { status shouldBe StatusCodes.BadRequest }
      val staticId = UUID.randomUUID().toString
      sql1(sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
                  VALUES ($staticId::uuid, 'st', 'dataset', '{}'::jsonb, $userId::uuid, now(), now())""")
      build(staticId) ~> routes ~> check { status shouldBe StatusCodes.BadRequest }
    }
  }
}
