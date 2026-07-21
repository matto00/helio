package com.helio.api

import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

/** Route-level coverage for `POST /api/dashboards/apply-proposal` (HEL-225)
 *  under real RLS (non-BYPASSRLS app pool, mirroring ApiTokenAuthSpec).
 *
 *  Core apply happy-path + shape/appearance coverage: a valid proposal creates
 *  the dashboard + bound panels via the existing services (HEL-292 aggregation,
 *  HEL-293 markdown/image/divider/chart/metric appearance), and invalid-type /
 *  blank-name / auth rejections. Binding-rejection, HEL-316 config-parity, and
 *  HEL-321 timeline cases live in sibling specs extending ApplyProposalSpecBase. */
class DashboardApplyProposalSpec extends ApplyProposalSpecBase {

  "POST /api/dashboards/apply-proposal" should {

    "create a dashboard with bound + unbound panels from a valid proposal" in {
      val before = dashboardCount()
      val body =
        s"""{
           |  "dashboardName": "Regional Sales",
           |  "panels": [
           |    {"title":"Total","type":"metric","dataTypeId":"$pipelineOutputTypeId",
           |     "fieldMapping":{"value":"region"},"layout":{"x":0,"y":0,"w":4,"h":3}},
           |    {"title":"Notes","type":"text"}
           |  ]
           |}""".stripMargin
      var createdId = ""
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val obj = responseAs[String].parseJson.asJsObject
        createdId = obj.fields("dashboard").asJsObject.fields("id").convertTo[String]
        val panels = obj.fields("panels").convertTo[Vector[JsValue]].map(_.asJsObject)
        panels.map(_.fields("title").convertTo[String]) should contain allOf ("Total", "Notes")
        val metric = panels.find(_.fields("title").convertTo[String] == "Total").get
        metric.fields("config").asJsObject.fields("dataTypeId").convertTo[String] shouldBe pipelineOutputTypeId
      }
      dashboardCount() shouldBe (before + 1)

      // Layout persisted for the positioned panel.
      Get(s"/api/dashboards/$createdId/export").addHeader(sessionCookie) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String].parseJson.asJsObject
          .fields("dashboard").asJsObject.fields("layout").asJsObject
          .fields("lg").convertTo[Vector[JsValue]] should not be empty
      }
    }

    // HEL-292 — the aggregation spec is opaque JSON to the backend; it is
    // threaded through DashboardProposalService.buildCreateRequest verbatim
    // and stored on the created panel's typed config via the same
    // MetricPanelConfig/ChartPanelConfig tolerant-decode path as a direct
    // PATCH would use.
    "preserve the aggregation spec on a created panel (HEL-292)" in {
      val before = dashboardCount()
      val body =
        s"""{
           |  "dashboardName": "Aggregated Sales",
           |  "panels": [
           |    {"title":"Avg","type":"metric","dataTypeId":"$pipelineOutputTypeId",
           |     "fieldMapping":{},"aggregation":{"value":"region","agg":"count"}}
           |  ]
           |}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val obj    = responseAs[String].parseJson.asJsObject
        val panels = obj.fields("panels").convertTo[Vector[JsValue]].map(_.asJsObject)
        val metric = panels.find(_.fields("title").convertTo[String] == "Avg").get
        metric.fields("config").asJsObject.fields("aggregation") shouldBe
          JsObject("value" -> JsString("region"), "agg" -> JsString("count"))
      }
      dashboardCount() shouldBe (before + 1)
    }

    "apply a proposal without an aggregation field unchanged (no aggregation on the created panel)" in {
      val body =
        s"""{
           |  "dashboardName": "No Aggregation",
           |  "panels": [
           |    {"title":"Total","type":"metric","dataTypeId":"$pipelineOutputTypeId",
           |     "fieldMapping":{"value":"region"}}
           |  ]
           |}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val obj    = responseAs[String].parseJson.asJsObject
        val panels = obj.fields("panels").convertTo[Vector[JsValue]].map(_.asJsObject)
        val metric = panels.find(_.fields("title").convertTo[String] == "Total").get
        metric.fields("config").asJsObject.fields.keySet should not contain "aggregation"
      }
    }

    // HEL-293 — content/url/orientation flow through the create-side config
    // for non-data panels, applied via the existing PanelConfigCodec decoders.
    "apply markdown content, image url, and divider orientation from a proposal (HEL-293)" in {
      val before = dashboardCount()
      val body =
        s"""{
           |  "dashboardName": "Content Depth",
           |  "panels": [
           |    {"title":"Roadmap","type":"markdown","content":"# Q3 goals\\n\\nShip it"},
           |    {"title":"Logo","type":"image","url":"https://example.com/logo.png"},
           |    {"title":"Sep","type":"divider","orientation":"vertical"}
           |  ]
           |}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val obj    = responseAs[String].parseJson.asJsObject
        val panels = obj.fields("panels").convertTo[Vector[JsValue]].map(_.asJsObject)

        val markdown = panels.find(_.fields("title").convertTo[String] == "Roadmap").get
        markdown.fields("config").asJsObject.fields("content").convertTo[String] shouldBe "# Q3 goals\n\nShip it"

        val image = panels.find(_.fields("title").convertTo[String] == "Logo").get
        image.fields("config").asJsObject.fields("imageUrl").convertTo[String] shouldBe "https://example.com/logo.png"
        image.fields("config").asJsObject.fields("imageFit").convertTo[String] shouldBe "contain"

        val divider = panels.find(_.fields("title").convertTo[String] == "Sep").get
        divider.fields("config").asJsObject.fields("orientation").convertTo[String] shouldBe "vertical"
      }
      dashboardCount() shouldBe (before + 1)
    }

    // HEL-293 — chart appearance (chartType/axis labels/seriesColors) applies
    // as a best-effort follow-up PATCH after create (Decision 2).
    "apply chart appearance (chartType/axis labels/seriesColors) from a proposal (HEL-293)" in {
      val before = dashboardCount()
      val body =
        s"""{
           |  "dashboardName": "Chart Appearance",
           |  "panels": [
           |    {"title":"Titles by Rating","type":"chart","dataTypeId":"$pipelineOutputTypeId",
           |     "fieldMapping":{},"chartType":"bar","xAxisLabel":"Rating","yAxisLabel":"Count",
           |     "seriesColors":["#111111","#222222"]}
           |  ]
           |}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val obj      = responseAs[String].parseJson.asJsObject
        val panels   = obj.fields("panels").convertTo[Vector[JsValue]].map(_.asJsObject)
        val chart    = panels.find(_.fields("title").convertTo[String] == "Titles by Rating").get
        val chartApp = chart.fields("appearance").asJsObject.fields("chart").asJsObject
        chartApp.fields("chartType").convertTo[String] shouldBe "bar"
        chartApp.fields("axisLabels").asJsObject.fields("x").asJsObject.fields("label").convertTo[String] shouldBe "Rating"
        chartApp.fields("axisLabels").asJsObject.fields("y").asJsObject.fields("label").convertTo[String] shouldBe "Count"
        chartApp.fields("seriesColors").convertTo[Vector[String]] shouldBe Vector("#111111", "#222222")
      }
      dashboardCount() shouldBe (before + 1)
    }

    // HEL-293 — metric literal label/unit override, threaded through the
    // metric config JSON alongside dataTypeId/fieldMapping/aggregation.
    "apply metric literal label/unit from a proposal (HEL-293)" in {
      val before = dashboardCount()
      val body =
        s"""{
           |  "dashboardName": "Metric Literal",
           |  "panels": [
           |    {"title":"Total","type":"metric","dataTypeId":"$pipelineOutputTypeId",
           |     "fieldMapping":{},"label":"Total Revenue","unit":"USD"}
           |  ]
           |}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val obj    = responseAs[String].parseJson.asJsObject
        val panels = obj.fields("panels").convertTo[Vector[JsValue]].map(_.asJsObject)
        val metric = panels.find(_.fields("title").convertTo[String] == "Total").get
        metric.fields("config").asJsObject.fields("label").convertTo[String] shouldBe "Total Revenue"
        metric.fields("config").asJsObject.fields("unit").convertTo[String] shouldBe "USD"
      }
      dashboardCount() shouldBe (before + 1)
    }

    // HEL-293 (Decision 6) — an invalid chartType/orientation 400s in
    // validateStructure, BEFORE any creation — nothing is created.
    "reject an invalid chartType and create nothing" in {
      val before = dashboardCount()
      val body =
        s"""{"dashboardName":"Bad","panels":[
           |  {"title":"X","type":"chart","dataTypeId":"$pipelineOutputTypeId","fieldMapping":{},
           |   "chartType":"bogus"}
           |]}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String].toLowerCase should include("charttype")
      }
      dashboardCount() shouldBe before
    }

    "reject an invalid divider orientation and create nothing" in {
      val before = dashboardCount()
      val body =
        """{"dashboardName":"Bad","panels":[
          |  {"title":"X","type":"divider","orientation":"diagonal"}
          |]}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String].toLowerCase should include("orientation")
      }
      dashboardCount() shouldBe before
    }

    "reject an invalid panel type and create nothing" in {
      val before = dashboardCount()
      apply("""{"dashboardName":"Bad","panels":[{"title":"X","type":"bogus"}]}""") ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
      dashboardCount() shouldBe before
    }

    "reject a metric panel with no dataTypeId and create nothing" in {
      val before = dashboardCount()
      apply("""{"dashboardName":"Bad","panels":[{"title":"X","type":"metric"}]}""") ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String].toLowerCase should include("datatypeid")
      }
      dashboardCount() shouldBe before
    }

    "reject a blank dashboard name" in {
      apply("""{"dashboardName":"  ","panels":[]}""") ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "require authentication" in {
      Post("/api/dashboards/apply-proposal", json("""{"dashboardName":"x","panels":[]}""")) ~> routes ~> check {
        status shouldBe StatusCodes.Unauthorized
      }
    }
  }
}
