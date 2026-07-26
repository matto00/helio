package com.helio.api

import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

/** HEL-624 task 5.6 — `PUT /api/dashboards/:id/contents` (replace-contents)
 *  rejects a chart panel combining `chartType: "scatter"` with a present
 *  `aggregation`, whether supplied via the flat `aggregation` field OR via
 *  the generic `config` passthrough (HEL-316) — the same rule and the same
 *  bypass `DashboardApplyProposalAggregationSpec` covers for apply-proposal,
 *  since both paths share `ProposalPanelSupport.validatePanel`. Shares the
 *  fixture via `ApplyProposalSpecBase`. */
class DashboardContentsReplaceAggregationSpec extends ApplyProposalSpecBase {

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

    "reject a scatter+aggregation chart panel via the flat aggregation field — nothing replaced" in {
      val dashboardId = createDashboard("Scatter Flat Aggregation Replace")
      createTextPanel(dashboardId, "Keep Me")

      val body =
        s"""{"panels":[
           |  {"title":"Scatter","type":"chart","dataTypeId":"$pipelineOutputTypeId",
           |   "fieldMapping":{}, "chartType":"scatter",
           |   "aggregation":{"groupBy":"region","agg":"sum","yField":"region"}}
           |]}""".stripMargin
      putContents(dashboardId, body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("aggregation is not supported for scatter charts")
      }

      panelTitles(dashboardId) shouldBe Vector("Keep Me")
    }

    "reject a scatter+aggregation chart panel via the config passthrough — nothing replaced" in {
      val dashboardId = createDashboard("Scatter Config Passthrough Replace")
      createTextPanel(dashboardId, "Keep Me")

      // `aggregation` supplied ONLY via the generic `config` passthrough (not
      // the flat field) — the bypass a flat-field-only check would miss.
      val body =
        s"""{"panels":[
           |  {"title":"Scatter","type":"chart","dataTypeId":"$pipelineOutputTypeId",
           |   "fieldMapping":{}, "chartType":"scatter",
           |   "config":{"aggregation":{"groupBy":"region","agg":"sum","yField":"region"}}}
           |]}""".stripMargin
      putContents(dashboardId, body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("aggregation is not supported for scatter charts")
      }

      panelTitles(dashboardId) shouldBe Vector("Keep Me")
    }

    "accept a scatter chart panel with no aggregation (regression)" in {
      val dashboardId = createDashboard("Scatter No Aggregation Replace")
      createTextPanel(dashboardId, "Old Panel")

      val body =
        s"""{"panels":[
           |  {"title":"Scatter","type":"chart","dataTypeId":"$pipelineOutputTypeId",
           |   "fieldMapping":{}, "chartType":"scatter"}
           |]}""".stripMargin
      putContents(dashboardId, body) ~> routes ~> check {
        status shouldBe StatusCodes.OK
      }

      panelTitles(dashboardId) shouldBe Vector("Scatter")
    }
  }
}
