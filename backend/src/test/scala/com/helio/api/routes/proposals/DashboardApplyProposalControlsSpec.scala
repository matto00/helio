package com.helio.api.routes.proposals

import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

/** HEL-1193: a proposal panel's first-class `controls` through the real
 *  `POST /api/dashboards/apply-proposal` path (real RLS + Flyway). The seeded Output has one
 *  `region` string column, so `text` is eligible and `date-range` is not. */
class DashboardApplyProposalControlsSpec extends ApplyProposalSpecBase {

  private def body(controlJson: String) =
    s"""{"dashboardName":"Controls","panels":[{"title":"Sales","type":"output","outputId":"$pipelineOutputId","controls":[$controlJson]}]}"""

  "POST /api/dashboards/apply-proposal with panel controls" should {

    "persist an eligible control on the created panel, minting the id and defaulting the label" in {
      apply(body("""{"kind":"text","column":"region"}""")) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val panel    = responseAs[String].parseJson.asJsObject.fields("panels").convertTo[Vector[JsObject]].head
        val controls = panel.fields("config").asJsObject.fields("controls").convertTo[Vector[JsObject]]
        controls should have size 1
        controls.head.fields("kind") shouldBe JsString("text")
        controls.head.fields("column") shouldBe JsString("region")
        controls.head.fields("label") shouldBe JsString("region")
        controls.head.fields("id").convertTo[String] should not be empty
      }
    }

    "reject an ineligible control with the panel write path's message and create nothing" in {
      val before = dashboardCount()
      apply(body("""{"kind":"date-range","column":"region"}""")) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String].parseJson.asJsObject.fields("message") shouldBe
          JsString("panel 'Sales': control not eligible: column 'region', kind 'date-range'")
      }
      dashboardCount() shouldBe before
    }

    "reject a control with an unrecognized attribute instead of silently dropping it" in {
      val before = dashboardCount()
      apply(body("""{"kind":"text","column":"region","colum":"x"}""")) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
      dashboardCount() shouldBe before
    }
  }
}
