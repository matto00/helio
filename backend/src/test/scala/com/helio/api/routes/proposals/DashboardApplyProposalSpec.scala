package com.helio.api.routes.proposals

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
           |    {"title":"Total","type":"output","dataTypeId":"$pipelineOutputId",
           |     "layout":{"x":0,"y":0,"w":4,"h":3}},
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
        // HEL-904 task 3.8/3.9: an "output"-kind panel's config carries
        // `outputId` (an Output id), not `dataTypeId`/`fieldMapping` — the
        // Output itself (not the panel) owns field mapping/visualization.
        metric.fields("config").asJsObject.fields("outputId").convertTo[String] shouldBe pipelineOutputId
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

    // HEL-904 task 3.10a: HEL-292 panel-level aggregation is retired outright
    // (design.md: "aggregation exists only as steps... an Output is
    // render-only") — the two aggregation-preservation tests this comment
    // used to guard (HEL-292's "preserve the aggregation spec" and "apply a
    // proposal without an aggregation field unchanged") are deleted, not
    // rewritten: there is no Output-panel-config equivalent to preserve.

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

    // HEL-904 task 3.10a: `"chart"` is a fully retired panel type — appearance
    // (chartType/axis labels/seriesColors), metric literal label/unit
    // overrides, and chartType-validity rejection are all now Output-owned
    // concepts with no Panel-level equivalent to test here (design.md:
    // "everything about WHAT is shown is edited on the Output"). The three
    // tests this comment used to guard (HEL-293's "apply chart appearance",
    // "apply metric literal label/unit", and Decision 6's "reject an invalid
    // chartType") are deleted outright, not rewritten.

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
      apply("""{"dashboardName":"Bad","panels":[{"title":"X","type":"output"}]}""") ~> routes ~> check {
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
