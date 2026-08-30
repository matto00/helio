package com.helio.api.routes.proposals

import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

import java.util.UUID

/** Route-level coverage for `PUT /api/dashboards/:id/contents` (HEL-363) —
 *  atomic, all-or-nothing replace of an EXISTING dashboard's panel set.
 *  Shares the fixture (real RLS, seeded users/DataTypes) via
 *  `ApplyProposalSpecBase`. */
class DashboardContentsReplaceSpec extends ApplyProposalSpecBase {

  private def createDashboard(name: String): String =
    Post("/api/dashboards", json(s"""{"name":"$name"}"""))
      .addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
      status shouldBe StatusCodes.Created
      responseAs[String].parseJson.asJsObject.fields("id").convertTo[String]
    }

  private def createTextPanel(dashboardId: String, title: String): Unit =
    Post("/api/panels", json(s"""{"dashboardId":"$dashboardId","title":"$title","type":"text"}"""))
      .addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
      status shouldBe StatusCodes.Created
    }

  private def putContents(dashboardId: String, body: String) =
    Put(s"/api/dashboards/$dashboardId/contents", json(body))
      .addHeader(sessionCookie).addHeader(csrfHeader)

  private def panelTitles(dashboardId: String): Vector[String] =
    Get(s"/api/dashboards/$dashboardId/export").addHeader(sessionCookie) ~> routes ~> check {
      status shouldBe StatusCodes.OK
      responseAs[String].parseJson.asJsObject
        .fields("panels").convertTo[Vector[JsValue]]
        .map(_.asJsObject.fields("title").convertTo[String])
    }

  "PUT /api/dashboards/:id/contents" should {

    "atomically replace a dashboard's panels — old panels gone, new panels present, layout applied" in {
      val dashboardId = createDashboard("Rebuild Target")
      createTextPanel(dashboardId, "Old Panel")
      panelTitles(dashboardId) shouldBe Vector("Old Panel")

      val body =
        s"""{"panels":[
           |  {"title":"New Metric","type":"output","dataTypeId":"$pipelineOutputTypeId",
           |   "fieldMapping":{"value":"region"},"layout":{"x":0,"y":0,"w":4,"h":3}},
           |  {"title":"New Text","type":"text"}
           |]}""".stripMargin
      putContents(dashboardId, body) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val obj    = responseAs[String].parseJson.asJsObject
        val panels = obj.fields("panels").convertTo[Vector[JsValue]].map(_.asJsObject)
        panels.map(_.fields("title").convertTo[String]) should contain allOf ("New Metric", "New Text")
      }

      // Old panel gone; new panels present — full replace, not a merge.
      panelTitles(dashboardId) should contain theSameElementsAs Vector("New Metric", "New Text")

      // Layout persisted for the positioned panel.
      Get(s"/api/dashboards/$dashboardId/export").addHeader(sessionCookie) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String].parseJson.asJsObject
          .fields("dashboard").asJsObject.fields("layout").asJsObject
          .fields("lg").convertTo[Vector[JsValue]] should not be empty
      }
    }

    "roll back atomically on one invalid panel — 400 naming the panel, dashboard's panel set unchanged" in {
      val dashboardId = createDashboard("Rollback Target")
      createTextPanel(dashboardId, "Keep Me")
      panelTitles(dashboardId) shouldBe Vector("Keep Me")

      val body =
        """{"panels":[
          |  {"title":"Good","type":"text"},
          |  {"title":"Bad","type":"output"}
          |]}""".stripMargin
      putContents(dashboardId, body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        val msg = responseAs[String].toLowerCase
        msg should include("panel 2")
        msg should include("datatypeid")
      }

      // Nothing deleted or created — the original panel set is untouched.
      panelTitles(dashboardId) shouldBe Vector("Keep Me")
    }

    "reject a source-companion DataType binding on replace, same V41 rule as create — nothing replaced" in {
      val dashboardId = createDashboard("V41 Target")
      createTextPanel(dashboardId, "Keep Me")

      val body =
        s"""{"panels":[
           |  {"title":"Bad","type":"output","dataTypeId":"$companionTypeId","fieldMapping":{"value":"region"}}
           |]}""".stripMargin
      putContents(dashboardId, body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String].toLowerCase should include("pipeline-output")
      }

      panelTitles(dashboardId) shouldBe Vector("Keep Me")
    }

    "return 404 for a dashboard owned by another user — no panels touched" in {
      val otherDashboardId = seedDashboardForOwner("Other Owner's Dashboard", otherId)

      val body = """{"panels":[{"title":"Hijack","type":"text"}]}"""
      putContents(otherDashboardId, body) ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "require authentication" in {
      Put(s"/api/dashboards/${UUID.randomUUID()}/contents", json("""{"panels":[]}""")) ~> routes ~> check {
        status shouldBe StatusCodes.Unauthorized
      }
    }
  }
}
