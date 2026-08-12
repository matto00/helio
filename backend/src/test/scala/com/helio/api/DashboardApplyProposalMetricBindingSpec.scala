package com.helio.api

import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

import java.util.UUID

/** HEL-549: `metricId` validation coverage for both write paths that share
 *  `ProposalPanelSupport.preValidateBindings` — `POST /api/dashboards/
 *  apply-proposal` and `PUT /api/dashboards/:id/contents`. Valid/foreign/
 *  deprecated/unsupported-type `metricId` cases, each proven atomic (nothing
 *  created/replaced on rejection). Shares the fixture via
 *  `ApplyProposalSpecBase`. */
class DashboardApplyProposalMetricBindingSpec extends ApplyProposalSpecBase {

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

  // ── POST /api/dashboards/apply-proposal ────────────────────────────────────

  "POST /api/dashboards/apply-proposal" should {

    "create a metric panel bound to a valid, caller-owned metricId" in {
      val metricId = seedMetric(userId, pipelineOutputTypeId)
      val before   = dashboardCount()
      val body =
        s"""{
           |  "dashboardName": "Metric Binding",
           |  "panels": [
           |    {"title":"Revenue","type":"metric","dataTypeId":"$pipelineOutputTypeId",
           |     "fieldMapping":{"value":"region"},"metricId":"$metricId"}
           |  ]
           |}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val obj    = responseAs[String].parseJson.asJsObject
        val panels = obj.fields("panels").convertTo[Vector[JsValue]].map(_.asJsObject)
        val panel  = panels.find(_.fields("title").convertTo[String] == "Revenue").get
        panel.fields("config").asJsObject.fields("metricId") shouldBe JsString(metricId)
      }
      dashboardCount() shouldBe (before + 1)
    }

    "reject a nonexistent metricId and create nothing (atomic)" in {
      val before = dashboardCount()
      val body =
        s"""{"dashboardName":"Bad","panels":[
           |  {"title":"X","type":"metric","dataTypeId":"$pipelineOutputTypeId",
           |   "fieldMapping":{"value":"region"},"metricId":"${UUID.randomUUID()}"}
           |]}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String].toLowerCase should include("not found")
      }
      dashboardCount() shouldBe before
    }

    "reject a foreign metricId (owned by another user) under RLS and create nothing" in {
      val foreignMetricId = seedMetric(otherId, otherUserTypeId)
      val before           = dashboardCount()
      val body =
        s"""{"dashboardName":"Bad","panels":[
           |  {"title":"X","type":"metric","dataTypeId":"$pipelineOutputTypeId",
           |   "fieldMapping":{"value":"region"},"metricId":"$foreignMetricId"}
           |]}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String].toLowerCase should include("not found")
      }
      dashboardCount() shouldBe before
    }

    "reject a deprecated metricId and create nothing" in {
      val deprecatedMetricId = seedMetric(userId, pipelineOutputTypeId, deprecated = true)
      val before             = dashboardCount()
      val body =
        s"""{"dashboardName":"Bad","panels":[
           |  {"title":"X","type":"metric","dataTypeId":"$pipelineOutputTypeId",
           |   "fieldMapping":{"value":"region"},"metricId":"$deprecatedMetricId"}
           |]}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String].toLowerCase should include("deprecated")
      }
      dashboardCount() shouldBe before
    }

    "reject a metricId on an unsupported panel type (collection) and create nothing" in {
      val metricId = seedMetric(userId, pipelineOutputTypeId)
      val before    = dashboardCount()
      val body =
        s"""{"dashboardName":"Bad","panels":[
           |  {"title":"X","type":"collection","dataTypeId":"$pipelineOutputTypeId",
           |   "fieldMapping":{"value":"region"},"metricId":"$metricId"}
           |]}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String].toLowerCase should include("not supported")
      }
      dashboardCount() shouldBe before
    }
  }

  // ── PUT /api/dashboards/:id/contents ────────────────────────────────────────
  // DashboardContentsService shares ProposalPanelSupport.preValidateBindings,
  // so the same metricId checks apply here — proven atomic on an EXISTING
  // dashboard's panel set instead of "nothing created".

  "PUT /api/dashboards/:id/contents" should {

    "replace contents with a metric panel bound to a valid, caller-owned metricId" in {
      val metricId     = seedMetric(userId, pipelineOutputTypeId)
      val dashboardId  = createDashboard("Contents Metric Binding")
      createTextPanel(dashboardId, "Keep Me")

      val body =
        s"""{"panels":[
           |  {"title":"Revenue","type":"metric","dataTypeId":"$pipelineOutputTypeId",
           |   "fieldMapping":{"value":"region"},"metricId":"$metricId"}
           |]}""".stripMargin
      putContents(dashboardId, body) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val obj    = responseAs[String].parseJson.asJsObject
        val panels = obj.fields("panels").convertTo[Vector[JsValue]].map(_.asJsObject)
        val panel  = panels.find(_.fields("title").convertTo[String] == "Revenue").get
        panel.fields("config").asJsObject.fields("metricId") shouldBe JsString(metricId)
      }
      panelTitles(dashboardId) shouldBe Vector("Revenue")
    }

    "reject a foreign metricId on replace and leave the dashboard's contents unchanged" in {
      val foreignMetricId = seedMetric(otherId, otherUserTypeId)
      val dashboardId      = createDashboard("Contents Rollback")
      createTextPanel(dashboardId, "Keep Me")

      val body =
        s"""{"panels":[
           |  {"title":"Bad","type":"metric","dataTypeId":"$pipelineOutputTypeId",
           |   "fieldMapping":{"value":"region"},"metricId":"$foreignMetricId"}
           |]}""".stripMargin
      putContents(dashboardId, body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String].toLowerCase should include("not found")
      }
      panelTitles(dashboardId) shouldBe Vector("Keep Me")
    }

    "reject a deprecated metricId on replace and leave the dashboard's contents unchanged" in {
      val deprecatedMetricId = seedMetric(userId, pipelineOutputTypeId, deprecated = true)
      val dashboardId         = createDashboard("Contents Deprecated Rollback")
      createTextPanel(dashboardId, "Keep Me")

      val body =
        s"""{"panels":[
           |  {"title":"Bad","type":"metric","dataTypeId":"$pipelineOutputTypeId",
           |   "fieldMapping":{"value":"region"},"metricId":"$deprecatedMetricId"}
           |]}""".stripMargin
      putContents(dashboardId, body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String].toLowerCase should include("deprecated")
      }
      panelTitles(dashboardId) shouldBe Vector("Keep Me")
    }

    "reject a metricId on an unsupported panel type (timeline) on replace and leave contents unchanged" in {
      val metricId    = seedMetric(userId, pipelineOutputTypeId)
      val dashboardId = createDashboard("Contents Unsupported Type Rollback")
      createTextPanel(dashboardId, "Keep Me")

      val body =
        s"""{"panels":[
           |  {"title":"Bad","type":"timeline","dataTypeId":"$pipelineOutputTypeId",
           |   "fieldMapping":{"time":"region","event":"region"},"metricId":"$metricId"}
           |]}""".stripMargin
      putContents(dashboardId, body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String].toLowerCase should include("not supported")
      }
      panelTitles(dashboardId) shouldBe Vector("Keep Me")
    }
  }
}
