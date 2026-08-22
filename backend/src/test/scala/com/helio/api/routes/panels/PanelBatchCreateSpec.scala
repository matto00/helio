package com.helio.api.routes.panels

import com.helio.api.routes.proposals.ApplyProposalSpecBase
import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

/** Route-level coverage for `POST /api/panels/batch` (HEL-370) — atomic,
 *  all-or-nothing create of N NEW panels on ONE existing dashboard. Shares
 *  the fixture (real RLS, seeded users/DataTypes) via `ApplyProposalSpecBase`,
 *  mirroring `DashboardContentsReplaceSpec`'s structure. */
class PanelBatchCreateSpec extends ApplyProposalSpecBase {

  private def createDashboard(name: String): String =
    Post("/api/dashboards", json(s"""{"name":"$name"}"""))
      .addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
      status shouldBe StatusCodes.Created
      responseAs[String].parseJson.asJsObject.fields("id").convertTo[String]
    }

  private def createTextPanel(dashboardId: String, title: String): String =
    Post("/api/panels", json(s"""{"dashboardId":"$dashboardId","title":"$title","type":"text"}"""))
      .addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
      status shouldBe StatusCodes.Created
      responseAs[String].parseJson.asJsObject.fields("id").convertTo[String]
    }

  private def batchCreate(body: String) =
    Post("/api/panels/batch", json(body))
      .addHeader(sessionCookie).addHeader(csrfHeader)

  private def panelTitles(dashboardId: String): Vector[String] =
    Get(s"/api/dashboards/$dashboardId/export").addHeader(sessionCookie) ~> routes ~> check {
      status shouldBe StatusCodes.OK
      responseAs[String].parseJson.asJsObject
        .fields("panels").convertTo[Vector[JsValue]]
        .map(_.asJsObject.fields("title").convertTo[String])
    }

  private def exportPanels(dashboardId: String): Vector[JsObject] =
    Get(s"/api/dashboards/$dashboardId/export").addHeader(sessionCookie) ~> routes ~> check {
      status shouldBe StatusCodes.OK
      responseAs[String].parseJson.asJsObject
        .fields("panels").convertTo[Vector[JsValue]].map(_.asJsObject)
    }

  "POST /api/panels/batch" should {

    "create multiple panels on one dashboard in one call, returned in input order" in {
      val dashboardId = createDashboard("Batch Create Target")

      val body =
        s"""{"dashboardId":"$dashboardId","panels":[
           |  {"title":"Photo","type":"image","config":{"imageUrl":"https://example.com/x.png"}},
           |  {"title":"Notes","type":"markdown","config":{"content":"hello"}},
           |  {"title":"Revenue","type":"metric","config":{"dataTypeId":"$pipelineOutputTypeId","fieldMapping":{"value":"region"}}}
           |]}""".stripMargin
      batchCreate(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val panels = responseAs[String].parseJson.asJsObject.fields("panels").convertTo[Vector[JsValue]].map(_.asJsObject)
        panels.map(_.fields("title").convertTo[String]) shouldBe Vector("Photo", "Notes", "Revenue")
        panels.map(_.fields("id").convertTo[String]).distinct should have size 3
        panels.foreach(_.fields("dashboardId").convertTo[String] shouldBe dashboardId)
      }

      panelTitles(dashboardId) should contain theSameElementsAs Vector("Photo", "Notes", "Revenue")
    }

    "roll back atomically on one bad item (invalid type) — 400 naming the item, nothing created" in {
      val dashboardId = createDashboard("Rollback Target")

      val body =
        """{"dashboardId":"REPLACE","panels":[
          |  {"title":"Good One","type":"text"},
          |  {"title":"Bad One","type":"bogus"},
          |  {"title":"Good Two","type":"text"}
          |]}""".stripMargin.replace("REPLACE", dashboardId)
      batchCreate(body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        val msg = responseAs[String]
        msg should include("panel 2")
        msg should include("Bad One")
      }

      panelTitles(dashboardId) shouldBe empty
    }

    "reject a source-companion DataType binding (V41) — 400, nothing created" in {
      val dashboardId = createDashboard("V41 Target")

      val body =
        s"""{"dashboardId":"$dashboardId","panels":[
           |  {"title":"Good","type":"text"},
           |  {"title":"Bad","type":"metric","config":{"dataTypeId":"$companionTypeId","fieldMapping":{"value":"region"}}}
           |]}""".stripMargin
      batchCreate(body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String].toLowerCase should include("pipeline-output")
      }

      panelTitles(dashboardId) shouldBe empty
    }

    "return 404 for a dashboard the caller has no access to — nothing created" in {
      val otherDashboardId = seedDashboardForOwner("Other Owner's Dashboard", otherId)

      val body = s"""{"dashboardId":"$otherDashboardId","panels":[{"title":"Hijack","type":"text"}]}"""
      batchCreate(body) ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
      }

      // Caller has no grant on `otherDashboardId`, so the HTTP export route
      // itself 404s for them too — verify "nothing created" via a
      // privileged, ACL-free read instead.
      panelTitlesForDashboard(otherDashboardId) shouldBe empty
    }

    "return 403 for a viewer-only grantee — nothing created" in {
      val otherDashboardId = seedDashboardForOwner("Viewer Target", otherId)
      grantRole(otherDashboardId, userId, "viewer")

      val body = s"""{"dashboardId":"$otherDashboardId","panels":[{"title":"Hijack","type":"text"}]}"""
      batchCreate(body) ~> routes ~> check {
        status shouldBe StatusCodes.Forbidden
      }

      panelTitlesForDashboard(otherDashboardId) shouldBe empty
    }

    "allow an editor grantee to batch-create" in {
      val otherDashboardId = seedDashboardForOwner("Editor Target", otherId)
      grantRole(otherDashboardId, userId, "editor")

      val body = s"""{"dashboardId":"$otherDashboardId","panels":[{"title":"Added by editor","type":"text"}]}"""
      batchCreate(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
      }

      panelTitles(otherDashboardId) shouldBe Vector("Added by editor")
    }

    "reject an empty panels array with 400" in {
      val dashboardId = createDashboard("Empty Batch Target")

      val body = s"""{"dashboardId":"$dashboardId","panels":[]}"""
      batchCreate(body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "leave existing panels on the dashboard untouched by a batch-create call" in {
      val dashboardId = createDashboard("Additive Target")
      createTextPanel(dashboardId, "Pre-existing")
      val before = exportPanels(dashboardId).find(_.fields("title").convertTo[String] == "Pre-existing").get

      val body = s"""{"dashboardId":"$dashboardId","panels":[{"title":"New Arrival","type":"text"}]}"""
      batchCreate(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val panels = responseAs[String].parseJson.asJsObject.fields("panels").convertTo[Vector[JsValue]].map(_.asJsObject)
        panels should have size 1
        panels.head.fields("title").convertTo[String] shouldBe "New Arrival"
      }

      val after = exportPanels(dashboardId)
      after.map(_.fields("title").convertTo[String]) should contain theSameElementsAs Vector("Pre-existing", "New Arrival")
      after.find(_.fields("title").convertTo[String] == "Pre-existing").get shouldBe before
    }

    "persist per-item config/appearance (incl. chart.chartType) identically to a single POST /api/panels create" in {
      val dashboardIdSingle = createDashboard("Parity Single")
      val dashboardIdBatch  = createDashboard("Parity Batch")

      val chartAppearance =
        s"""{"chart":{"chartType":"pie","seriesColors":["#111111"],"legend":{"show":true,"position":"top"},
           |"tooltip":{"enabled":true},"axisLabels":{"x":{"show":true,"label":"X"},"y":{"show":true,"label":"Y"}}}}""".stripMargin
      val config =
        s"""{"dataTypeId":"$pipelineOutputTypeId","fieldMapping":{"value":"region"}}"""

      val singlePanel =
        Post("/api/panels", json(
          s"""{"dashboardId":"$dashboardIdSingle","title":"Chart","type":"chart","config":$config,"appearance":$chartAppearance}"""
        )).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
          status shouldBe StatusCodes.Created
          responseAs[String].parseJson.asJsObject
        }

      val batchBody =
        s"""{"dashboardId":"$dashboardIdBatch","panels":[
           |  {"title":"Chart","type":"chart","config":$config,"appearance":$chartAppearance}
           |]}""".stripMargin
      val batchPanel = batchCreate(batchBody) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        responseAs[String].parseJson.asJsObject.fields("panels").convertTo[Vector[JsValue]].head.asJsObject
      }

      // Compare every field EXCEPT identity/parent-scoped ones (id, dashboardId,
      // meta timestamps, ownerId) which necessarily differ across two distinct
      // creates on two distinct dashboards.
      val ignoredFields = Set("id", "dashboardId", "meta", "ownerId")
      def strip(obj: JsObject): Map[String, JsValue] = obj.fields.filter { case (k, _) => !ignoredFields.contains(k) }
      strip(singlePanel) shouldBe strip(batchPanel)
    }
  }
}
