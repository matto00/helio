package com.helio.api.routes.firstrun

import com.helio.api.protocols.firstrun.FirstRunDashboardResponse
import com.helio.services.firstrun.PersonaTemplates
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, StatusCodes}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.util.UUID

/** HEL-1210: `POST /api/first-run/template` on the full `ApiRoutes`, real RLS and a counting Claude
 *  transport. Each persona must yield a rendered dashboard of correctly typed, materialized rows for
 *  a free-tier user with zero model calls, owned entirely by the caller. */
class PersonaTemplateRoutesSpec extends AnyWordSpec with Matchers with FirstRunRoutesFixture {

  private val SystemUserId = "00000000-0000-0000-0000-000000000001"

  private def chooseTemplate(slug: String) =
    authed(Post("/api/first-run/template", HttpEntity(ContentTypes.`application/json`, s"""{"template":"$slug"}""")))

  private def rowsOf(outputId: String): (Boolean, Vector[JsObject]) =
    authed(Get(s"/api/outputs/$outputId/rows")) ~> routes ~> check {
      status shouldBe StatusCodes.OK
      val body = responseAs[String].parseJson.asJsObject
      (body.fields("materialized") == JsBoolean(true), body.fields("items").convertTo[Vector[JsObject]])
    }

  private def outputIds(pipelineId: String): Vector[(String, String)] =
    sql1(sql"SELECT id::text, kind FROM outputs WHERE pipeline_id = $pipelineId ORDER BY name".as[(String, String)]).toVector

  private def instantiate(slug: String): FirstRunDashboardResponse =
    chooseTemplate(slug) ~> routes ~> check {
      status shouldBe StatusCodes.Created
      responseAs[FirstRunDashboardResponse]
    }

  "POST /api/first-run/template" should {

    PersonaTemplates.All.foreach { t =>
      s"build the ${t.slug} dashboard for a free-tier user with typed, materialized rows and ZERO Claude calls" in {
        sql1(sql"SELECT tier FROM users WHERE id = $userId::uuid".as[String].head) shouldBe "free"
        val before = claudeCalls.get
        val r      = instantiate(t.slug)
        r.panelCount shouldBe 3
        r.sourceName shouldBe t.sourceName
        r.dashboardName shouldBe t.dashboardName
        sql1(sql"SELECT COUNT(*) FROM panels WHERE dashboard_id = ${r.dashboardId}".as[Int].head) shouldBe 3

        val byKind = outputIds(r.pipelineId)
        byKind.map(_._2).sorted shouldBe Vector("chart", "chart", "table")
        val (tableMaterialized, tableRows) = rowsOf(byKind.find(_._2 == "table").get._1)
        tableMaterialized shouldBe true
        tableRows.size should be >= 50
        tableRows.head.fields.keys.toVector.sorted shouldBe t.tableColumns.sorted
        t.numericColumns.keys.foreach { col =>
          tableRows.foreach(row => withClue(s"$col in $row: ")(row.fields(col) shouldBe a[JsNumber]))
        }
        byKind.filter(_._2 == "chart").foreach { case (id, _) =>
          val (materialized, rows) = rowsOf(id)
          materialized shouldBe true
          rows should not be empty
        }
        val chartTypes = sql1(sql"SELECT appearance::jsonb -> 'chart' ->> 'chartType' FROM panels WHERE dashboard_id = ${r.dashboardId}".as[Option[String]]).toVector
        chartTypes.flatten.sorted shouldBe Vector(t.series.chartType, t.ranking.chartType).sorted
        val tableConfig = sql1(sql"SELECT config::text FROM outputs WHERE id = ${byKind.find(_._2 == "table").get._1}".as[String].head).parseJson.asJsObject
        tableConfig.fields("columnOrder").convertTo[Vector[String]] shouldBe t.tableColumns
        claudeCalls.get shouldBe before
      }
    }

    "own every created resource by the caller: none system-owned, none visible to another user" in {
      val r        = instantiate("streamer")
      val pipeline = r.pipelineId
      def owners(table: String, where: String): Set[String] =
        sql1(sql"SELECT DISTINCT owner_id::text FROM #$table WHERE #$where".as[String]).toSet
      owners("data_sources", s"id = '${r.sourceId}'") shouldBe Set(userId)
      owners("pipelines", s"id = '$pipeline'") shouldBe Set(userId)
      owners("outputs", s"pipeline_id = '$pipeline'") shouldBe Set(userId)
      owners("dashboards", s"id = '${r.dashboardId}'") shouldBe Set(userId)
      owners("panels", s"dashboard_id = '${r.dashboardId}'") shouldBe Set(userId)
      sql1(sql"SELECT COUNT(*) FROM data_sources WHERE owner_id = $SystemUserId::uuid".as[Int].head) shouldBe 0

      val tableOutput  = outputIds(pipeline).find(_._2 == "table").get._1
      sql1(sql"SELECT COUNT(*) FROM outputs WHERE id = $tableOutput".as[Int].head) shouldBe 1
      authed(Get(s"/api/outputs/$tableOutput/rows"), otherSession) ~> routes ~> check { status shouldBe StatusCodes.NotFound }
      authed(Get("/api/outputs"), otherSession) ~> routes ~> check { responseAs[String] should not include tableOutput }
      authed(Get("/api/data-sources"), otherSession) ~> routes ~> check { responseAs[String] should not include r.sourceId }
      authed(Delete(s"/api/dashboards/${r.dashboardId}"), otherSession) ~> routes ~> check { status shouldBe StatusCodes.NotFound }
    }

    "leave the instantiated resources editable and deletable by the owner" in {
      val r = instantiate("finance")
      authed(Patch(s"/api/dashboards/${r.dashboardId}", HttpEntity(ContentTypes.`application/json`, """{"name":"My finance"}"""))) ~> routes ~> check {
        status shouldBe StatusCodes.OK
      }
      sql1(sql"SELECT name FROM dashboards WHERE id = ${r.dashboardId}".as[String].head) shouldBe "My finance"
      authed(Delete(s"/api/dashboards/${r.dashboardId}")) ~> routes ~> check { status shouldBe StatusCodes.NoContent }
      authed(Delete(s"/api/pipelines/${r.pipelineId}")) ~> routes ~> check { status shouldBe StatusCodes.NoContent }
      authed(Delete(s"/api/data-sources/${r.sourceId}")) ~> routes ~> check { status shouldBe StatusCodes.NoContent }
      sql1(sql"SELECT COUNT(*) FROM data_sources WHERE id = ${r.sourceId}".as[Int].head) shouldBe 0
    }

    "400 on an unknown slug and create nothing" in {
      val before = sql1(sql"SELECT COUNT(*) FROM data_sources".as[Int].head)
      chooseTemplate("not-a-persona") ~> routes ~> check { status shouldBe StatusCodes.BadRequest }
      chooseTemplate(UUID.randomUUID().toString) ~> routes ~> check { status shouldBe StatusCodes.BadRequest }
      sql1(sql"SELECT COUNT(*) FROM data_sources".as[Int].head) shouldBe before
    }

    "require authentication" in {
      Post("/api/first-run/template", HttpEntity(ContentTypes.`application/json`, """{"template":"ops"}""")) ~> routes ~> check {
        status shouldBe StatusCodes.Unauthorized
      }
    }
  }
}
